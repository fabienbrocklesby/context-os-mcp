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

describe("multiplicative recency decay", () => {
  const NOW = Date.UTC(2026, 5, 10); // 2026-06-10

  function hitAt(documentId: string, daysAgo: number, over: Partial<MemorySearchHit> = {}): MemorySearchHit {
    return makeHit({
      documentId,
      score: 0.7,
      updatedAtUnix: Math.floor((NOW - daysAgo * 24 * 60 * 60 * 1000) / 1000),
      ...over,
    });
  }

  it("ranks a fresh session summary above a 60-day-old one", () => {
    const ranked = rerankSearchHits(
      [
        hitAt("stale-session", 60, { memoryType: "session_summary", status: "historical", active: false, memoryLayer: "event_log" }),
        hitAt("fresh-session", 1, { memoryType: "session_summary", status: "historical", active: false, memoryLayer: "event_log" }),
      ],
      { now: NOW, includeSuperseded: true },
    );
    expect(ranked[0]?.documentId).toBe("fresh-session");
  });

  it("decays a durable snippet far less than a session summary over the same age", () => {
    // Both 90 days old, same base score. The snippet (durable) should outrank the session summary (volatile).
    const ranked = rerankSearchHits(
      [
        hitAt("old-session", 90, { memoryType: "session_summary", status: "historical", active: false, memoryLayer: "event_log" }),
        hitAt("old-snippet", 90, { memoryType: "snippet", memoryLayer: "knowledge" }),
      ],
      { now: NOW, includeSuperseded: true },
    );
    expect(ranked[0]?.documentId).toBe("old-snippet");
  });

  it("orders two equally-relevant stale session summaries by recency", () => {
    // Both > 30 days old (old additive model gives both +0 freshness -> tie, stable
    // sort keeps input order [older, newer]). Multiplicative decay must reorder so the
    // less-stale one wins. Reversed input order makes the assertion meaningful.
    const ranked = rerankSearchHits(
      [
        hitAt("older", 90, { memoryType: "session_summary", status: "historical", active: false, memoryLayer: "event_log" }),
        hitAt("newer", 40, { memoryType: "session_summary", status: "historical", active: false, memoryLayer: "event_log" }),
      ],
      { now: NOW, includeSuperseded: true },
    );
    expect(ranked[0]?.documentId).toBe("newer");
  });
});
