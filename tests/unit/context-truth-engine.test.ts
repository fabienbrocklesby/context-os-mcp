import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  EntityAlias,
  EntityState,
  MemoryEntity,
  MemoryPrincipal,
  MemorySearchHit,
  ResolvedMemoryDocument,
} from "~/domain/memory";

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
  upsertEntity: vi.fn(),
  upsertEntityAliases: vi.fn(),
  upsertEntityState: vi.fn(),
  recordContextTruthMigrationManifest: vi.fn(),
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

    upsertEntity(input: unknown) {
      return mocks.upsertEntity(input);
    }

    upsertEntityAliases(input: unknown) {
      return mocks.upsertEntityAliases(input);
    }

    upsertEntityState(input: unknown) {
      return mocks.upsertEntityState(input);
    }

    recordContextTruthMigrationManifest(input: unknown) {
      return mocks.recordContextTruthMigrationManifest(input);
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

function makeEntity(overrides: Partial<MemoryEntity> = {}): MemoryEntity {
  return {
    id: "entity-1",
    project: "light-lane",
    type: "deal",
    slug: "acme-jet",
    name: "Acme Jet",
    summary: "Large current opportunity",
    source: "manual",
    sourceId: null,
    confidence: 0.92,
    metadata: {},
    createdAt: "2026-05-20T00:00:00.000Z",
    updatedAt: "2026-05-22T00:00:00.000Z",
    ...overrides,
  };
}

function makeAlias(overrides: Partial<EntityAlias> = {}): EntityAlias {
  return {
    id: "alias-1",
    project: "light-lane",
    entityId: "entity-1",
    alias: "Acme Jet",
    normalizedAlias: "acme jet",
    source: "manual",
    confidence: 0.95,
    createdAt: "2026-05-20T00:00:00.000Z",
    updatedAt: "2026-05-22T00:00:00.000Z",
    entity: makeEntity(),
    ...overrides,
  };
}

function makeState(overrides: Partial<EntityState> = {}): EntityState {
  return {
    id: "state-1",
    project: "light-lane",
    entityId: "entity-1",
    stateKey: "deal_stage",
    value: "proposal_sent",
    valueJson: "proposal_sent",
    status: "active",
    confidence: 0.9,
    source: "manual",
    sourceId: null,
    sourceEventId: "event-1",
    validFrom: "2026-05-22T00:00:00.000Z",
    validUntil: null,
    supersededByStateId: null,
    observedAt: "2026-05-22T00:00:00.000Z",
    createdAt: "2026-05-22T00:00:00.000Z",
    updatedAt: "2026-05-22T00:00:00.000Z",
    ...overrides,
  };
}

function makeHit(overrides: Partial<MemorySearchHit> = {}): MemorySearchHit {
  return {
    documentId: "doc-1",
    snapshotId: "snap-1",
    vectorId: "doc-1:0",
    title: "Old Acme Jet note",
    path: "/memory/projects/light-lane/context/current/acme-jet.md",
    project: "light-lane",
    namespace: "light-lane",
    workdriveFileId: "wd-1",
    memoryType: "current_context",
    status: "active",
    active: true,
    superseded: false,
    revision: 1,
    headingPath: "Deal",
    chunkIndex: 0,
    chunkText: "",
    score: 0.6,
    updatedAtUnix: 1_800_000_000,
    ...overrides,
  };
}

function makeDocument(overrides: Partial<ResolvedMemoryDocument> = {}): ResolvedMemoryDocument {
  return {
    id: "doc-1",
    workdriveFileId: "wd-1",
    currentSnapshotId: "snap-1",
    path: "/memory/projects/light-lane/context/current/acme-jet.md",
    title: "Old Acme Jet note",
    project: "light-lane",
    namespace: "light-lane",
    parentFolderId: "folder-1",
    fileName: "acme-jet.md",
    permalink: "https://workdrive.example.com/doc-1",
    downloadUrl: null,
    memoryType: "current_context",
    status: "active",
    canonical: true,
    active: true,
    revision: 1,
    tags: ["sales"],
    ...overrides,
  };
}

describe("Context Truth Engine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.embedTexts.mockResolvedValue([[0.1], [0.2], [0.3], [0.4], [0.5]]);
    mocks.queryMemoryIndex.mockResolvedValue([]);
    mocks.getChunkContentsByVectorIds.mockResolvedValue(new Map());
    mocks.getDocumentsByIds.mockResolvedValue(new Map());
    mocks.searchDocumentsKeyword.mockResolvedValue([]);
    mocks.getProjectStats.mockResolvedValue({ document_count: 1, chunk_count: 1 });
    mocks.searchEntityAliases.mockResolvedValue([]);
    mocks.searchEntities.mockResolvedValue([]);
    mocks.listEntityStatesForEntities.mockResolvedValue([]);
    mocks.upsertEntity.mockResolvedValue(makeEntity());
    mocks.upsertEntityAliases.mockResolvedValue([makeAlias()]);
    mocks.upsertEntityState.mockResolvedValue(makeState());
    mocks.recordContextTruthMigrationManifest.mockResolvedValue("manifest-1");
  });

  it("resolves exact aliases inside broader current-state queries before semantic memory", async () => {
    const { MemoryService } = await import("~/domain/service");
    const service = new MemoryService(makeEnv(), makePrincipal());
    mocks.searchEntityAliases.mockResolvedValue([makeAlias()]);
    mocks.listEntityStatesForEntities.mockResolvedValue([
      makeState(),
      makeState({ id: "state-2", stateKey: "next_action", value: "confirm decision meeting", valueJson: "confirm decision meeting" }),
    ]);

    const truth = await service.resolveCurrentTruth({
      project: "light-lane",
      query: "what is the latest Acme Jet deal status and next action?",
    });

    expect(mocks.searchEntityAliases).toHaveBeenCalledWith(
      expect.objectContaining({
        project: "light-lane",
        query: "what is the latest Acme Jet deal status and next action?",
      }),
    );
    expect(truth.entities[0]).toMatchObject({
      entity: expect.objectContaining({ name: "Acme Jet" }),
      evidence_grade: "current_structured",
      states: {
        deal_stage: expect.objectContaining({ value: "proposal_sent" }),
        next_action: expect.objectContaining({ value: "confirm decision meeting" }),
      },
    });
    expect(truth.guardrails.current_state_required).toBe(true);
    expect(truth.warnings).toEqual([]);
  });

  it("warns instead of letting old semantic matches stand in for missing current state", async () => {
    const { MemoryService } = await import("~/domain/service");
    const service = new MemoryService(makeEnv(), makePrincipal());
    mocks.searchEntityAliases.mockResolvedValue([makeAlias()]);
    mocks.listEntityStatesForEntities.mockResolvedValue([]);
    mocks.queryMemoryIndex.mockResolvedValue([makeHit()]);
    mocks.getChunkContentsByVectorIds.mockResolvedValue(
      new Map([["doc-1:0", "Acme Jet was once marked hot in an older planning note."]]),
    );
    mocks.getDocumentsByIds.mockResolvedValue(new Map([["doc-1", makeDocument()]]));

    const result = await service.searchMemory({
      project: "light-lane",
      query: "how do I get money quick from Acme Jet today?",
      limit: 5,
    });

    expect(result.current_truth.guardrails.current_state_required).toBe(true);
    expect(result.current_truth.warnings[0]).toContain("No active current-state records");
    expect(result.current_truth.required_live_checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source_kind: "zoho_crm" }),
        expect.objectContaining({ source_kind: "zoho_mail" }),
      ]),
    );
    expect(result.results[0]).toEqual(
      expect.objectContaining({
        evidence_grade: "historical_document",
        current_truth_warning: expect.stringContaining("No active current-state records"),
      }),
    );
  });

  it("defaults context truth migration to dry-run and never writes snippets during analysis", async () => {
    const { MemoryService } = await import("~/domain/service");
    const service = new MemoryService(makeEnv(), makePrincipal());

    const result = await service.importAiBrainVault({
      project: "light-lane",
      vaultName: "Light Lane AI Brain",
      files: [
        {
          path: "00 Load First/llm-entrypoint.md",
          markdown: "---\npriority: load-first\n---\n# LLM Entrypoint\n\nLoad this first.",
        },
        {
          path: "06 AI Operating Rules/Source Trust Levels.md",
          markdown: "# Source Trust Levels\n\nCurrent conversation beats old notes.",
        },
      ],
    });

    expect(result.dry_run).toBe(true);
    expect(result.applied).toBe(false);
    expect(result.analysis.counts.files_seen).toBe(2);
    expect(result.analysis.proposed_documents[0]).toMatchObject({
      memory_type: "current_context",
      priority: "load-first",
    });
    expect(mocks.recordContextTruthMigrationManifest).toHaveBeenCalledWith(
      expect.objectContaining({ dryRun: true, status: "dry_run" }),
    );
  });
});
