import type { MemorySearchHit } from "~/domain/memory";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export function rerankSearchHits(
  hits: MemorySearchHit[],
  options: {
    includeSuperseded?: boolean;
    now?: number;
    project?: string;
    repo?: string;
    path?: string;
  } = {},
) {
  const now = options.now ?? Date.now();
  return [...hits]
    .filter((hit) => options.includeSuperseded || !hit.superseded)
    .map((hit) => ({
      hit,
      rankingScore: computeRankingScore(hit, now, options),
    }))
    .sort((left, right) => right.rankingScore - left.rankingScore)
    .map(({ hit }) => hit);
}

function computeRankingScore(
  hit: MemorySearchHit,
  now: number,
  options: { project?: string; repo?: string; path?: string },
) {
  let score = hit.score;
  if (options.project && hit.project === options.project) {
    score += 0.18;
  }
  if (options.project && hit.project === "shared") {
    score -= 0.03;
  }
  if (options.repo && hit.repo === options.repo.toLowerCase()) {
    score += 0.08;
  }
  if (options.path && hit.repoPath?.includes(options.path)) {
    score += 0.05;
  }
  if (hit.active) {
    score += 0.12;
  }
  if (hit.memoryType === "current_context") {
    score += 0.2;
  }
  if (hit.memoryType === "decision") {
    score += 0.1;
  }
  if (hit.memoryType === "session_summary") {
    score -= 0.05;
  }
  if (hit.memoryType === "snippet" || hit.memoryType === "repo_index") {
    score += 0.03;
  }
  if (hit.status === "historical") {
    score -= 0.08;
  }
  if (hit.superseded) {
    score -= 0.25;
  }

  const age = Math.max(0, now - hit.updatedAtUnix * 1000);
  const freshnessBoost = Math.max(0, 1 - age / THIRTY_DAYS_MS) * 0.1;
  score += freshnessBoost;
  score += (hit.usefulness ?? 0) * 0.04;
  score += (hit.confidence ?? 0) * 0.03;
  return score;
}
