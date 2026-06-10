import { describe, it, expect } from "vitest";

import { partitionTasksByStaleness, DEFAULT_NEEDS_REVIEW_DAYS } from "~/domain/task-lifecycle";
import type { ContextTask } from "~/domain/memory";

function task(overrides: Partial<ContextTask>): ContextTask {
  return {
    id: "t",
    project: "light-lane",
    title: "T",
    description: null,
    status: "open",
    priority: "normal",
    dueAt: null,
    owner: null,
    initiativeId: null,
    entityId: null,
    source: null,
    sourceUrl: null,
    reminderAt: null,
    metadata: {},
    createdAt: "2026-05-01T00:00:00Z",
    updatedAt: "2026-05-01T00:00:00Z",
    ...overrides,
  };
}

const NOW = "2026-06-10T00:00:00Z";

describe("partitionTasksByStaleness", () => {
  it("defaults the staleness threshold to 14 days", () => {
    expect(DEFAULT_NEEDS_REVIEW_DAYS).toBe(14);
  });

  it("buckets tasks overdue by more than 14 days as needs_review", () => {
    const t = task({ id: "stale", dueAt: "2026-05-20T00:00:00Z" }); // 21 days overdue
    const { live, needsReview } = partitionTasksByStaleness([t], NOW);
    expect(needsReview.map((x) => x.id)).toEqual(["stale"]);
    expect(live).toEqual([]);
  });

  it("keeps tasks overdue by 14 days or less as live", () => {
    const t = task({ id: "recent", dueAt: "2026-06-01T00:00:00Z" }); // 9 days overdue
    const { live, needsReview } = partitionTasksByStaleness([t], NOW);
    expect(live.map((x) => x.id)).toEqual(["recent"]);
    expect(needsReview).toEqual([]);
  });

  it("keeps future and undated tasks as live", () => {
    const future = task({ id: "future", dueAt: "2026-07-01T00:00:00Z" });
    const undated = task({ id: "undated", dueAt: null });
    const { live, needsReview } = partitionTasksByStaleness([future, undated], NOW);
    expect(live.map((x) => x.id).sort()).toEqual(["future", "undated"]);
    expect(needsReview).toEqual([]);
  });

  it("never buckets closed tasks even if long overdue", () => {
    const done = task({ id: "done", status: "done", dueAt: "2026-01-01T00:00:00Z" });
    const cancelled = task({ id: "cancelled", status: "cancelled", dueAt: "2026-01-01T00:00:00Z" });
    const { live, needsReview } = partitionTasksByStaleness([done, cancelled], NOW);
    expect(needsReview).toEqual([]);
    expect(live.map((x) => x.id).sort()).toEqual(["cancelled", "done"]);
  });

  it("respects a custom threshold", () => {
    const t = task({ id: "x", dueAt: "2026-06-01T00:00:00Z" }); // 9 days overdue
    const { needsReview } = partitionTasksByStaleness([t], NOW, 7);
    expect(needsReview.map((x) => x.id)).toEqual(["x"]);
  });

  it("preserves input order within each bucket", () => {
    const a = task({ id: "a", dueAt: "2026-01-01T00:00:00Z" }); // stale
    const b = task({ id: "b", dueAt: "2026-06-09T00:00:00Z" }); // live
    const c = task({ id: "c", dueAt: "2026-02-01T00:00:00Z" }); // stale
    const { live, needsReview } = partitionTasksByStaleness([a, b, c], NOW);
    expect(needsReview.map((x) => x.id)).toEqual(["a", "c"]);
    expect(live.map((x) => x.id)).toEqual(["b"]);
  });
});
