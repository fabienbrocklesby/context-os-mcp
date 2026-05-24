import { beforeEach, describe, expect, it, vi } from "vitest";

import type { MemoryPrincipal, ResolvedMemoryDocument } from "~/domain/memory";

const mocks = vi.hoisted(() => ({
  listAllDocuments: vi.fn(),
  listProjectGithubRepos: vi.fn(),
  recordContextTruthMigrationManifest: vi.fn(),
  updateContextDocument: vi.fn(),
  upsertEntity: vi.fn(),
  upsertEntityAliases: vi.fn(),
  upsertEntityState: vi.fn(),
  saveSourceEvent: vi.fn(),
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
    listAllDocuments(input: unknown) {
      return mocks.listAllDocuments(input);
    }

    listProjectGithubRepos(project: string) {
      return mocks.listProjectGithubRepos(project);
    }

    recordContextTruthMigrationManifest(input: unknown) {
      return mocks.recordContextTruthMigrationManifest(input);
    }

    updateContextDocument(input: unknown) {
      return mocks.updateContextDocument(input);
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

    saveSourceEvent(input: unknown) {
      return mocks.saveSourceEvent(input);
    }
  },
}));

describe("Light Lane memory recovery service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listAllDocuments.mockResolvedValue([
      makeDocument({
        id: "shared-fully-promoted",
        project: "shared",
        title: "Fully Promoted Nelson (Cristy Aydon)",
        path: "/memory/shared/context/current/fully-promoted-cristy-aydon.md",
      }),
      makeDocument({
        id: "shared-product-offering",
        project: "shared",
        title: "Product Offering",
        path: "/memory/shared/context/current/product-offering.md",
      }),
      makeDocument({
        id: "ruida",
        project: "light-lane",
        title: "Ruida Driver Current Context",
        path: "/memory/projects/light-lane/context/current/ruida-driver-current-context.md",
      }),
    ]);
    mocks.listProjectGithubRepos.mockResolvedValue([
      { repoFullName: "light-lane/light-lane-ruida" },
    ]);
    mocks.recordContextTruthMigrationManifest.mockResolvedValue("light-lane-memory-recovery-light-lane");
    mocks.saveSourceEvent.mockResolvedValue(undefined);
  });

  it("analyzes live D1 documents, AI Brain payload, and associated repos into an apply-ready manifest", async () => {
    const { MemoryService } = await import("~/domain/service");
    const service = new MemoryService(makeEnv(), makePrincipal());

    const result = await service.analyzeLightLaneMemoryRecovery({
      aiBrainFiles: makeVaultFiles(),
    });

    expect(mocks.listAllDocuments).toHaveBeenCalledWith({ limit: 5000 });
    expect(mocks.listProjectGithubRepos).toHaveBeenCalledWith("light-lane");
    expect(result.quality_gates.ready_to_apply).toBe(true);
    expect(result.misplaced_shared_documents.map((doc) => doc.id)).toEqual([
      "shared-fully-promoted",
      "shared-product-offering",
    ]);
    expect(result.repo_actions.missing).toContain("Light-Lane/LightLane-App");
  });

  it("defaults run mode to dry-run and records a manifest without mutating memory", async () => {
    const { MemoryService } = await import("~/domain/service");
    const service = new MemoryService(makeEnv(), makePrincipal());

    const result = await service.runLightLaneMemoryRecovery({
      aiBrainFiles: makeVaultFiles(),
    });

    expect(result).toMatchObject({
      dry_run: true,
      applied: false,
      manifest_id: "light-lane-memory-recovery-light-lane",
    });
    expect(mocks.recordContextTruthMigrationManifest).toHaveBeenCalledWith(
      expect.objectContaining({
        migrationSlug: "light-lane-memory-recovery",
        project: "light-lane",
        dryRun: true,
        status: "dry_run",
      }),
    );
    expect(mocks.updateContextDocument).not.toHaveBeenCalled();
    expect(mocks.upsertEntityState).not.toHaveBeenCalled();
  });

  it("apply mode imports the AI Brain, writes canonical docs, routes deals, archives shared docs, and indexes repos", async () => {
    const { MemoryService } = await import("~/domain/service");
    const service = new MemoryService(makeEnv(), makePrincipal());
    const importSpy = vi.spyOn(service, "importAiBrainVault").mockResolvedValue({
      dry_run: false,
      applied: true,
      current_context_written: 13,
      snippets_written: 50,
      links_written: 218,
    } as never);
    const updateSpy = vi.spyOn(service, "updateContextDocument").mockResolvedValue({
      path: "/memory/projects/light-lane/context/current/identity.md",
      workdrive_file_id: "wd-1",
      job_id: "job-1",
    } as never);
    const stateSpy = vi.spyOn(service, "upsertEntityState").mockResolvedValue({
      entity: { id: "entity-1", name: "Fully Promoted Nelson" },
      state: { id: "state-1", stateKey: "budget_status", value: "no_budget" },
      aliases: [],
    } as never);
    const archiveSpy = vi.spyOn(service, "archiveLightLaneRecoveryDocuments").mockResolvedValue({
      documents_archived: 2,
      archive_results: [],
    } as never);
    const associateSpy = vi.spyOn(service, "associateGithubRepo").mockResolvedValue({
      project: { slug: "light-lane" },
      repo: { repo: "Light-Lane/LightLane-App" },
    } as never);
    const indexSpy = vi.spyOn(service, "indexGithubRepoOverview").mockResolvedValue({
      job_id: "repo-job",
      saved: { path: "/memory/projects/light-lane/repo-index/repo.md" },
      indexed_files: [],
      skipped: [],
    } as never);

    const result = await service.runLightLaneMemoryRecovery({
      aiBrainFiles: makeVaultFiles(),
      apply: true,
      dryRun: false,
      knownDealUpdates: [
        {
          entityName: "Fully Promoted Nelson",
          source: "user_report",
          confidence: 0.8,
          states: {
            budget_status: "no_budget",
            timing: "delayed_to_next_year",
          },
        },
      ],
    });

    expect(result.applied).toBe(true);
    expect(importSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        project: "light-lane",
        apply: true,
        dryRun: false,
        preserveWikilinks: true,
        applyLinks: true,
        currentContextPriorities: ["load-first", "high"],
      }),
    );
    expect(updateSpy).toHaveBeenCalledTimes(9);
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        project: "light-lane",
        path: "/memory/projects/light-lane/context/current/identity.md",
      }),
    );
    expect(stateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        project: "light-lane",
        entityName: "Fully Promoted Nelson",
        stateKey: "budget_status",
        value: "no_budget",
      }),
    );
    expect(archiveSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        actions: expect.arrayContaining([
          expect.objectContaining({ document_id: "shared-fully-promoted" }),
        ]),
      }),
    );
    expect(associateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ project: "light-lane", repo: "Light-Lane/LightLane-App" }),
    );
    expect(indexSpy).toHaveBeenCalledWith(
      expect.objectContaining({ project: "light-lane", repo: "Light-Lane/LightLane-App" }),
    );
    expect(mocks.recordContextTruthMigrationManifest).toHaveBeenCalledWith(
      expect.objectContaining({
        migrationSlug: "light-lane-memory-recovery",
        project: "light-lane",
        dryRun: false,
        status: "applied",
      }),
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

function makeDocument(overrides: Partial<ResolvedMemoryDocument>): ResolvedMemoryDocument {
  return {
    id: "doc-1",
    title: "Doc",
    project: "light-lane",
    memoryType: "current_context",
    status: "active",
    active: true,
    canonical: true,
    path: "/memory/projects/light-lane/context/current/doc.md",
    namespace: "light-lane",
    parentFolderId: "folder-1",
    fileName: "doc.md",
    permalink: null,
    downloadUrl: null,
    workdriveFileId: "wd-1",
    currentSnapshotId: "snap-1",
    revision: 1,
    tags: [],
    source: "manual",
    sourceUrl: null,
    confidence: 0.8,
    usefulness: 0.8,
    lastRemoteModifiedAt: null,
    supersededByDocumentId: null,
    ...overrides,
  };
}

function makeVaultFiles() {
  return Array.from({ length: 63 }, (_, index) => {
    const fileNumber = index + 1;
    const priority = fileNumber <= 12 ? "load-first" : fileNumber === 13 ? "high" : "normal";
    const linkCount = fileNumber <= 29 ? 4 : 3;
    const links = Array.from({ length: linkCount }, (_, linkIndex) => {
      const target = ((index + linkIndex + 1) % 63) + 1;
      return `[[Brain Note ${String(target).padStart(2, "0")}]]`;
    }).join(" ");
    return {
      path: `folder/Brain Note ${String(fileNumber).padStart(2, "0")}.md`,
      markdown: `---\nstable_id: ll-brain-${fileNumber}\npriority: ${priority}\n---\n# Brain Note ${String(fileNumber).padStart(2, "0")}\n\n${links}\n`,
    };
  });
}
