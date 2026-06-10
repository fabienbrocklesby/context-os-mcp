import type { ContextTask } from "~/domain/memory";

export const DEFAULT_NEEDS_REVIEW_DAYS = 14;

export type TaskPartition = {
  live: ContextTask[];
  needsReview: ContextTask[];
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Split tasks into a default "live" surface and a "needs_review" bucket.
 *
 * A task is needs_review only if it is still open (not done/cancelled) AND its
 * due date is more than `thresholdDays` before `nowIso`. Closed, future, and
 * undated tasks always stay live, and input order is preserved within each
 * bucket.
 */
export function partitionTasksByStaleness(
  tasks: ContextTask[],
  nowIso: string,
  thresholdDays: number = DEFAULT_NEEDS_REVIEW_DAYS,
): TaskPartition {
  const cutoffMs = new Date(nowIso).getTime() - thresholdDays * DAY_MS;
  const live: ContextTask[] = [];
  const needsReview: ContextTask[] = [];
  for (const task of tasks) {
    const isOpen = task.status !== "done" && task.status !== "cancelled";
    const dueMs = task.dueAt ? new Date(task.dueAt).getTime() : NaN;
    if (isOpen && !Number.isNaN(dueMs) && dueMs < cutoffMs) {
      needsReview.push(task);
    } else {
      live.push(task);
    }
  }
  return { live, needsReview };
}
