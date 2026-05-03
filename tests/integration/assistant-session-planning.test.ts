import { beforeEach, describe, expect, it, vi } from "vitest";

import type { MemoryPrincipal, MemoryProject } from "~/domain/memory";

const mocks = vi.hoisted(() => ({
  embedTexts: vi.fn(),
  queryMemoryIndex: vi.fn(),
  getProject: vi.fn(),
  listProjects: vi.fn(),
  listRelatedProjects: vi.fn(),
  listCurrentContextDocuments: vi.fn(),
  listInitiatives: vi.fn(),
  searchEntities: vi.fn(),
  listTasks: vi.fn(),
  listSourceEvents: vi.fn(),
  listFacts: vi.fn(),
  listStrategyNodes: vi.fn(),
  listMilestones: vi.fn(),
  listAssets: vi.fn(),
  getBranchProject: vi.fn(),
  listProjectFolderChecks: vi.fn(),
  getProjectStats: vi.fn(),
  listProjectGithubRepos: vi.fn(),
  searchDocumentsKeyword: vi.fn(),
  getChunkContentsByVectorIds: vi.fn(),
  getDocumentsByIds: vi.fn(),
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

vi.mock("~/integrations/zoho/client", () => ({
  ZohoWorkDriveClient: class {},
}));

vi.mock("~/integrations/github/client", () => ({
  GithubOAuthClient: class {},
}));

vi.mock("~/persistence/d1/repository", () => ({
  MemoryRepository: class {
    getProject(slug: string) {
      return mocks.getProject(slug);
    }

    listProjects() {
      return mocks.listProjects();
    }

    listRelatedProjects(project: string) {
      return mocks.listRelatedProjects(project);
    }

    listCurrentContextDocuments(project?: string) {
      return mocks.listCurrentContextDocuments(project);
    }

    listInitiatives(input: unknown) {
      return mocks.listInitiatives(input);
    }

    searchEntities(input: unknown) {
      return mocks.searchEntities(input);
    }

    listTasks(input: unknown) {
      return mocks.listTasks(input);
    }

    listSourceEvents(input: unknown) {
      return mocks.listSourceEvents(input);
    }

    listFacts(input: unknown) {
      return mocks.listFacts(input);
    }

    listStrategyNodes(input: unknown) {
      return mocks.listStrategyNodes(input);
    }

    listMilestones(input: unknown) {
      return mocks.listMilestones(input);
    }

    listAssets(input: unknown) {
      return mocks.listAssets(input);
    }

    getBranchProject(project: string) {
      return mocks.getBranchProject(project);
    }

    listProjectFolderChecks(project: string) {
      return mocks.listProjectFolderChecks(project);
    }

    getProjectStats(project: string) {
      return mocks.getProjectStats(project);
    }

    listProjectGithubRepos(project: string) {
      return mocks.listProjectGithubRepos(project);
    }

    searchDocumentsKeyword(input: unknown) {
      return mocks.searchDocumentsKeyword(input);
    }

    getChunkContentsByVectorIds(vectorIds: string[]) {
      return mocks.getChunkContentsByVectorIds(vectorIds);
    }

    getDocumentsByIds(documentIds: string[]) {
      return mocks.getDocumentsByIds(documentIds);
    }
  },
}));

describe("MemoryService assistant session reliability planning", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const project = makeProject();
    mocks.getProject.mockResolvedValue(project);
    mocks.listProjects.mockResolvedValue([project]);
    mocks.listRelatedProjects.mockResolvedValue([]);
    mocks.listCurrentContextDocuments.mockResolvedValue([]);
    mocks.listInitiatives.mockResolvedValue([]);
    mocks.searchEntities.mockResolvedValue([]);
    mocks.listTasks.mockResolvedValue([]);
    mocks.listSourceEvents.mockResolvedValue([]);
    mocks.listFacts.mockResolvedValue([]);
    mocks.listStrategyNodes.mockResolvedValue([]);
    mocks.listMilestones.mockResolvedValue([]);
    mocks.listAssets.mockResolvedValue([]);
    mocks.getBranchProject.mockResolvedValue(null);
    mocks.listProjectFolderChecks.mockResolvedValue([]);
    mocks.getProjectStats.mockResolvedValue({
      document_count: 0,
      current_context_count: 0,
      active_decision_count: 0,
      chunk_count: 0,
      failed_job_count: 0,
    });
    mocks.listProjectGithubRepos.mockResolvedValue([]);
    mocks.embedTexts.mockResolvedValue([[0.1], [0.2], [0.3], [0.4], [0.5]]);
    mocks.queryMemoryIndex.mockResolvedValue([]);
    mocks.searchDocumentsKeyword.mockResolvedValue([]);
    mocks.getChunkContentsByVectorIds.mockResolvedValue(new Map());
    mocks.getDocumentsByIds.mockResolvedValue(new Map());
  });

  it("adds reliability fields to prepare_assistant_session without removing existing fields", async () => {
    const { MemoryService } = await import("~/domain/service");
    const service = new MemoryService(makeEnv(), makePrincipal());

    const result = await service.prepareAssistantSession({
      projectOrTopic: "memory-system-mcp",
      userIntent: "Plan customer calls today from the latest CRM status.",
      activeSources: ["zoho_crm"],
      timezone: "Pacific/Auckland",
      now: "2026-05-01T22:30:00.000Z",
    });

    expect(result.active_project.slug).toBe("memory-system-mcp");
    expect(result.context_resolution.project_switching.selected).toBe("memory-system-mcp");
    expect(result.operational_context).toMatchObject({
      timezone: "Pacific/Auckland",
      weekday: "Saturday",
      is_business_day: false,
    });
    expect(result.request_classification.categories).toMatchObject({
      planning_scheduling: true,
      customer_sales_business: true,
      external_source_dependent: true,
    });
    expect(result.actionability.label).toBe("requires_live_context");
    expect(result.tool_plan.required_tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tool: "get_operational_context" }),
        expect.objectContaining({ tool: "zoho_crm" }),
      ]),
    );
    expect(result.write_back_policy.mode).toBe("selective_durable_facts");
    expect(result.strategy_context).toMatchObject({
      project: "memory-system-mcp",
      warnings: ["no_active_vision"],
    });
    expect(result.operating_brief).toMatchObject({
      time_actionability: {
        timezone: "Pacific/Auckland",
        weekday: "Saturday",
        actionability_label: "requires_live_context",
      },
      source_freshness: {
        retrieval_mode: "no_hits",
      },
      write_back_plan: {
        recommendations: expect.arrayContaining([
          expect.objectContaining({ tool: "finish_work_session" }),
        ]),
      },
    });
    expect(result.environment_tool_guidance).toMatchObject({
      environment: {
        slug: "generic_mcp",
      },
      available_capabilities: expect.arrayContaining([
        expect.objectContaining({ capability: "contextos_memory" }),
      ]),
    });
    expect(result.operating_brief.environment_tool_guidance).toMatchObject({
      write_back_policy: {
        mode: "selective_durable_facts",
      },
    });
    expect(result.operating_brief.required_live_checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tool: "get_operational_context", available: true }),
        expect.objectContaining({ tool: "zoho_crm", source_kind: "zoho_crm", available: true }),
      ]),
    );
  });

  it("returns an operating brief and request plan with missing live-tool warnings", async () => {
    const { MemoryService } = await import("~/domain/service");
    const service = new MemoryService(makeEnv(), makePrincipal());

    const result = await service.planRequest({
      projectOrTopic: "memory-system-mcp",
      userIntent: "What should I do next in the repo this week?",
      availableTools: ["prepare_assistant_session"],
      timezone: "Pacific/Auckland",
      now: "2026-05-01T22:30:00.000Z",
    });

    expect(result.operating_brief.required_live_checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tool: "github_project_repos",
          available: false,
          blocking: true,
        }),
        expect.objectContaining({
          tool: "github_search_code",
          available: false,
          blocking: true,
        }),
        expect.objectContaining({
          tool: "github_get_file",
          required: false,
          available: false,
          blocking: false,
        }),
        expect.objectContaining({
          tool: "calendar",
          source_kind: "calendar",
          available: false,
          blocking: true,
        }),
      ]),
    );
    expect(result.operating_brief.risks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "missing_tool",
          summary: "github_project_repos is required but unavailable.",
        }),
        expect.objectContaining({
          type: "missing_tool",
          summary: "calendar is required but unavailable.",
        }),
      ]),
    );
    expect(result.request_plan).toMatchObject({
      objective: "What should I do next in the repo this week?",
      tool_sequence: expect.arrayContaining([
        expect.objectContaining({ tool: "github_project_repos", blocking: true }),
      ]),
      write_back_plan: {
        recommendations: expect.arrayContaining([
          expect.objectContaining({ tool: "finish_work_session" }),
        ]),
      },
    });
    expect(result.environment_tool_guidance).toMatchObject({
      unavailable_required_capabilities: expect.arrayContaining([
        expect.objectContaining({ capability: "github_live" }),
      ]),
    });
  });
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

function makeProject(): MemoryProject {
  return {
    slug: "memory-system-mcp",
    displayName: "Memory System MCP",
    description: null,
    status: "active",
    profile: {},
    ownerLogin: "test",
    shared: false,
    workdriveRootFolderId: "root",
    contextCurrentFolderId: "current",
    contextHistoryFolderId: "history",
    decisionsFolderId: "decisions",
    sessionsFolderId: "sessions",
    snippetsFolderId: "snippets",
    repoIndexFolderId: "repo-index",
    lastHealth: null,
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z",
  };
}
