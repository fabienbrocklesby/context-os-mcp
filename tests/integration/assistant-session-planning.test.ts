import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ContextTask,
  MemoryPrincipal,
  MemoryProject,
  ResolvedMemoryDocument,
  SourceEvent,
} from "~/domain/memory";

const LIGHT_LANE_REPOS = [
  "Light-Lane/LightLane-Site-V2",
  "Light-Lane/Light-Lane-Ruida",
  "Light-Lane/Light-Lane-Portal",
  "Light-Lane/LightLane-App",
  "Light-Lane/Light-Lane-Ruida-CLI",
  "Light-Lane/LightLane-Internal-CRM",
  "Light-Lane/LightLane-Website",
  "Light-Lane/LightLane-Public-Facing-Website",
];

type PreparedSessionAssertions = {
  response_mode: string;
  active_project: { slug: string };
  context_resolution: { project_switching: { selected: string } };
  operational_context: Record<string, unknown>;
  request_classification: { categories: Record<string, unknown> };
  actionability: { label: string };
  tool_plan: { required_tools: unknown[] };
  write_back_policy: { mode: string };
  strategy_context: Record<string, unknown>;
  operating_brief: {
    environment_tool_guidance: unknown;
    required_live_checks: unknown[];
  } & Record<string, unknown>;
  environment_tool_guidance: Record<string, unknown>;
  current_context: {
    items: Array<Record<string, unknown> & { snapshot?: { rawMarkdown?: string } }>;
  };
  grouped_memory: Record<string, unknown>;
  retrieval_guidance: { tools: string[] };
  payload_budget: { serialized_bytes: number };
};

type PlannedRequestAssertions = {
  response_mode: string;
  grouped_memory: Record<string, unknown> | null;
  current_truth: Record<string, unknown> | null;
  active_tasks: Array<Record<string, unknown>>;
  operating_brief: {
    required_live_checks: unknown[];
    risks: unknown[];
  } & Record<string, unknown>;
  request_plan: Record<string, unknown>;
  environment_tool_guidance: Record<string, unknown>;
  retrieval_guidance: { tools: string[] };
  payload_budget: { serialized_bytes: number };
};

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
  getLatestSnapshot: vi.fn(),
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

    getLatestSnapshot(documentId: string) {
      return mocks.getLatestSnapshot(documentId);
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
    mocks.getLatestSnapshot.mockResolvedValue({
      rawMarkdown: "# Context\n\nfull context body",
    });
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
    }) as PreparedSessionAssertions;

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

  it("returns a bounded compact session manifest by default instead of full document bodies", async () => {
    const documents = Array.from({ length: 68 }, (_, index) => makeContextDocument(index));
    mocks.listCurrentContextDocuments.mockResolvedValue(documents);
    mocks.getLatestSnapshot.mockImplementation(async () => ({
      rawMarkdown: `# Full document\n\n${"full context body ".repeat(350)}`,
    }));
    const { MemoryService } = await import("~/domain/service");
    const service = new MemoryService(makeEnv(), makePrincipal());

    const result = await service.prepareAssistantSession({
      projectOrTopic: "memory-system-mcp",
      userIntent: "Prepare for Nelson sales meetings tomorrow.",
      taskProfile: "sales_proposal",
    }) as PreparedSessionAssertions;

    expect(result.response_mode).toBe("compact");
    expect(result.current_context.items).toHaveLength(68);
    expect(result.current_context.items[0]).not.toHaveProperty("snapshot");
    expect(JSON.stringify(result.current_context)).not.toContain("full context body");
    expect(mocks.getLatestSnapshot).not.toHaveBeenCalled();
    expect(result.grouped_memory).not.toHaveProperty("grouped");
    expect(result.retrieval_guidance.tools).toEqual(
      expect.arrayContaining(["search_memory", "resolve_current_truth", "get_current_context", "fetch"]),
    );
    expect(result.payload_budget.serialized_bytes).toBeLessThanOrEqual(64 * 1024);
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(64 * 1024);
    expect(JSON.stringify(result, null, 2).length).toBeLessThanOrEqual(64 * 1024);
  });

  it("retains full current-context material only when expanded session mode is requested", async () => {
    mocks.listCurrentContextDocuments.mockResolvedValue([makeContextDocument(1)]);
    mocks.getLatestSnapshot.mockResolvedValue({
      rawMarkdown: "# Full document\n\nfull context body",
    });
    const { MemoryService } = await import("~/domain/service");
    const service = new MemoryService(makeEnv(), makePrincipal());

    const result = await service.prepareAssistantSession({
      projectOrTopic: "memory-system-mcp",
      userIntent: "Inspect full context.",
      responseMode: "expanded",
    }) as PreparedSessionAssertions;

    expect(result.response_mode).toBe("expanded");
    const item = result.current_context.items[0];
    expect(item).toHaveProperty("snapshot");
    if (!("snapshot" in item)) {
      throw new Error("Expected expanded current-context item to contain a snapshot.");
    }
    expect(item.snapshot?.rawMarkdown).toContain("full context body");
  });

  it("keeps the legacy prepare_work_session wrapper expanded for compatibility", async () => {
    mocks.listCurrentContextDocuments.mockResolvedValue([makeContextDocument(2)]);
    mocks.getLatestSnapshot.mockResolvedValue({
      rawMarkdown: "# Legacy material\n\nfull context body",
    });
    const { MemoryService } = await import("~/domain/service");
    const service = new MemoryService(makeEnv(), makePrincipal());

    const result = await service.prepareWorkSession({
      project: "memory-system-mcp",
      topic: "Legacy client context",
    }) as {
      current_context: {
        items: Array<{ snapshot?: { rawMarkdown?: string } }>;
      };
    };

    expect(result.current_context.items[0]?.snapshot?.rawMarkdown).toContain("full context body");
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
    }) as PlannedRequestAssertions;

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

  it("returns a bounded compact planning response by default", async () => {
    mocks.listTasks.mockResolvedValue(Array.from({ length: 12 }, (_, index) => makeTask(index)));
    mocks.listSourceEvents.mockResolvedValue(Array.from({ length: 10 }, (_, index) => makeSourceEvent(index)));
    const { MemoryService } = await import("~/domain/service");
    const service = new MemoryService(makeEnv(), makePrincipal());

    const result = await service.planRequest({
      projectOrTopic: "memory-system-mcp",
      userIntent: "Prepare for Nelson sales meetings tomorrow.",
      taskProfile: "sales_proposal",
    }) as PlannedRequestAssertions;

    expect(result.response_mode).toBe("compact");
    expect(result.active_tasks).toHaveLength(12);
    expect(String(result.active_tasks[0]?.description).length).toBeLessThanOrEqual(240);
    expect(result.retrieval_guidance.tools).toContain("search_memory");
    expect(result.current_truth).toMatchObject({
      guardrails: expect.any(Object),
    });
    expect(result.payload_budget.serialized_bytes).toBeLessThanOrEqual(64 * 1024);
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(64 * 1024);
    expect(JSON.stringify(result, null, 2).length).toBeLessThanOrEqual(64 * 1024);
    expect(result.operating_brief.current_tasks_milestones).toMatchObject({
      detail_location: "active_tasks",
    });
  });

  it("adds the Light Lane sales proposal context pack and quality gates to plan_request", async () => {
    const lightLane = makeProject({ slug: "light-lane", displayName: "Light Lane" });
    mocks.getProject.mockResolvedValue(lightLane);
    mocks.listProjects.mockResolvedValue([lightLane]);
    mocks.listCurrentContextDocuments.mockResolvedValue([
      { title: "Light Lane Core Identity", path: "identity.md", tags: ["identity"] },
      { title: "Light Lane Offer Map", path: "offer-map.md", tags: ["offer-map"] },
      { title: "Full System Positioning", path: "positioning.md", tags: ["full-system-positioning"] },
      { title: "Sales Rules and Core Sales Thesis", path: "sales.md", tags: ["sales-rules"] },
      { title: "Objections and Answers", path: "objections.md", tags: ["objections"] },
      {
        title: "Technical Guardrails and Claim Boundaries",
        path: "guardrails.md",
        tags: ["technical-guardrails", "claim-boundaries"],
      },
      { title: "Source Trust", path: "source-trust.md", tags: ["source-trust"] },
      { title: "Light Lane Repo Map", path: "repo-map.md", tags: ["repo-map"] },
      { title: "Current Sales State", path: "current-sales-state.md", tags: ["current-sales-state"] },
    ]);
    mocks.listProjectGithubRepos.mockResolvedValue(
      LIGHT_LANE_REPOS.map((repoFullName) => ({ repoFullName })),
    );
    const { MemoryService } = await import("~/domain/service");
    const service = new MemoryService(makeEnv(), makePrincipal());

    const result = await service.planRequest({
      projectOrTopic: "light-lane",
      userIntent: "Write a HamiltonJet proposal that sells the full Light Lane system.",
      includeMemory: false,
      taskProfile: "sales_proposal",
    });

    expect(result.task_profile).toBe("sales_proposal");
    expect(result.required_context_pack.required_documents).toEqual(
      expect.arrayContaining(["full-system-positioning", "core-sales-thesis", "claim-boundaries"]),
    );
    expect(result.context_completeness.missing_sections).toEqual([]);
    expect(result.repo_coverage.complete).toBe(true);
    expect(result.memory_quality_gates).toMatchObject({
      required_context_coverage: true,
      repo_coverage: true,
      business_brain_loaded: true,
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

function makeProject(overrides: Partial<MemoryProject> = {}): MemoryProject {
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
    ...overrides,
  };
}

function makeContextDocument(index: number): ResolvedMemoryDocument {
  return {
    id: `document-${index}`,
    workdriveFileId: `workdrive-${index}`,
    currentSnapshotId: `snapshot-${index}`,
    path: `/memory/projects/memory-system-mcp/context/current/document-${index}.md`,
    title: `Context Document ${index}`,
    project: "memory-system-mcp",
    namespace: "memory-system-mcp",
    parentFolderId: "current",
    fileName: `document-${index}.md`,
    permalink: null,
    downloadUrl: null,
    memoryType: index % 2 === 0 ? "current_context" : "decision",
    status: "active",
    canonical: true,
    active: true,
    revision: 1,
    tags: ["context"],
  };
}

function makeTask(index: number): ContextTask {
  return {
    id: `task-${index}`,
    project: "memory-system-mcp",
    title: `Task ${index}`,
    description: "very large task detail ".repeat(400),
    status: "open",
    priority: index % 2 === 0 ? "high" : "normal",
    dueAt: "2026-05-28T09:00:00+12:00",
    owner: null,
    initiativeId: null,
    entityId: null,
    source: "test",
    sourceUrl: null,
    reminderAt: null,
    metadata: {},
    createdAt: "2026-05-27T00:00:00.000Z",
    updatedAt: "2026-05-27T00:00:00.000Z",
  };
}

function makeSourceEvent(index: number): SourceEvent {
  return {
    id: `event-${index}`,
    project: "memory-system-mcp",
    source: "test",
    sourceId: null,
    eventType: "context_update",
    occurredAt: "2026-05-27T00:00:00.000Z",
    title: `Event ${index}`,
    summary: "very large source event ".repeat(400),
    sensitivity: "internal",
    savePolicy: "durable_summary",
    initiativeId: null,
    entityId: null,
    externalUrl: null,
    metadata: {},
    createdAt: "2026-05-27T00:00:00.000Z",
    updatedAt: "2026-05-27T00:00:00.000Z",
  };
}
