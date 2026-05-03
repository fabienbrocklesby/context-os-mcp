import { beforeEach, describe, expect, it, vi } from "vitest";

import type { MemoryPrincipal, MemorySearchHit, ResolvedMemoryDocument } from "~/domain/memory";

const mocks = vi.hoisted(() => ({
  embedTexts: vi.fn(),
  queryMemoryIndexWithDiagnostics: vi.fn(),
  getChunkContentsByVectorIds: vi.fn(),
  getDocumentsByIds: vi.fn(),
  searchDocumentsKeyword: vi.fn(),
  getProjectStats: vi.fn(),
}));

vi.mock("~/integrations/workers-ai/embeddings", () => ({
  embedTexts: (...args: unknown[]) => mocks.embedTexts(...args),
}));

vi.mock("~/integrations/vectorize/client", () => ({
  queryMemoryIndexWithDiagnostics: (...args: unknown[]) => mocks.queryMemoryIndexWithDiagnostics(...args),
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
  },
}));

vi.mock("~/integrations/zoho/client", () => ({
  ZohoWorkDriveClient: class {},
}));

vi.mock("~/integrations/github/client", () => ({
  GithubOAuthClient: class {},
}));

const FAILURE_QUERIES = [
  "smart AI ContextOS MCP full connected tool router MCP servers Zoho GitHub WorkDrive vector retrieval outdated notes Obsidian graph memory links",
  "make my AI smarter ContextOS tool orchestration",
  "what should I do next for Assistant Context OS",
  "ContextOS environment-aware tool use Claude ChatGPT Codex",
  "Light Lane duplicate project migration",
  "old placeholder current context docs superseded",
];

describe("retrieval regression evals", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.embedTexts.mockResolvedValue([[0.1], [0.2], [0.3], [0.4], [0.5]]);
    mocks.queryMemoryIndexWithDiagnostics.mockResolvedValue({
      hits: [makeHit()],
      diagnostics: {
        metadata_return_mode: "all",
        raw_match_count: 1,
        hydrated_hit_count: 1,
        rejected_counts: {},
      },
    });
    mocks.getChunkContentsByVectorIds.mockResolvedValue(
      new Map([["assistant-context-os:0", "Assistant Context OS should become environment-aware tool orchestration."]]),
    );
    mocks.getDocumentsByIds.mockResolvedValue(new Map([["assistant-context-os", makeDocument()]]));
    mocks.searchDocumentsKeyword.mockResolvedValue([
      makeDocument({
        id: "shared-light-lane",
        title: "Unrelated shared Light Lane deal note",
        project: "shared",
        namespace: "shared",
        memoryType: "current_context",
      }),
    ]);
    mocks.getProjectStats.mockResolvedValue({ document_count: 48, chunk_count: 52 });
  });

  for (const query of FAILURE_QUERIES) {
    it(`keeps semantic recall alive for: ${query.slice(0, 45)}`, async () => {
      const { MemoryService } = await import("~/domain/service");
      const service = new MemoryService(makeEnv(), makePrincipal());

      const result = await service.searchMemory({
        project: "memory-system-mcp",
        query,
        limit: 5,
      });

      expect(result.diagnostics.vector_hits).toBeGreaterThan(0);
      expect(result.diagnostics.ranked_vector_hits).toBeGreaterThan(0);
      expect(result.results[0]).toMatchObject({
        id: "assistant-context-os",
        project: "memory-system-mcp",
      });
      expect(result.results[0]?.title).toContain("Assistant Context OS");
    });
  }
});

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
    documentId: "assistant-context-os",
    snapshotId: "snap-1",
    vectorId: "assistant-context-os:0",
    title: "Assistant Context OS should evolve from memory retrieval into a goal, time, and tool orchestration system",
    path: "/memory/projects/memory-system-mcp/decisions/assistant-context-os.md",
    project: "memory-system-mcp",
    namespace: "memory-system-mcp",
    workdriveFileId: "wd-1",
    memoryType: "decision",
    status: "active",
    active: true,
    superseded: false,
    revision: 1,
    headingPath: "Decision",
    chunkIndex: 0,
    chunkText: "",
    score: 0.82,
    updatedAtUnix: 1_800_000_000,
    ...overrides,
  };
}

function makeDocument(overrides: Partial<ResolvedMemoryDocument> = {}): ResolvedMemoryDocument {
  return {
    id: "assistant-context-os",
    workdriveFileId: "wd-1",
    currentSnapshotId: "snap-1",
    path: "/memory/projects/memory-system-mcp/decisions/assistant-context-os.md",
    title: "Assistant Context OS should evolve from memory retrieval into a goal, time, and tool orchestration system",
    project: "memory-system-mcp",
    namespace: "memory-system-mcp",
    parentFolderId: "folder-1",
    fileName: "assistant-context-os.md",
    permalink: "https://workdrive.example.com/assistant-context-os",
    downloadUrl: null,
    memoryType: "decision",
    status: "active",
    canonical: true,
    active: true,
    revision: 1,
    tags: ["assistant-context-os"],
    ...overrides,
  };
}
