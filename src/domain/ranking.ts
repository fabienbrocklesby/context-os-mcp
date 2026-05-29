import { isRetrievableMemoryStatus, type MemoryLayer, type MemorySearchHit } from "~/domain/memory";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

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
  let score = hit.score;

  // Layer boosts — most important signal
  if (hit.memoryLayer === "situation") score += 0.65;
  if (hit.memoryLayer === "knowledge") score += 0.15;
  if (hit.memoryLayer === "event_log") score -= 0.40;

  // Project match
  if (options.project && hit.project === options.project) score += 0.18;
  if (options.project && hit.project === "shared") score -= 0.03;

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

  // Freshness (decays over 30 days)
  const age = Math.max(0, now - hit.updatedAtUnix * 1000);
  score += Math.max(0, 1 - age / THIRTY_DAYS_MS) * 0.1;

  // Curator signals
  score += (hit.usefulness ?? 0) * 0.04;
  score += (hit.confidence ?? 0) * 0.03;

  return score;
}
