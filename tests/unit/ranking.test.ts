import { describe, expect, it } from "vitest";

import { rerankSearchHits } from "~/domain/ranking";
import type { MemoryLayer, MemorySearchHit } from "~/domain/memory";

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

function makeLayeredHit(documentId: string, layer: MemoryLayer, score: number): MemorySearchHit {
  return makeHit({
    documentId,
    score,
    memoryLayer: layer,
    memoryType: layer === "event_log" ? "session_summary" : "current_context",
    status: layer === "event_log" ? ("historical" as const) : ("active" as const),
    active: layer !== "event_log",
  });
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

describe("rerankSearchHits with layer filtering", () => {
  it("excludes event_log hits when excludeLayers includes event_log", () => {
    const hits = [
      makeLayeredHit("session-old", "event_log", 0.95),
      makeLayeredHit("current-state", "operational", 0.7),
      makeLayeredHit("knowledge-doc", "knowledge", 0.6),
    ];

    const result = rerankSearchHits(hits, {
      excludeLayers: ["event_log"],
      includeSuperseded: true,
    });

    expect(result.map((h) => h.documentId)).not.toContain("session-old");
    expect(result.map((h) => h.documentId)).toContain("current-state");
  });

  it("boosts situation layer docs to the top", () => {
    const hits = [
      makeLayeredHit("knowledge-doc", "knowledge", 0.9),
      makeLayeredHit("situation-doc", "situation", 0.5),
    ];

    const result = rerankSearchHits(hits, { includeSuperseded: true });

    expect(result[0].documentId).toBe("situation-doc");
  });

  it("strongly penalises event_log when not excluded but present", () => {
    const hits = [
      makeLayeredHit("session-old", "event_log", 0.99),
      makeLayeredHit("knowledge-doc", "knowledge", 0.6),
    ];

    const result = rerankSearchHits(hits, { includeSuperseded: true });

    expect(result[0].documentId).toBe("knowledge-doc");
  });
});
