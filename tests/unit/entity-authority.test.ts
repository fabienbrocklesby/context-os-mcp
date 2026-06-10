import { describe, it, expect } from "vitest";
import { deriveNotCurrentEntities, markContradictedHits } from "~/domain/entity-authority";
import type { MemorySearchHit } from "~/domain/memory";

function hit(over: Partial<MemorySearchHit>): MemorySearchHit {
  return {
    documentId: "d", snapshotId: "s", vectorId: "v", title: "T",
    path: "/memory/projects/light-lane/knowledge/entities/companies/x.md",
    project: "light-lane", namespace: "light-lane", workdriveFileId: "w",
    memoryType: "current_context", status: "active", active: true, superseded: false,
    revision: 1, headingPath: "", chunkIndex: 0, chunkText: "", score: 0.7,
    updatedAtUnix: 0, ...over,
  };
}

describe("deriveNotCurrentEntities", () => {
  it("flags entities whose active volatile state reads as not-current", () => {
    const result = deriveNotCurrentEntities([
      { entityId: "e1", names: ["Fivestar Print", "fivestar-print"], states: [
        { stateKey: "deal_stage", value: "parked_legacy_not_current_pipeline", status: "active" },
      ] },
      { entityId: "e2", names: ["Talley's Group"], states: [
        { stateKey: "deal_stage", value: "active_multi_site_evaluation", status: "active" },
      ] },
    ]);
    expect(result.map((r) => r.entityId)).toEqual(["e1"]);
  });

  it("ignores superseded states and non-volatile keys", () => {
    const result = deriveNotCurrentEntities([
      { entityId: "e3", names: ["X"], states: [
        { stateKey: "deal_stage", value: "closed_lost", status: "superseded" },
        { stateKey: "industry", value: "legacy manufacturing", status: "active" },
      ] },
    ]);
    expect(result).toEqual([]);
  });

  it("does not flag an entity whose deal_stage is closed_won", () => {
    const result = deriveNotCurrentEntities([
      { entityId: "e-won", names: ["Big Client"], states: [
        { stateKey: "deal_stage", value: "closed_won", status: "active" },
      ] },
    ]);
    expect(result).toEqual([]);
  });

  it("still flags closed_lost", () => {
    const result = deriveNotCurrentEntities([
      { entityId: "e-lost", names: ["Gone"], states: [
        { stateKey: "deal_stage", value: "closed_lost", status: "active" },
      ] },
    ]);
    expect(result.map((r) => r.entityId)).toEqual(["e-lost"]);
  });

  it("does not flag based on a next_action value", () => {
    const result = deriveNotCurrentEntities([
      { entityId: "e-na", names: ["Active Co"], states: [
        { stateKey: "next_action", value: "lost-contact-recovery-call", status: "active" },
      ] },
    ]);
    expect(result).toEqual([]);
  });
});

describe("markContradictedHits", () => {
  const notCurrent = [{ entityId: "e1", names: ["Fivestar Print", "fivestar-print"], reason: "deal_stage=parked" }];

  it("marks a hit whose path matches the entity slug", () => {
    const marked = markContradictedHits(
      [hit({ documentId: "fivestar", path: "/memory/projects/light-lane/knowledge/entities/companies/fivestar-print.md" })],
      notCurrent,
    );
    expect(marked[0]?.contradictedByCurrentState).toBe(true);
  });

  it("marks a hit whose title equals the entity name", () => {
    const marked = markContradictedHits([hit({ documentId: "t", title: "Fivestar Print", path: "/x.md" })], notCurrent);
    expect(marked[0]?.contradictedByCurrentState).toBe(true);
  });

  it("leaves unrelated hits untouched", () => {
    const marked = markContradictedHits([hit({ documentId: "talleys", title: "Talley's Group", path: "/talleys.md" })], notCurrent);
    expect(marked[0]?.contradictedByCurrentState).toBeUndefined();
  });

  it("is a no-op when nothing is not-current", () => {
    const original = hit({ documentId: "x" });
    const marked = markContradictedHits([original], []);
    expect(marked[0]).toBe(original);
  });
});
