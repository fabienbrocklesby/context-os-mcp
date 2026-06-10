import { isRetrievableMemoryStatus, type MemoryLayer, type MemorySearchHit, type MemoryType } from "~/domain/memory";

const DAY_MS = 24 * 60 * 60 * 1000;

// Per-memory-type recency half-life in days. Volatile types lose relevance fast;
// durable knowledge barely ages.
const RECENCY_HALF_LIFE_DAYS: Record<MemoryType, number> = {
  session_summary: 21,
  historical_note: 21,
  current_context: 120,
  decision: 120,
  snippet: 365,
  repo_index: 365,
};

// Floor on the recency multiplier per type. session_summary/historical_note use 0 so
// volatile memory is allowed to age out of results entirely; durable knowledge never
// decays below its floor.
const RECENCY_FLOOR: Record<MemoryType, number> = {
  session_summary: 0,
  historical_note: 0,
  current_context: 0.6,
  decision: 0.6,
  snippet: 0.9,
  repo_index: 0.9,
};

function recencyMultiplier(memoryType: MemoryType, ageDays: number): number {
  const halfLife = RECENCY_HALF_LIFE_DAYS[memoryType] ?? 120;
  const floor = RECENCY_FLOOR[memoryType] ?? 0.5;
  const raw = Math.pow(0.5, Math.max(0, ageDays) / halfLife);
  return Math.max(floor, raw);
}

// 45 days is ~2.1 half-lives for volatile types (21-day half-life), i.e. deep decay:
// past this, even a strong semantic match is a stale false positive, so gate it out.
// includeSuperseded acts as the explicit "show me history" override.
const VOLATILE_STALE_CUTOFF_DAYS: Partial<Record<MemoryType, number>> = {
  session_summary: 45,
  historical_note: 45,
};

function isStaleVolatile(hit: MemorySearchHit, now: number): boolean {
  const cutoff = VOLATILE_STALE_CUTOFF_DAYS[hit.memoryType];
  if (cutoff === undefined) return false;
  const ageDays = Math.max(0, (now - hit.updatedAtUnix * 1000) / DAY_MS);
  return ageDays > cutoff;
}

export function rerankSearchHits(
  hits: MemorySearchHit[],
  options: {
    includeSuperseded?: boolean;
    now?: number;
    project?: string;
    repo?: string;
    path?: string;
    excludeLayers?: MemoryLayer[];
  } = {},
) {
  const now = options.now ?? Date.now();
  return [...hits]
    .filter((hit) => options.includeSuperseded || !hit.superseded)
    .filter((hit) => options.includeSuperseded || isRetrievableMemoryStatus(hit.status))
    .filter((hit) => options.includeSuperseded || !isStaleVolatile(hit, now))
    .filter((hit) => {
      if (!options.excludeLayers?.length || !hit.memoryLayer) return true;
      return !options.excludeLayers.includes(hit.memoryLayer);
    })
    .map((hit) => ({ hit, rankingScore: computeRankingScore(hit, now, options) }))
    .sort((a, b) => b.rankingScore - a.rankingScore)
    .map(({ hit }) => hit);
}

function computeRankingScore(
  hit: MemorySearchHit,
  now: number,
  options: { project?: string; repo?: string; path?: string },
): number {
  const ageDays = (now - hit.updatedAtUnix * 1000) / DAY_MS;
  let score = hit.score * recencyMultiplier(hit.memoryType, ageDays);

  // Layer boosts — most important signal
  if (hit.memoryLayer === "situation") score += 0.65;
  if (hit.memoryLayer === "knowledge") score += 0.15;
  if (hit.memoryLayer === "event_log") score -= 0.40;

  // Namespace weighting: a project's own docs decisively win its own queries.
  if (options.project && hit.project === options.project) score += 0.3;
  if (options.project && hit.project === "shared" && options.project !== "shared") score -= 0.2;

  // Repo and path match
  if (options.repo && hit.repo === options.repo.toLowerCase()) score += 0.08;
  if (options.path && hit.repoPath?.includes(options.path)) score += 0.05;

  // Document quality signals
  if (hit.active) score += 0.12;
  if (hit.memoryType === "current_context") score += 0.20;
  if (hit.memoryType === "decision") score += 0.10;
  if (hit.memoryType === "session_summary") score -= 0.05;
  if (hit.memoryType === "snippet" || hit.memoryType === "repo_index") score += 0.03;
  if (hit.status === "historical") score -= 0.08;
  if (hit.superseded) score -= 0.25;

  // Current structured entity state contradicts this document -> strong demotion.
  if (hit.contradictedByCurrentState) score -= 0.6;

  // Curator signals
  score += (hit.usefulness ?? 0) * 0.04;
  score += (hit.confidence ?? 0) * 0.03;

  return score;
}
