import { beforeEach, describe, expect, it, vi } from "vitest";

import type { MemoryPrincipal, MemoryProject, ResolvedMemoryDocument } from "~/domain/memory";

const mocks = vi.hoisted(() => ({
  listProjects: vi.fn(),
  listProjectAliases: vi.fn(),
  listAllDocuments: vi.fn(),
  getProjectStats: vi.fn(),
  recordMigrationAuditEvent: vi.fn(),
  updateProjectProfile: vi.fn(),
  linkMemory: vi.fn(),
  saveSourceEvent: vi.fn(),
  listMigrationAuditEvents: vi.fn(),
  recordWorkdriveCanonicalizationManifest: vi.fn(),
  listWorkdriveCanonicalizationManifests: vi.fn(),
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
    listProjects() {
      return mocks.listProjects();
    }

    listProjectAliases() {
      return mocks.listProjectAliases();
    }

    listAllDocuments(input: unknown) {
      return mocks.listAllDocuments(input);
    }

    getProjectStats(project: string) {
      return mocks.getProjectStats(project);
    }

    recordMigrationAuditEvent(input: unknown) {
      return mocks.recordMigrationAuditEvent(input);
    }

    updateProjectProfile(input: unknown) {
      return mocks.updateProjectProfile(input);
    }

    linkMemory(input: unknown) {
      return mocks.linkMemory(input);
    }

    saveSourceEvent(input: unknown) {
      return mocks.saveSourceEvent(input);
    }

    listMigrationAuditEvents(input: unknown) {
      return mocks.listMigrationAuditEvents(input);
    }

    recordWorkdriveCanonicalizationManifest(input: unknown) {
      return mocks.recordWorkdriveCanonicalizationManifest(input);
    }

    listWorkdriveCanonicalizationManifests(input: unknown) {
      return mocks.listWorkdriveCanonicalizationManifests(input);
    }
  },
}));

describe("memory migration analysis and dry-run", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listProjects.mockResolvedValue([
      makeProject("light-lane", "Light Lane"),
      makeProject("lightlane", "Lightlane"),
    ]);
    mocks.listProjectAliases.mockResolvedValue([]);
    mocks.listAllDocuments.mockResolvedValue([
      makeDocument({
        id: "placeholder",
        project: "memory-system-mcp",
        title: "Bootstrap Placeholder",
        path: "/memory/projects/memory-system-mcp/context/current/placeholder.md",
      }),
    ]);
    mocks.getProjectStats.mockImplementation(async (project: string) =>
      project === "light-lane"
        ? { document_count: 32, current_context_count: 1, active_decision_count: 13, chunk_count: 67, failed_job_count: 0 }
        : { document_count: 2, current_context_count: 0, active_decision_count: 0, chunk_count: 2, failed_job_count: 0 },
    );
    mocks.recordMigrationAuditEvent.mockResolvedValue(undefined);
    mocks.updateProjectProfile.mockResolvedValue(undefined);
    mocks.linkMemory.mockResolvedValue([]);
    mocks.saveSourceEvent.mockResolvedValue(undefined);
    mocks.listMigrationAuditEvents.mockResolvedValue([]);
    mocks.recordWorkdriveCanonicalizationManifest.mockResolvedValue("manifest-1");
    mocks.listWorkdriveCanonicalizationManifests.mockResolvedValue([]);
  });

  it("detects light-lane/lightlane duplicate and defaults run to dry-run", async () => {
    const { MemoryService } = await import("~/domain/service");
    const service = new MemoryService(makeEnv(), makePrincipal());

    const analysis = await service.analyzeMemoryMigration();
    expect(analysis.duplicate_projects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          canonical_project: "light-lane",
          duplicate_project: "lightlane",
        }),
      ]),
    );
    expect(analysis.safety.deletes_workdrive_files).toBe(false);

    const result = await service.runMemoryMigration();
    expect(result.dry_run).toBe(true);
    expect(result.applied).toBe(false);
    expect(mocks.updateProjectProfile).not.toHaveBeenCalled();
    expect(mocks.linkMemory).not.toHaveBeenCalled();
    expect(mocks.recordMigrationAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ dryRun: true, phase: "dry_run" }),
    );
  });

  it("apply mode writes only metadata markers and graph links", async () => {
    const { MemoryService } = await import("~/domain/service");
    const service = new MemoryService(makeEnv(), makePrincipal());

    const result = await service.runMemoryMigration({ dryRun: false, apply: true });

    expect(result.applied).toBe(true);
    expect(mocks.updateProjectProfile).toHaveBeenCalledWith(
      expect.objectContaining({ slug: "lightlane", mergedIntoProject: "light-lane" }),
    );
    expect(mocks.linkMemory).toHaveBeenCalledWith(
      expect.objectContaining({ relation: "merged_into" }),
    );
    expect(mocks.saveSourceEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "memory_reconciliation" }),
    );
  });

  it("builds a WorkDrive-visible canonicalization manifest and records dry-run without copying files", async () => {
    mocks.listProjects.mockResolvedValue([
      makeProject("light-lane", "Light Lane", { workdriveRootFolderId: "canonical-root" }),
      makeProject("lightlane", "Lightlane", {
        workdriveRootFolderId: "duplicate-root",
        canonicalStatus: "merged",
        mergedIntoProject: "light-lane",
      }),
      makeProject("shared", "Shared Memory", { shared: true }),
    ]);
    mocks.listAllDocuments.mockResolvedValue([
      makeDocument({
        id: "duplicate-doc",
        project: "lightlane",
        path: "/memory/projects/lightlane/context/current/overview.md",
        fileName: "overview.md",
      }),
      makeDocument({
        id: "shared-dup",
        project: "shared",
        path: "/memory/shared/context/current/light-lane-current-context 25-04-2026 12:29:46:885.md",
        fileName: "light-lane-current-context 25-04-2026 12:29:46:885.md",
      }),
      makeDocument({
        id: "canonical",
        project: "light-lane",
        path: "/memory/projects/light-lane/context/current/overview.md",
        fileName: "overview.md",
      }),
    ]);
    const { MemoryService } = await import("~/domain/service");
    const service = new MemoryService(makeEnv(), makePrincipal());

    const analysis = await service.analyzeWorkdriveCanonicalization();

    expect(analysis.manifest.archive_copies).toEqual([
      expect.objectContaining({
        from_path: "/memory/projects/lightlane/context/current/overview.md",
        to_path: "/memory/projects/light-lane/_merged/lightlane/context/current/overview.md",
      }),
    ]);
    expect(analysis.manifest.shared_archive_copies).toHaveLength(1);
    expect(analysis.manifest.redirect_files).toHaveLength(2);
    expect(analysis.manifest.safety.deletes_workdrive_files).toBe(false);

    const dryRun = await service.runWorkdriveCanonicalization();
    expect(dryRun.applied).toBe(false);
    expect(mocks.recordWorkdriveCanonicalizationManifest).toHaveBeenCalledWith(
      expect.objectContaining({ dryRun: true, status: "dry_run" }),
    );
    expect(mocks.updateProjectProfile).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: "archived" }),
    );
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

function makeProject(slug: string, displayName: string, overrides: Partial<MemoryProject> = {}): MemoryProject {
  return {
    slug,
    displayName,
    description: null,
    status: "active",
    profile: {},
    ownerLogin: "test",
    shared: false,
    workdriveRootFolderId: null,
    contextCurrentFolderId: null,
    contextHistoryFolderId: null,
    decisionsFolderId: null,
    sessionsFolderId: null,
    snippetsFolderId: null,
    repoIndexFolderId: null,
    lastHealth: null,
    canonicalProject: null,
    mergedIntoProject: null,
    noncanonicalReason: null,
    canonicalStatus: "canonical",
    canonicalUpdatedAt: null,
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeDocument(overrides: Partial<ResolvedMemoryDocument>): ResolvedMemoryDocument {
  return {
    id: "doc-1",
    workdriveFileId: "wd-1",
    currentSnapshotId: "snap-1",
    path: "/memory/projects/example/context/current/overview.md",
    title: "Overview",
    project: "example",
    namespace: "example",
    parentFolderId: "folder",
    fileName: "overview.md",
    permalink: null,
    downloadUrl: null,
    memoryType: "current_context",
    status: "active",
    canonical: true,
    active: true,
    revision: 1,
    tags: [],
    ...overrides,
  };
}
