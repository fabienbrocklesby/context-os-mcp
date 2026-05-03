import { describe, expect, it, vi } from "vitest";

import { deleteVectors, queryMemoryIndex, replaceDocumentVectors } from "~/integrations/vectorize/client";

describe("Vectorize client", () => {
  it("builds metadata filters and normalizes search hits", async () => {
    const query = vi.fn(async () => ({
      matches: [
        {
          id: "vec-1",
          score: 0.91,
          namespace: "shared",
          metadata: {
            doc_id: "doc-1",
            snapshot_id: "snap-1",
            project: "shared",
            path: "/memory/shared/context/current/vision.md",
            workdrive_file_id: "wd-1",
            title: "Vision",
            memory_type: "current_context",
            status: "active",
            active: true,
            superseded: false,
            repo: "owner/repo",
            repo_path: "README.md",
            tags: ["docs"],
            source: "github",
            confidence: 0.9,
            usefulness: 0.7,
            updated_at_unix: 1_700_000_000,
            heading_path: "Vision",
            chunk_index: 0,
            revision: 3,
            url: "https://example.com/doc",
          },
        },
      ],
    }));
    const env = {
      MEMORY_INDEX: {
        query,
      },
    } as unknown as Env;

    const hits = await queryMemoryIndex(env, [0.1, 0.2], ["shared"], {
      activeOnly: true,
      includeSuperseded: false,
      memoryTypes: ["current_context"],
      statuses: ["active"],
      repo: "owner/repo",
      source: "github",
      limit: 5,
    });

    expect(query).toHaveBeenCalledWith(
      [0.1, 0.2],
      expect.objectContaining({
        namespace: "shared",
        topK: 5,
        returnMetadata: "all",
        filter: {
          memory_type: { $in: ["current_context"] },
          status: { $in: ["active"] },
          active: true,
          superseded: false,
          repo: "owner/repo",
          source: "github",
        },
      }),
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]?.documentId).toBe("doc-1");
    expect(hits[0]?.repo).toBe("owner/repo");
    expect(hits[0]?.tags).toEqual(["docs"]);
    expect(hits[0]?.url).toBe("https://example.com/doc");
  });

  it("replaces and deletes vectors through the bound index", async () => {
    const upsert = vi.fn(async () => undefined);
    const deleteByIds = vi.fn(async () => undefined);
    const env = {
      MEMORY_INDEX: {
        upsert,
        deleteByIds,
      },
    } as unknown as Env;

    await replaceDocumentVectors(env, {
      namespace: "shared",
      documentId: "doc-1",
      snapshotId: "snap-1",
      workdriveFileId: "wd-1",
      title: "Vision",
      path: "/memory/shared/context/current/vision.md",
      project: "shared",
      memoryType: "current_context",
      status: "active",
      active: true,
      superseded: false,
      repo: "owner/repo",
      repoPath: "README.md",
      tags: ["docs"],
      source: "github",
      confidence: 0.9,
      usefulness: 0.7,
      revision: 2,
      url: "https://example.com/doc",
      chunks: [
        {
          vectorId: "vec-1",
          chunkIndex: 0,
          headingPath: "Vision",
          content: "Chunk body",
          tokenEstimate: 12,
          updatedAtUnix: 1_700_000_000,
        },
      ],
      embeddings: [[0.1, 0.2, 0.3]],
    });

    expect(upsert).toHaveBeenCalledWith([
      expect.objectContaining({
        id: "vec-1",
        namespace: "shared",
        values: [0.1, 0.2, 0.3],
        metadata: expect.objectContaining({
          doc_id: "doc-1",
          workdrive_file_id: "wd-1",
          revision: 2,
          repo: "owner/repo",
          repo_path: "README.md",
          source: "github",
          confidence: 0.9,
          usefulness: 0.7,
        }),
      }),
    ]);

    await deleteVectors(env, ["vec-1", "vec-2"]);
    expect(deleteByIds).toHaveBeenCalledWith(["vec-1", "vec-2"]);
  });
});
