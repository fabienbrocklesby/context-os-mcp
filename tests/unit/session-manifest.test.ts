import { describe, it, expect } from "vitest";
import { selectCurrentContextManifest, MAX_MANIFEST_DOCUMENTS, compactRepoCoverage } from "~/domain/session";
import type { ResolvedMemoryDocument } from "~/domain/memory";

function doc(over: Partial<ResolvedMemoryDocument>): ResolvedMemoryDocument {
  return {
    id: "d", workdriveFileId: "w", currentSnapshotId: null,
    path: "/memory/projects/light-lane/knowledge/entities/companies/x.md",
    title: "X", project: "light-lane", namespace: "light-lane", parentFolderId: "p",
    fileName: "x.md", permalink: null, downloadUrl: null, memoryType: "current_context",
    status: "active", canonical: true, active: true, revision: 1, tags: [],
    memoryLayer: "knowledge", ...over,
  };
}

describe("selectCurrentContextManifest", () => {
  it("puts the situation doc first, then context/current docs, before entity stubs", () => {
    const docs = [
      doc({ id: "entity1", path: "/memory/projects/light-lane/knowledge/entities/companies/fivestar.md" }),
      doc({ id: "ctx", path: "/memory/projects/light-lane/context/current/what-light-lane-is.md", memoryLayer: "knowledge" }),
      doc({ id: "sit", path: "/memory/projects/light-lane/context/current/situation.md", memoryLayer: "situation" }),
    ];
    const selected = selectCurrentContextManifest(docs);
    expect(selected.map((d) => d.id).slice(0, 2)).toEqual(["sit", "ctx"]);
  });

  it("caps at MAX_MANIFEST_DOCUMENTS", () => {
    const docs = Array.from({ length: 40 }, (_, i) =>
      doc({ id: `e${i}`, path: `/memory/projects/light-lane/knowledge/entities/companies/e${i}.md` }),
    );
    expect(selectCurrentContextManifest(docs).length).toBe(MAX_MANIFEST_DOCUMENTS);
  });

  it("ranks non-entity knowledge docs above entity stubs and 'other' docs", () => {
    const docs = [
      doc({ id: "entity", path: "/memory/projects/light-lane/knowledge/entities/companies/x.md", memoryLayer: "knowledge" }),
      doc({ id: "operational", path: "/memory/projects/light-lane/operational/notes/foo.md", memoryLayer: "operational" }),
      doc({ id: "knowledge-note", path: "/memory/projects/light-lane/knowledge/notes/foo.md", memoryLayer: "knowledge" }),
    ];
    const ids = selectCurrentContextManifest(docs).map((d) => d.id);
    expect(ids.indexOf("knowledge-note")).toBeLessThan(ids.indexOf("operational"));
    expect(ids.indexOf("operational")).toBeLessThan(ids.indexOf("entity"));
  });
});

describe("compactRepoCoverage", () => {
  it("reduces a full coverage block to complete + missing only", () => {
    const full = { required: ["a/b", "c/d", "e/f", "g/h"], present: ["a/b", "c/d", "e/f", "g/h"], missing: [], complete: true };
    expect(compactRepoCoverage(full)).toEqual({ complete: true, missing: [] });
  });
  it("keeps the missing list when coverage is incomplete", () => {
    const full = { required: ["a/b", "c/d"], present: ["a/b"], missing: ["c/d"], complete: false };
    expect(compactRepoCoverage(full)).toEqual({ complete: false, missing: ["c/d"] });
  });
});
