import { loadConfig } from "~/config/env";
import { buildAssistantActionPlan } from "~/domain/assistant-planning";
import {
  defaultClientEnvironments,
  defaultEnvironmentCapabilities,
  defaultToolCapabilities,
  planEnvironmentToolUse,
} from "~/domain/environment-capabilities";
import { parseMarkdownDocument } from "~/domain/frontmatter";
import { buildLightLaneLiveStatePlan, buildZohoExternalWritePlan } from "~/domain/light-lane-live-state";
import {
  buildLogicalPath,
  buildMarkdownDocument,
  isRetrievableMemoryStatus,
  normalizeProject,
  slugify,
  type MemoryFrontmatter,
  type MemoryPrincipal,
  type MemoryProject,
} from "~/domain/memory";
import { indexMarkdownDocument, type IndexQueueMessage } from "~/domain/service";
import { GithubOAuthClient } from "~/integrations/github/client";
import { ZohoWorkDriveClient, type ZohoFile } from "~/integrations/zoho/client";
import type { DocumentRepository } from "~/persistence/d1/DocumentRepository";
import type { ProjectRepository } from "~/persistence/d1/ProjectRepository";

export class ProjectService {
  private readonly config: ReturnType<typeof loadConfig>;
  private readonly github: GithubOAuthClient;

  constructor(
    private readonly env: Env,
    private readonly principal: MemoryPrincipal,
    private readonly projectRepo: ProjectRepository,
    private readonly docRepo: DocumentRepository,
    private readonly zoho: ZohoWorkDriveClient,
    config?: ReturnType<typeof loadConfig>,
  ) {
    this.config = config ?? loadConfig(env);
    this.github = new GithubOAuthClient(env, this.config.github, principal);
  }

  // ---------------------------------------------------------------------------
  // Project CRUD
  // ---------------------------------------------------------------------------

  async ensureProject(input: {
    project?: string;
    displayName?: string;
    description?: string;
    aliases?: string[];
    profile?: Record<string, unknown>;
  }) {
    const project = normalizeProject(input.project);
    const displayName = input.displayName ?? titleFromSlug(project);
    const existing = await this.projectRepo.getProject(project);
    if (existing && projectHasFolderIds(existing)) {
      let saved = existing;
      if (input.displayName || input.description !== undefined || input.profile || input.aliases?.length) {
        saved = (await this.projectRepo.updateProjectProfile({
          slug: project,
          displayName: input.displayName,
          description: input.description,
          profile: input.profile,
          aliases: input.aliases?.map((alias) => normalizeProject(alias)),
        }))!;
      }
      return { project: saved, folders: projectFolderSummary(saved), created: [] };
    }
    await this.projectRepo.upsertProject({
      slug: project,
      displayName,
      description: input.description ?? null,
      status: "active",
      profile: input.profile,
      ownerLogin: this.principal.login,
      shared: project === "shared",
    });
    const folders = await resolveMemoryFolders(this.zoho, this.config, project, {
      createMissing: true,
      record: async (folderPath, folderId, status, error) => {
        await this.projectRepo.recordProjectFolderCheck({
          projectSlug: project,
          folderPath,
          folderId,
          status,
          error,
        });
      },
    });
    const saved = await this.projectRepo.upsertProject({
      slug: project,
      displayName,
      description: input.description ?? null,
      status: "active",
      profile: input.profile,
      ownerLogin: this.principal.login,
      shared: project === "shared",
      workdriveRootFolderId: folders.root.id,
      contextCurrentFolderId: folders.contextCurrent.id,
      contextHistoryFolderId: folders.contextHistory.id,
      decisionsFolderId: folders.decisions.id,
      sessionsFolderId: folders.sessions.id,
      snippetsFolderId: folders.snippets.id,
      repoIndexFolderId: folders.repoIndex.id,
    });
    if (input.aliases?.length) {
      await this.projectRepo.updateProjectProfile({
        slug: project,
        aliases: input.aliases.map((alias) => normalizeProject(alias)),
      });
    }
    return {
      project: saved,
      folders: folderSummary(folders),
      created: folders.created.map((folder) => ({ id: folder.id, name: folder.name, parent_id: folder.parentId })),
    };
  }

  async listProjects(input: { includeMerged?: boolean; includeArchived?: boolean } = {}) {
    return { projects: await this.projectRepo.listProjects(input) };
  }

  async getProject(input: { project: string }) {
    const project = await this.projectRepo.getProject(normalizeProject(input.project));
    if (!project) throw new Error(`Project ${input.project} not found.`);
    return {
      project,
      github_repos: await this.projectRepo.listProjectGithubRepos(project.slug),
      folder_checks: await this.projectRepo.listProjectFolderChecks(project.slug),
      stats: await this.projectRepo.getProjectStats(project.slug),
    };
  }

  async updateProjectProfile(input: {
    project: string;
    displayName?: string;
    description?: string | null;
    status?: "active" | "paused" | "archived";
    profile?: Record<string, unknown>;
    aliases?: string[];
    parentInitiative?: string | null;
    relatedProjects?: string[];
    canonicalProject?: string | null;
    mergedIntoProject?: string | null;
  }) {
    await this.ensureProject({
      project: input.project,
      displayName: input.displayName,
      description: input.description ?? undefined,
      profile: input.profile,
    });
    return {
      project: await this.projectRepo.updateProjectProfile({
        slug: normalizeProject(input.project),
        displayName: input.displayName,
        description: input.description,
        status: input.status,
        profile: mergeProjectProfile(input.profile, {
          parent_initiative: input.parentInitiative,
          related_projects: input.relatedProjects?.map((p) => normalizeProject(p)),
          canonical_project: input.canonicalProject ? normalizeProject(input.canonicalProject) : undefined,
          merged_into_project: input.mergedIntoProject ? normalizeProject(input.mergedIntoProject) : undefined,
        }),
        aliases: input.aliases?.map((alias) => normalizeProject(alias)),
      }),
    };
  }

  async projectStatus(input: { project: string }) {
    const project = await this.projectRepo.getProject(normalizeProject(input.project));
    if (!project) throw new Error(`Project ${input.project} not found.`);
    const folderChecks = await this.projectRepo.listProjectFolderChecks(project.slug);
    const stats = await this.projectRepo.getProjectStats(project.slug);
    const missingFolders = folderChecks.filter((check) => check.status !== "ok");
    return {
      project,
      health: {
        ok: missingFolders.length === 0 && stats.failed_job_count === 0,
        missing_folders: missingFolders,
        stats,
      },
      github_repos: await this.projectRepo.listProjectGithubRepos(project.slug),
    };
  }

  // ---------------------------------------------------------------------------
  // GitHub operations
  // ---------------------------------------------------------------------------

  async listGithubRepos(input: { query?: string; owner?: string; limit?: number }) {
    return this.github.listRepos(input);
  }

  async getGithubFile(input: { repo: string; path: string; ref?: string; maxBytes?: number }) {
    return this.github.getFile(input);
  }

  async inspectGithubRepoStructure(input: { repo: string; ref?: string; maxEntries?: number }) {
    const root = await this.github.listDirectory({ repo: input.repo, ref: input.ref });
    const interestingDirs = root.entries
      .filter((entry) => entry.type === "dir")
      .filter((entry) => ["src", "docs", "migrations", "tests", ".github"].includes(entry.name))
      .slice(0, 8);
    const nested = await Promise.all(
      interestingDirs.map(async (entry) => {
        try {
          return await this.github.listDirectory({ repo: input.repo, path: entry.path, ref: input.ref });
        } catch (error) {
          return {
            repo: input.repo.toLowerCase(),
            path: entry.path,
            ref: input.ref ?? null,
            entries: [],
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }),
    );
    const maxEntries = input.maxEntries ?? 200;
    return {
      root: { ...root, entries: root.entries.slice(0, maxEntries) },
      directories: nested.map((dir) => ({
        ...dir,
        entries: dir.entries.slice(0, Math.max(20, Math.floor(maxEntries / 5))),
      })),
    };
  }

  async searchGithubCode(input: { query: string; repos?: string[]; owner?: string; limit?: number }) {
    return this.github.searchCode(input);
  }

  async associateGithubRepo(input: { project: string; repo: string }) {
    const ensured = await this.ensureProject({ project: input.project });
    const repos = await this.github.listRepos({ query: input.repo, limit: 100 });
    const match = repos.results.find((repo) => repo.repo.toLowerCase() === input.repo.toLowerCase());
    if (!match) throw new Error(`GitHub repo ${input.repo} is not visible to the connected account.`);
    await this.projectRepo.associateGithubRepo({
      projectSlug: ensured.project!.slug,
      repoFullName: match.repo,
      defaultBranch: match.default_branch,
      visibility: match.private ? "private" : "public",
      htmlUrl: match.url,
      description: match.description,
      associatedBy: this.principal.login,
    });
    return { project: ensured.project, repo: match };
  }

  async listProjectGithubRepos(input: { project: string }) {
    return { repos: await this.projectRepo.listProjectGithubRepos(normalizeProject(input.project)) };
  }

  async indexGithubRepoOverview(input: {
    project: string;
    repo: string;
    ref?: string;
    globs?: string[];
    maxFiles?: number;
    maxBytesPerFile?: number;
    authorClient?: string;
  }) {
    await this.associateGithubRepo({ project: input.project, repo: input.repo });
    const project = normalizeProject(input.project);
    const repo = input.repo.toLowerCase();
    const jobId = await this.projectRepo.createRepoIndexJob({
      projectSlug: project,
      repoFullName: repo,
      ref: input.ref,
      mode: input.globs?.length ? "explicit_globs" : "overview",
      globs: input.globs,
      limits: { max_files: input.maxFiles ?? 12, max_bytes_per_file: input.maxBytesPerFile ?? 80_000 },
    });
    try {
      const structure = await this.inspectGithubRepoStructure({ repo, ref: input.ref });
      const candidates = selectRepoOverviewFiles(structure.root.entries, input.globs);
      const fetched: Array<{ path: string; sha: string; size: number; content: string; url: string | null }> = [];
      const skipped: Array<{ path: string; reason: string }> = [];
      for (const candidate of candidates.slice(0, input.maxFiles ?? 12)) {
        const unsafeReason = unsafeRepoPathReason(candidate.path);
        if (unsafeReason) { skipped.push({ path: candidate.path, reason: unsafeReason }); continue; }
        try {
          const file = await this.github.getFile({ repo, path: candidate.path, ref: input.ref, maxBytes: input.maxBytesPerFile ?? 80_000 });
          const secretReason = secretContentReason(file.content);
          if (secretReason) { skipped.push({ path: candidate.path, reason: secretReason }); continue; }
          fetched.push({ path: file.path, sha: file.sha, size: file.size, content: file.content, url: file.htmlUrl });
        } catch (error) {
          skipped.push({ path: candidate.path, reason: error instanceof Error ? error.message : String(error) });
        }
      }
      const markdown = buildRepoIndexMarkdown({ repo, ref: input.ref, structure, files: fetched, skipped });
      const saved = await this.writeRepoIndexDocument({
        project,
        repo,
        title: `Repo overview: ${repo}`,
        markdown,
        sourceUrls: fetched.map((f) => f.url).filter((url): url is string => Boolean(url)),
        authorClient: input.authorClient ?? this.principal.login,
      });
      const result = { saved, indexed_files: fetched.map((f) => ({ path: f.path, size: f.size, sha: f.sha })), skipped };
      await this.projectRepo.completeRepoIndexJob(jobId, { status: "completed", result });
      await this.projectRepo.markRepoIndexed(project, repo);
      return { job_id: jobId, ...result };
    } catch (error) {
      await this.projectRepo.completeRepoIndexJob(jobId, {
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async writeRepoIndexDocument(input: {
    project: string;
    repo: string;
    title: string;
    markdown: string;
    sourceUrls?: string[];
    authorClient?: string;
  }) {
    const project = normalizeProject(input.project);
    await this.ensureProject({ project });
    const folders = await resolveMemoryFolders(this.zoho, this.config, project);
    const fileName = `${slugify(input.repo)}-overview.md`;
    const path = buildLogicalPath(project, ["repo-index"], fileName);
    const existing = await this.docRepo.getDocumentByPath(path);
    const parsed = parseMarkdownDocument(path, input.markdown, input.authorClient ?? this.principal.login);
    const frontmatter = applyFrontmatterOverrides(parsed.frontmatter, {
      title: input.title,
      project,
      memory_type: "repo_index",
      status: "active",
      canonical: false,
      revision: existing ? existing.revision + 1 : 1,
      tags: ["github", "repo-index", input.repo],
      source: "github",
      source_urls: input.sourceUrls ?? [],
      repo: input.repo,
      author_client: input.authorClient ?? this.principal.login,
      updated_at: new Date().toISOString(),
    });
    const markdown = buildMarkdownDocument(frontmatter, parsed.body);
    const uploaded = await this.zoho.uploadMarkdownFile({
      folderId: folders.repoIndex.id,
      fileName,
      markdown,
      overrideExisting: Boolean(existing),
    });
    const jobId = await this.indexUploadedMarkdownAndRecordJob({
      file: uploaded,
      path,
      reason: "repo index write",
      project,
      documentId: existing?.id,
      markdown,
    });
    return { path, workdrive_file_id: uploaded.id, job_id: jobId };
  }

  // ---------------------------------------------------------------------------
  // Environment / planning config
  // ---------------------------------------------------------------------------

  getOperationalContext(input: {
    timezone?: string;
    now?: string;
    businessHours?: { start?: string; end?: string; business_days?: number[] };
    projectTimezone?: unknown;
  } = {}) {
    return {
      time_context: buildAssistantActionPlan({
        timezone: input.timezone,
        now: input.now,
        businessHours: input.businessHours,
        projectTimezone: input.projectTimezone,
        envDefaultTimezone: this.config.defaultTimezone,
      }).operational_context,
    };
  }

  planAssistantAction(input: {
    userIntent?: string;
    activeSources?: string[];
    availableTools?: string[];
    timezone?: string;
    now?: string;
    businessHours?: { start?: string; end?: string; business_days?: number[] };
    projectTimezone?: unknown;
  }) {
    return buildAssistantActionPlan({
      userIntent: input.userIntent,
      activeSources: input.activeSources,
      availableTools: input.availableTools,
      timezone: input.timezone,
      now: input.now,
      businessHours: input.businessHours,
      projectTimezone: input.projectTimezone,
      envDefaultTimezone: this.config.defaultTimezone,
    });
  }

  planEnvironmentToolUse(input: {
    environment?: string;
    userIntent: string;
    projectOrTopic?: string;
    availableTools?: string[];
    activeSources?: string[];
    proposedAction?: string;
    includeInstructions?: boolean;
  }) {
    return planEnvironmentToolUse(input);
  }

  planLightLaneLiveStateRefresh(input: { project?: string; userIntent?: string; availableTools?: string[]; force?: boolean }) {
    return buildLightLaneLiveStatePlan(input);
  }

  planZohoExternalWrite(input: { project?: string; requestedAction: string; writeCapableConnectorName?: string }) {
    return buildZohoExternalWritePlan(input);
  }

  listClientEnvironments() {
    return this.projectRepo
      .listClientEnvironments()
      .then((environments) => ({ environments }))
      .catch(() => ({ environments: defaultClientEnvironments() }));
  }

  async upsertClientEnvironment(input: {
    slug: string;
    displayName: string;
    description?: string | null;
    defaultToolStyle?: string | null;
    notes?: string | null;
  }) {
    return { environment: await this.projectRepo.upsertClientEnvironment(input) };
  }

  listToolCapabilities() {
    return this.projectRepo
      .listToolCapabilities()
      .then((capabilities) => ({ capabilities }))
      .catch(() => ({ capabilities: defaultToolCapabilities() }));
  }

  async upsertToolCapability(input: Parameters<ProjectRepository["upsertToolCapability"]>[0]) {
    return { capability: await this.projectRepo.upsertToolCapability(input) };
  }

  listEnvironmentCapabilities(input: { environment?: string } = {}) {
    return this.projectRepo
      .listEnvironmentCapabilities(input.environment)
      .then((capabilities) => ({ capabilities }))
      .catch(() => ({ capabilities: defaultEnvironmentCapabilities() }));
  }

  async upsertEnvironmentCapability(input: Parameters<ProjectRepository["upsertEnvironmentCapability"]>[0]) {
    return { environment_capability: await this.projectRepo.upsertEnvironmentCapability(input) };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async enqueueDocumentReindex(input: {
    workdriveFileId: string;
    path: string;
    documentId?: string;
    reason: string;
    project?: string;
  }) {
    const project = input.project ?? normalizeProjectFromPath(input.path);
    const jobId = await this.docRepo.createReindexJob({
      scope: "document",
      documentId: input.documentId,
      workdriveFileId: input.workdriveFileId,
      path: input.path,
      requestedBy: this.principal.login,
      reason: input.reason,
      project,
      jobKind: "document",
    });
    await this.env.INDEX_QUEUE.send({
      jobId,
      kind: "document",
      workdriveFileId: input.workdriveFileId,
      path: input.path,
    } satisfies IndexQueueMessage);
    return jobId;
  }

  private async indexUploadedMarkdownAndRecordJob(input: {
    file: ZohoFile;
    path: string;
    markdown: string;
    documentId?: string;
    reason: string;
    project: string;
  }) {
    const jobId = await this.docRepo.createReindexJob({
      scope: "document",
      documentId: input.documentId,
      workdriveFileId: input.file.id,
      path: input.path,
      requestedBy: this.principal.login,
      reason: input.reason,
      project: input.project,
      jobKind: "document",
    });
    await this.docRepo.updateReindexJob(jobId, { status: "running", incrementAttempts: true });
    try {
      await indexMarkdownDocument(this.env, input.file, input.path, input.markdown);
      await this.docRepo.updateReindexJob(jobId, { status: "completed" });
      return jobId;
    } catch (error) {
      await this.docRepo.updateReindexJob(jobId, {
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}

// ---------------------------------------------------------------------------
// Module-level helpers
// ---------------------------------------------------------------------------

export async function resolveMemoryFolders(
  zoho: ZohoWorkDriveClient,
  config: ReturnType<typeof loadConfig>,
  project: string,
  options: {
    createMissing?: boolean;
    record?: (
      folderPath: string,
      folderId: string | null,
      status: "ok" | "missing" | "error",
      error?: string | null,
    ) => Promise<void>;
  } = {},
) {
  const resolve = async (rootFolderId: string, segments: string[], folderPath: string) => {
    try {
      const result = options.createMissing
        ? await zoho.ensureFolderPath(rootFolderId, segments)
        : { folder: await zoho.resolveFolderPath(rootFolderId, segments), created: [] };
      await options.record?.(folderPath, result.folder.id, "ok");
      return result;
    } catch (error) {
      await options.record?.(
        folderPath,
        null,
        options.createMissing ? "error" : "missing",
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  };

  if (project === "shared") {
    if (!config.zoho.sharedRootFolderId) throw new Error("WORKDRIVE_SHARED_ROOT_FOLDER_ID is required.");
    const root = await zoho.getFile(config.zoho.sharedRootFolderId);
    const contextCurrent = await resolve(config.zoho.sharedRootFolderId, ["context", "current"], "/memory/shared/context/current");
    const contextHistory = await resolve(config.zoho.sharedRootFolderId, ["context", "history"], "/memory/shared/context/history");
    const decisions = await resolve(config.zoho.sharedRootFolderId, ["decisions"], "/memory/shared/decisions");
    const sessions = await resolve(config.zoho.sharedRootFolderId, ["sessions"], "/memory/shared/sessions");
    const snippets = await resolve(config.zoho.sharedRootFolderId, ["snippets"], "/memory/shared/snippets");
    const repoIndex = await resolve(config.zoho.sharedRootFolderId, ["repo-index"], "/memory/shared/repo-index");
    return {
      root,
      contextCurrent: contextCurrent.folder,
      contextHistory: contextHistory.folder,
      decisions: decisions.folder,
      sessions: sessions.folder,
      snippets: snippets.folder,
      repoIndex: repoIndex.folder,
      created: [
        ...contextCurrent.created, ...contextHistory.created, ...decisions.created,
        ...sessions.created, ...snippets.created, ...repoIndex.created,
      ],
    };
  }

  if (!config.zoho.projectsRootFolderId) throw new Error("WORKDRIVE_PROJECTS_ROOT_FOLDER_ID is required.");
  const rootResult = await resolve(config.zoho.projectsRootFolderId, [project], `/memory/projects/${project}`);
  const contextCurrent = await resolve(config.zoho.projectsRootFolderId, [project, "context", "current"], `/memory/projects/${project}/context/current`);
  const contextHistory = await resolve(config.zoho.projectsRootFolderId, [project, "context", "history"], `/memory/projects/${project}/context/history`);
  const decisions = await resolve(config.zoho.projectsRootFolderId, [project, "decisions"], `/memory/projects/${project}/decisions`);
  const sessions = await resolve(config.zoho.projectsRootFolderId, [project, "sessions"], `/memory/projects/${project}/sessions`);
  const snippets = await resolve(config.zoho.projectsRootFolderId, [project, "snippets"], `/memory/projects/${project}/snippets`);
  const repoIndex = await resolve(config.zoho.projectsRootFolderId, [project, "repo-index"], `/memory/projects/${project}/repo-index`);
  return {
    root: rootResult.folder,
    contextCurrent: contextCurrent.folder,
    contextHistory: contextHistory.folder,
    decisions: decisions.folder,
    sessions: sessions.folder,
    snippets: snippets.folder,
    repoIndex: repoIndex.folder,
    created: [
      ...rootResult.created, ...contextCurrent.created, ...contextHistory.created,
      ...decisions.created, ...sessions.created, ...snippets.created, ...repoIndex.created,
    ],
  };
}

function applyFrontmatterOverrides(base: MemoryFrontmatter, overrides: Partial<MemoryFrontmatter>): MemoryFrontmatter {
  return { ...base, ...overrides };
}

function folderSummary(folders: Awaited<ReturnType<typeof resolveMemoryFolders>>) {
  return {
    root: folders.root.id,
    context_current: folders.contextCurrent.id,
    context_history: folders.contextHistory.id,
    decisions: folders.decisions.id,
    sessions: folders.sessions.id,
    snippets: folders.snippets.id,
    repo_index: folders.repoIndex.id,
  };
}

function projectHasFolderIds(project: MemoryProject) {
  return Boolean(
    project.workdriveRootFolderId && project.contextCurrentFolderId && project.contextHistoryFolderId &&
    project.decisionsFolderId && project.sessionsFolderId && project.snippetsFolderId && project.repoIndexFolderId,
  );
}

function projectFolderSummary(project: MemoryProject) {
  return {
    root: project.workdriveRootFolderId,
    context_current: project.contextCurrentFolderId,
    context_history: project.contextHistoryFolderId,
    decisions: project.decisionsFolderId,
    sessions: project.sessionsFolderId,
    snippets: project.snippetsFolderId,
    repo_index: project.repoIndexFolderId,
  };
}

function mergeProjectProfile(base?: Record<string, unknown>, additions: Record<string, unknown> = {}) {
  const next = { ...(base ?? {}) };
  for (const [key, value] of Object.entries(additions)) {
    if (value !== undefined) next[key] = value;
  }
  return next;
}

function titleFromSlug(slug: string) {
  if (slug === "shared") return "Shared Memory";
  return slug.split("-").filter(Boolean).map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`).join(" ");
}

function normalizeProjectFromPath(path: string) {
  const parts = path.split("/").filter(Boolean);
  const projectsIndex = parts.indexOf("projects");
  if (projectsIndex >= 0 && parts[projectsIndex + 1]) return normalizeProject(parts[projectsIndex + 1]);
  return "shared";
}

function selectRepoOverviewFiles(
  entries: Array<{ name: string; path: string; type: string; size: number }>,
  globs?: string[],
) {
  if (globs?.length) {
    return entries.filter((entry) => entry.type === "file" && globs.some((glob) => simpleGlobMatch(glob, entry.path)));
  }
  const importantNames = new Set([
    "readme.md", "package.json", "wrangler.jsonc", "wrangler.toml", "tsconfig.json",
    "vite.config.ts", "vitest.config.ts", "pyproject.toml", "cargo.toml", "go.mod",
  ]);
  return entries.filter((entry) => entry.type === "file" && importantNames.has(entry.name.toLowerCase()));
}

function simpleGlobMatch(glob: string, path: string) {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*");
  return new RegExp(`^${escaped}$`).test(path);
}

function unsafeRepoPathReason(path: string) {
  const normalized = path.toLowerCase();
  if (normalized.includes("node_modules/") || normalized.includes("dist/") || normalized.includes("build/") || normalized.includes(".git/")) {
    return "generated or dependency path";
  }
  if (/(^|\/)\.env($|[./-])/.test(normalized) || /\.(pem|p12|pfx|key|crt|cer)$/i.test(normalized) || /(secret|credential|private-key|token)/i.test(normalized)) {
    return "secret-like path";
  }
  if (/\.(png|jpg|jpeg|gif|webp|pdf|zip|gz|wasm|lock)$/i.test(normalized)) {
    return "binary, generated, or low-value overview file";
  }
  return null;
}

function secretContentReason(content: string) {
  const patterns = [
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    /\b(?:api[_-]?key|secret|token|password)\s*[:=]\s*["']?[A-Za-z0-9_\-]{20,}/i,
    /\bgh[pousr]_[A-Za-z0-9_]{20,}/,
  ];
  return patterns.some((p) => p.test(content)) ? "secret-like content" : null;
}

function buildRepoIndexMarkdown(input: {
  repo: string;
  ref?: string;
  structure: { root: { entries: Array<{ type: string; path: string }> } };
  files: Array<{ path: string; sha: string; size: number; content: string; url: string | null }>;
  skipped: Array<{ path: string; reason: string }>;
}) {
  const lines = [
    `# Repo Overview: ${input.repo}`,
    "",
    `Repository: ${input.repo}`,
    input.ref ? `Ref: ${input.ref}` : "",
    "",
    "## Root Structure",
    "",
    ...input.structure.root.entries.map((entry) => `- ${entry.type}: ${entry.path}`),
    "",
    "## Indexed Files",
    "",
  ].filter(Boolean);

  for (const file of input.files) {
    lines.push(`### ${file.path}`, "", `SHA: ${file.sha}`);
    if (file.url) lines.push(`URL: ${file.url}`);
    lines.push("", "```", file.content.trimEnd(), "```", "");
  }

  if (input.skipped.length) {
    lines.push("## Skipped Files", "");
    for (const skipped of input.skipped) lines.push(`- ${skipped.path}: ${skipped.reason}`);
  }

  return lines.join("\n");
}
