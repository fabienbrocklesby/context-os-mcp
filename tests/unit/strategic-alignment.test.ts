import { beforeEach, describe, expect, it, vi } from "vitest";

import type { MemoryPrincipal, MemoryProject } from "~/domain/memory";

const mocks = vi.hoisted(() => ({
  getProject: vi.fn(),
  listProjects: vi.fn(),
  listRelatedProjects: vi.fn(),
  listStrategyNodes: vi.fn(),
  listInitiatives: vi.fn(),
  listMilestones: vi.fn(),
  listAssets: vi.fn(),
  getBranchProject: vi.fn(),
  saveAlignmentAssessment: vi.fn(),
}));

vi.mock("~/integrations/workers-ai/embeddings", () => ({
  embedTexts: vi.fn(),
}));

vi.mock("~/integrations/vectorize/client", () => ({
  queryMemoryIndexWithDiagnostics: vi.fn(async () => ({ hits: [], diagnostics: {} })),
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

    listStrategyNodes(input: unknown) {
      return mocks.listStrategyNodes(input);
    }

    listInitiatives(input: unknown) {
      return mocks.listInitiatives(input);
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

    saveAlignmentAssessment(input: unknown) {
      return mocks.saveAlignmentAssessment(input);
    }
  },
}));

describe("strategic alignment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const project = makeProject();
    mocks.getProject.mockResolvedValue(project);
    mocks.listProjects.mockResolvedValue([project]);
    mocks.listRelatedProjects.mockResolvedValue([]);
    mocks.listInitiatives.mockResolvedValue([makeInitiative()]);
    mocks.listMilestones.mockResolvedValue([makeMilestone()]);
    mocks.listAssets.mockResolvedValue([makeAsset()]);
    mocks.getBranchProject.mockResolvedValue(null);
    mocks.saveAlignmentAssessment.mockImplementation(async (input) => ({
      id: "assessment-1",
      createdAt: "2026-05-01T00:00:00.000Z",
      ...(input as Record<string, unknown>),
    }));
    mocks.listStrategyNodes.mockImplementation(async (input: { type?: string }) => {
      if (input.type === "strategic_pillar") {
        return [makeNode("pillar-1", "strategic_pillar", "Reliable planning")];
      }
      if (input.type === "outcome") {
        return [makeNode("outcome-1", "outcome", "Reliable assistant planning")];
      }
      return [
        makeNode("vision-1", "vision", "Helpful assistant context"),
        makeNode("pillar-1", "strategic_pillar", "Reliable planning"),
        makeNode("outcome-1", "outcome", "Reliable assistant planning"),
      ];
    });
  });

  it("classifies work tied to an active outcome as directly advancing strategy", async () => {
    const { MemoryService } = await import("~/domain/service");
    const service = new MemoryService(makeEnv(), makePrincipal());

    const result = await service.checkAlignment({
      projectOrTopic: "context-os-demo",
      userIntent: "Improve reliable assistant planning.",
    });

    expect(result.alignment_assessment).toMatchObject({
      alignmentLabel: "directly_advances",
      score: 2,
      confidence: "medium",
    });
  });

  it("classifies enabling asset work as indirectly supporting strategy", async () => {
    const { MemoryService } = await import("~/domain/service");
    const service = new MemoryService(makeEnv(), makePrincipal());

    const result = await service.checkAlignment({
      projectOrTopic: "context-os-demo",
      userIntent: "Document the repo setup for future contributors.",
      proposedWork: {
        type: "task",
        asset_ids: ["asset-1"],
      },
    });

    expect(result.alignment_assessment).toMatchObject({
      alignmentLabel: "indirectly_supports",
      score: 1,
      confidence: "high",
    });
  });

  it("classifies governed branch work as a neutral experiment", async () => {
    mocks.getBranchProject.mockResolvedValue({
      id: "branch-1",
      status: "active",
      timeboxEndsAt: "2099-01-01T00:00:00.000Z",
      parentInitiativeId: "initiative-1",
    });
    const { MemoryService } = await import("~/domain/service");
    const service = new MemoryService(makeEnv(), makePrincipal());

    const result = await service.checkAlignment({
      projectOrTopic: "context-os-demo",
      userIntent: "Try a small interface experiment.",
      proposedWork: {
        type: "branch_project",
      },
    });

    expect(result.alignment_assessment).toMatchObject({
      alignmentLabel: "neutral_experiment",
      score: 0,
    });
  });

  it("flags large unlinked work as a distraction risk", async () => {
    const { MemoryService } = await import("~/domain/service");
    const service = new MemoryService(makeEnv(), makePrincipal());

    const result = await service.checkAlignment({
      projectOrTopic: "context-os-demo",
      userIntent: "Rewrite the visual style system.",
      proposedWork: {
        estimated_effort: "large",
      },
    });

    expect(result.alignment_assessment).toMatchObject({
      alignmentLabel: "distraction_risk",
      score: -1,
    });
  });

  it("flags kill-condition work as conflicting", async () => {
    const { MemoryService } = await import("~/domain/service");
    const service = new MemoryService(makeEnv(), makePrincipal());

    const result = await service.checkAlignment({
      projectOrTopic: "context-os-demo",
      userIntent: "Continue despite the kill condition.",
    });

    expect(result.alignment_assessment).toMatchObject({
      alignmentLabel: "conflicts",
      score: -2,
      confidence: "high",
    });
  });

  it("returns unknown when no active strategy exists", async () => {
    mocks.listStrategyNodes.mockResolvedValue([]);
    mocks.listInitiatives.mockResolvedValue([]);
    const { MemoryService } = await import("~/domain/service");
    const service = new MemoryService(makeEnv(), makePrincipal());

    const result = await service.checkAlignment({
      projectOrTopic: "context-os-demo",
      userIntent: "Do something useful.",
    });

    expect(result.alignment_assessment).toMatchObject({
      alignmentLabel: "unknown_until_more_context",
      score: 0,
      confidence: "low",
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
    slug: "context-os-demo",
    displayName: "Context OS Demo",
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

function makeNode(id: string, type: string, title: string) {
  return {
    id,
    project: "context-os-demo",
    slug: title.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    type,
    title,
    summary: null,
    status: "active",
    parentId: null,
    horizon: null,
    priority: "normal",
    metricName: null,
    targetValue: null,
    currentValue: null,
    metricUnit: null,
    metricDirection: null,
    startsAt: null,
    dueAt: null,
    reviewCadence: null,
    tags: [],
    metadata: {},
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z",
  };
}

function makeInitiative() {
  return {
    id: "initiative-1",
    slug: "assistant-context",
    title: "Assistant Context",
    summary: null,
    status: "active",
    owner: null,
    horizon: null,
    priority: "normal",
    startsAt: null,
    dueAt: null,
    tags: [],
    metadata: {},
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z",
  };
}

function makeMilestone() {
  return {
    id: "milestone-1",
    slug: "prototype-ready",
    title: "Prototype ready",
    summary: null,
    status: "active",
    initiativeId: "initiative-1",
    projectSlug: "context-os-demo",
    outcomeId: "outcome-1",
    dueAt: "2026-06-01",
    successMetric: "Reviewed prototype",
  };
}

function makeAsset() {
  return {
    id: "asset-1",
    slug: "repo-guide",
    name: "Repo guide",
    type: "document",
    status: "active",
    summary: "Generic contributor guide.",
  };
}
