import { describe, expect, it } from "vitest";

import { rerankSearchHits } from "~/domain/ranking";
import type { MemorySearchHit } from "~/domain/memory";

function makeHit(overrides: Partial<MemorySearchHit>): MemorySearchHit {
  return {
    documentId: "doc-1",
    snapshotId: "snap-1",
    vectorId: crypto.randomUUID(),
    title: "Document",
    path: "/memory/shared/context/current/doc.md",
    project: "shared",
    namespace: "shared",
    workdriveFileId: "wd-1",
    memoryType: "current_context",
    status: "active",
    active: true,
    superseded: false,
    revision: 1,
    headingPath: "",
    chunkIndex: 0,
    chunkText: "body",
    score: 0.5,
    updatedAtUnix: Math.floor(Date.now() / 1000),
    ...overrides,
  };
}

describe("rerankSearchHits", () => {
  it("prefers active current context over stale historical notes", () => {
    const now = Date.UTC(2026, 3, 23);
    const ranked = rerankSearchHits(
      [
        makeHit({
          documentId: "historical",
          memoryType: "historical_note",
          status: "historical",
          active: false,
          score: 0.68,
          updatedAtUnix: Math.floor((now - 45 * 24 * 60 * 60 * 1000) / 1000),
        }),
        makeHit({
          documentId: "current",
          memoryType: "current_context",
          status: "active",
          active: true,
          score: 0.62,
          updatedAtUnix: Math.floor((now - 2 * 24 * 60 * 60 * 1000) / 1000),
        }),
      ],
      { now },
    );

    expect(ranked[0]?.documentId).toBe("current");
  });

  it("excludes superseded hits by default", () => {
    const ranked = rerankSearchHits([
      makeHit({ documentId: "active" }),
      makeHit({ documentId: "superseded", superseded: true, status: "superseded" }),
    ]);

    expect(ranked.map((hit) => hit.documentId)).toEqual(["active"]);
  });
});
