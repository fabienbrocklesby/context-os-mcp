import { beforeEach, describe, expect, it, vi } from "vitest";

import type { MemoryPrincipal, MemorySearchHit, ResolvedMemoryDocument } from "~/domain/memory";

const mocks = vi.hoisted(() => ({
  embedTexts: vi.fn(),
  queryMemoryIndex: vi.fn(),
  getChunkContentsByVectorIds: vi.fn(),
  getDocumentsByIds: vi.fn(),
  searchDocumentsKeyword: vi.fn(),
  getProjectStats: vi.fn(),
  searchEntityAliases: vi.fn(),
  searchEntities: vi.fn(),
  listEntityStatesForEntities: vi.fn(),
}));

vi.mock("~/integrations/workers-ai/embeddings", () => ({
  embedTexts: (...args: unknown[]) => mocks.embedTexts(...args),
}));

vi.mock("~/integrations/vectorize/client", () => ({
  queryMemoryIndexWithDiagnostics: async (...args: unknown[]) => {
    const value = await mocks.queryMemoryIndex(...args);
    return Array.isArray(value)
      ? { hits: value, diagnostics: { raw_match_count: value.length, hydrated_hit_count: value.length } }
      : value;
  },
  replaceDocumentVectors: vi.fn(),
  deleteVectors: vi.fn(),
}));

vi.mock("~/persistence/d1/repository", () => ({
  MemoryRepository: class {
    getChunkContentsByVectorIds(vectorIds: string[]) {
      return mocks.getChunkContentsByVectorIds(vectorIds);
    }

    getDocumentsByIds(documentIds: string[]) {
      return mocks.getDocumentsByIds(documentIds);
    }

    searchDocumentsKeyword(input: unknown) {
      return mocks.searchDocumentsKeyword(input);
    }

    getProjectStats(project: string) {
      return mocks.getProjectStats(project);
    }

    searchEntityAliases(input: unknown) {
      return mocks.searchEntityAliases(input);
    }

    searchEntities(input: unknown) {
      return mocks.searchEntities(input);
    }

    listEntityStatesForEntities(input: unknown) {
      return mocks.listEntityStatesForEntities(input);
    }
  },
}));

vi.mock("~/integrations/zoho/client", () => ({
  ZohoWorkDriveClient: class {},
}));

vi.mock("~/integrations/github/client", () => ({
  GithubOAuthClient: class {},
}));

function makeEnv() {
  return {
    APP_BASE_URL: "https://memory.example.com",
    MCP_ROUTE: "/mcp",
    GITHUB_OAUTH_AUTHORIZE_URL: "https://github.com/login/oauth/authorize",
    GITHUB_OAUTH_TOKEN_URL: "https://github.com/login/oauth/access_token",
    GITHUB_OAUTH_USER_URL: "https://api.github.com/user",
    GITHUB_OAUTH_EMAILS_URL: "https://api.github.com/user/emails",
    ZOHO_WORKDRIVE_API_BASE_URL: "https://workdrive.zoho.com/api/v1",
    ZOHO_ACCOUNTS_BASE_URL: "https://accounts.zoho.com",
    WORKERS_AI_EMBEDDING_MODEL: "@cf/baai/bge-base-en-v1.5",
    DB: {} as D1Database,
    AI: {} as Ai,
    MEMORY_INDEX: {} as VectorizeIndex,
  } as Env;
}

function makePrincipal(): MemoryPrincipal {
  return {
    authType: "bearer",
    userId: "test",
    login: "test",
  };
}

function makeHit(overrides: Partial<MemorySearchHit> = {}): MemorySearchHit {
  return {
    documentId: "doc-1",
    snapshotId: "snap-1",
    vectorId: "doc-1:0",
    title: "Memory architecture",
    path: "/memory/projects/memory-system-mcp/context/current/architecture.md",
    project: "memory-system-mcp",
    namespace: "memory-system-mcp",
    workdriveFileId: "wd-1",
    memoryType: "current_context",
    status: "active",
    active: true,
    superseded: false,
    revision: 1,
    headingPath: "Retrieval",
    chunkIndex: 0,
    chunkText: "",
    score: 0.5,
    updatedAtUnix: 1_800_000_000,
    ...overrides,
  };
}

function makeDocument(overrides: Partial<ResolvedMemoryDocument> = {}): ResolvedMemoryDocument {
  return {
    id: "doc-1",
    workdriveFileId: "wd-1",
    currentSnapshotId: "snap-1",
    path: "/memory/projects/memory-system-mcp/context/current/architecture.md",
    title: "Memory architecture",
    project: "memory-system-mcp",
    namespace: "memory-system-mcp",
    parentFolderId: "folder-1",
    fileName: "architecture.md",
    permalink: "https://workdrive.example.com/doc-1",
    downloadUrl: null,
    memoryType: "current_context",
    status: "active",
    canonical: true,
    active: true,
    revision: 1,
    tags: ["retrieval"],
    ...overrides,
  };
}

describe("MemoryService searchMemory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.embedTexts.mockResolvedValue([
      [0.1],
      [0.2],
      [0.3],
      [0.4],
      [0.5],
    ]);
    mocks.getChunkContentsByVectorIds.mockResolvedValue(
      new Map([["doc-1:0", "Semantic retrieval should answer broad conceptual questions."]]),
    );
    mocks.getDocumentsByIds.mockResolvedValue(new Map([["doc-1", makeDocument()]]));
    mocks.searchDocumentsKeyword.mockResolvedValue([]);
    mocks.getProjectStats.mockResolvedValue({ document_count: 1, chunk_count: 1 });
    mocks.searchEntityAliases.mockResolvedValue([]);
    mocks.searchEntities.mockResolvedValue([]);
    mocks.listEntityStatesForEntities.mockResolvedValue([]);
  });

  it("queries semantic variants, widens candidate breadth, and deduplicates to the best vector score", async () => {
    const { MemoryService } = await import("~/domain/service");
    const service = new MemoryService(makeEnv(), makePrincipal());

    mocks.queryMemoryIndex
      .mockResolvedValueOnce([makeHit({ score: 0.2 })])
      .mockResolvedValueOnce([makeHit({ score: 0.8 }), makeHit({ vectorId: "doc-1:1", score: 0.7 })])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await service.searchMemory({
      project: "memory-system-mcp",
      query: "why does memory need semantic recall",
      limit: 4,
    });

    expect(mocks.embedTexts).toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining([
        "why does memory need semantic recall",
        "initiatives goals blockers milestones outcomes why does memory need semantic recall",
        "recent decisions tasks source events session summaries why does memory need semantic recall",
      ]),
    );
    expect(mocks.queryMemoryIndex).toHaveBeenCalledTimes(5);
    expect(mocks.queryMemoryIndex).toHaveBeenCalledWith(
      expect.anything(),
      [0.1],
      ["shared", "memory-system-mcp"],
      expect.objectContaining({
        limit: 4,
        candidateLimit: 12,
        activeOnly: true,
      }),
    );
    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.id).toBe("doc-1");
    expect(result.results[0]?.score).toBe(0.8);
    expect(result.results[0]?.text).toContain("Semantic retrieval");
    expect(result.diagnostics).toEqual(
      expect.objectContaining({
        vector_hits: 3,
        ranked_vector_hits: 1,
        keyword_hits: 0,
        keyword_fallback_used: false,
        keyword_fallback_due_to_empty_semantic: false,
      }),
    );
    expect(result.diagnostics.query_variants).toHaveLength(5);
    expect(result.diagnostics.query_variants[1]).toEqual(
      expect.objectContaining({ label: "entities", vector_hits: 2 }),
    );
  });

  it("reports when keyword fallback is carrying a broad query", async () => {
    const { MemoryService } = await import("~/domain/service");
    const service = new MemoryService(makeEnv(), makePrincipal());

    mocks.queryMemoryIndex.mockResolvedValue([]);
    mocks.searchDocumentsKeyword.mockResolvedValue([
      makeDocument({ id: "keyword-doc", title: "Keyword only match" }),
    ]);

    const result = await service.searchMemory({
      project: "memory-system-mcp",
      query: "broad architecture direction",
      limit: 5,
    });

    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.id).toBe("keyword-doc");
    expect(result.diagnostics).toEqual(
      expect.objectContaining({
        vector_hits: 0,
        ranked_vector_hits: 0,
        keyword_hits: 1,
        keyword_fallback_used: true,
        keyword_fallback_due_to_empty_semantic: true,
      }),
    );
    expect(result.diagnostics.query_variants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "intent", vector_hits: 0 }),
        expect.objectContaining({ label: "projects", vector_hits: 0 }),
      ]),
    );
  });

  it("ranks exact project keyword fallback ahead of unrelated shared memory", async () => {
    const { MemoryService } = await import("~/domain/service");
    const service = new MemoryService(makeEnv(), makePrincipal());

    mocks.queryMemoryIndex.mockResolvedValue([]);
    mocks.searchDocumentsKeyword.mockResolvedValue([
      makeDocument({
        id: "shared-doc",
        title: "Unrelated shared note",
        project: "shared",
        namespace: "shared",
        memoryType: "current_context",
      }),
      makeDocument({
        id: "project-decision",
        title: "Assistant Context OS decision",
        project: "memory-system-mcp",
        namespace: "memory-system-mcp",
        memoryType: "decision",
      }),
    ]);

    const result = await service.searchMemory({
      project: "memory-system-mcp",
      query: "Assistant Context OS tool orchestration",
      limit: 5,
    });

    expect(result.results[0]?.id).toBe("project-decision");
  });

  it("uses unfiltered vector fallback diagnostics when metadata-filtered search returns no hits", async () => {
    const { MemoryService } = await import("~/domain/service");
    const service = new MemoryService(makeEnv(), makePrincipal());

    mocks.queryMemoryIndex
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([makeHit({ documentId: "doc-1", score: 0.77 })])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await service.searchMemory({
      project: "memory-system-mcp",
      query: "ContextOS environment-aware tool use Claude ChatGPT Codex",
      limit: 5,
    });

    expect(mocks.queryMemoryIndex).toHaveBeenCalledTimes(10);
    expect(mocks.queryMemoryIndex).toHaveBeenLastCalledWith(
      expect.anything(),
      [0.5],
      ["shared", "memory-system-mcp"],
      expect.objectContaining({ filtered: false }),
    );
    expect(result.results[0]?.id).toBe("doc-1");
    expect(result.diagnostics.vector_hits).toBe(1);
    expect((result.diagnostics as { unfiltered_vector_provider?: unknown[] }).unfiltered_vector_provider).toHaveLength(5);
  });

  it("surfaces keyword-only classification through retrieval diagnostics", async () => {
    const { MemoryService } = await import("~/domain/service");
    const service = new MemoryService(makeEnv(), makePrincipal());

    mocks.queryMemoryIndex.mockResolvedValue([]);
    mocks.searchDocumentsKeyword.mockResolvedValue([
      makeDocument({ id: "keyword-doc", title: "Keyword only match" }),
    ]);

    const result = await service.retrievalDiagnostics({
      project: "memory-system-mcp",
      query: "broad architecture direction",
    });

    expect(result.diagnostic_classification).toBe("keyword_fallback_only");
    expect(result.diagnostics).toEqual(
      expect.objectContaining({
        keyword_fallback_due_to_empty_semantic: true,
      }),
    );
    expect(result.likely_causes).toContain(
      "Keyword fallback is carrying this query; broad conceptual recall may be weak.",
    );
  });

  it("excludes inactive archived vector hits by default and allows them with includeSuperseded", async () => {
    const { MemoryService } = await import("~/domain/service");
    const service = new MemoryService(makeEnv(), makePrincipal());

    mocks.queryMemoryIndex.mockResolvedValue([
      makeHit({
        documentId: "archived-doc",
        vectorId: "archived-doc:0",
        status: "archived",
        active: false,
        score: 0.9,
      }),
    ]);
    mocks.getDocumentsByIds.mockResolvedValue(
      new Map([
        [
          "archived-doc",
          makeDocument({
            id: "archived-doc",
            status: "archived",
            active: false,
          }),
        ],
      ]),
    );
    mocks.getChunkContentsByVectorIds.mockResolvedValue(
      new Map([["archived-doc:0", "Archived duplicate Light Lane context."]]),
    );

    const defaultResult = await service.searchMemory({
      project: "memory-system-mcp",
      query: "Light Lane duplicate context",
      limit: 5,
    });
    expect(defaultResult.results).toHaveLength(0);

    const includeResult = await service.searchMemory({
      project: "memory-system-mcp",
      query: "Light Lane duplicate context",
      includeSuperseded: true,
      limit: 5,
    });
    expect(includeResult.results[0]?.id).toBe("archived-doc");
  });

  it("flags degraded retrieval and keeps ranked keyword scores when the vector path throws", async () => {
    const { MemoryService } = await import("~/domain/service");
    const service = new MemoryService(makeEnv(), makePrincipal());

    mocks.queryMemoryIndex.mockRejectedValue(
      new Error("D1_ERROR: variable number must be between ?1 and ?100"),
    );
    mocks.searchDocumentsKeyword.mockResolvedValue([
      makeDocument({
        id: "shared-decision",
        title: "Shared historical decision",
        project: "shared",
        namespace: "shared",
        memoryType: "decision",
      }),
      makeDocument({
        id: "project-context",
        title: "Project current context",
        project: "memory-system-mcp",
        namespace: "memory-system-mcp",
        memoryType: "current_context",
      }),
    ]);

    const result = await service.searchMemory({
      project: "memory-system-mcp",
      query: "current pipeline state",
      limit: 5,
    });

    expect(result.degraded).toBe(true);
    expect(result.retrieval_mode).toBe("keyword_fallback_degraded");
    expect(result.diagnostics.vector_error).toContain("variable number");

    const projectScore = result.results.find((item) => item.id === "project-context")?.score;
    const sharedScore = result.results.find((item) => item.id === "shared-decision")?.score;
    expect(projectScore).toBeDefined();
    expect(sharedScore).toBeDefined();
    expect(projectScore).not.toBe(sharedScore);
    expect(projectScore!).toBeGreaterThan(sharedScore!);
    expect(result.results[0]?.id).toBe("project-context");
  });
});
