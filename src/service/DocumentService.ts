import YAML from "yaml";
import { loadConfig } from "~/config/env";
import { parseMarkdownDocument } from "~/domain/frontmatter";
import {
  buildLogicalPath,
  buildMarkdownDocument,
  isAdminPrincipal,
  normalizeProject,
  slugify,
  type ContextTask,
  type MemoryFrontmatter,
  type MemoryLayer,
  type MemoryPrincipal,
  type MemoryProject,
  type ResolvedMemoryDocument,
  type SourceEvent,
} from "~/domain/memory";
import {
  indexMarkdownDocument,
  reindexWorkDriveDocument,
  runReconciliation,
  type IndexQueueMessage,
} from "~/domain/service";
import { GithubOAuthClient } from "~/integrations/github/client";
import { ZohoWorkDriveClient, type ZohoFile } from "~/integrations/zoho/client";
import type { DocumentRepository } from "~/persistence/d1/DocumentRepository";
import type { EntityRepository } from "~/persistence/d1/EntityRepository";
import type { ProjectRepository } from "~/persistence/d1/ProjectRepository";

// ---------------------------------------------------------------------------
// Module-level helpers (copied from service.ts)
// ---------------------------------------------------------------------------

async function resolveMemoryFoldersLocal(
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
    if (!config.zoho.sharedRootFolderId) {
      throw new Error("WORKDRIVE_SHARED_ROOT_FOLDER_ID is required.");
    }
    const root = await zoho.getFile(config.zoho.sharedRootFolderId);
    const contextCurrent = await resolve(
      config.zoho.sharedRootFolderId,
      ["context", "current"],
      "/memory/shared/context/current",
    );
    const contextHistory = await resolve(
      config.zoho.sharedRootFolderId,
      ["context", "history"],
      "/memory/shared/context/history",
    );
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
        ...contextCurrent.created,
        ...contextHistory.created,
        ...decisions.created,
        ...sessions.created,
        ...snippets.created,
        ...repoIndex.created,
      ],
    };
  }

  if (!config.zoho.projectsRootFolderId) {
    throw new Error("WORKDRIVE_PROJECTS_ROOT_FOLDER_ID is required.");
  }

  const rootResult = await resolve(config.zoho.projectsRootFolderId, [project], `/memory/projects/${project}`);
  const contextCurrent = await resolve(
    config.zoho.projectsRootFolderId,
    [project, "context", "current"],
    `/memory/projects/${project}/context/current`,
  );
  const contextHistory = await resolve(
    config.zoho.projectsRootFolderId,
    [project, "context", "history"],
    `/memory/projects/${project}/context/history`,
  );
  const decisions = await resolve(
    config.zoho.projectsRootFolderId,
    [project, "decisions"],
    `/memory/projects/${project}/decisions`,
  );
  const sessions = await resolve(
    config.zoho.projectsRootFolderId,
    [project, "sessions"],
    `/memory/projects/${project}/sessions`,
  );
  const snippets = await resolve(
    config.zoho.projectsRootFolderId,
    [project, "snippets"],
    `/memory/projects/${project}/snippets`,
  );
  const repoIndex = await resolve(
    config.zoho.projectsRootFolderId,
    [project, "repo-index"],
    `/memory/projects/${project}/repo-index`,
  );
  return {
    root: rootResult.folder,
    contextCurrent: contextCurrent.folder,
    contextHistory: contextHistory.folder,
    decisions: decisions.folder,
    sessions: sessions.folder,
    snippets: snippets.folder,
    repoIndex: repoIndex.folder,
    created: [
      ...rootResult.created,
      ...contextCurrent.created,
      ...contextHistory.created,
      ...decisions.created,
      ...sessions.created,
      ...snippets.created,
      ...repoIndex.created,
    ],
  };
}

function applyFrontmatterOverrides(
  base: MemoryFrontmatter,
  overrides: Partial<MemoryFrontmatter>,
): MemoryFrontmatter {
  return {
    ...base,
    ...overrides,
  };
}

function folderSummary(folders: Awaited<ReturnType<typeof resolveMemoryFoldersLocal>>) {
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
    project.workdriveRootFolderId &&
      project.contextCurrentFolderId &&
      project.contextHistoryFolderId &&
      project.decisionsFolderId &&
      project.sessionsFolderId &&
      project.snippetsFolderId &&
      project.repoIndexFolderId,
  );
}

function titleFromSlug(slug: string) {
  if (slug === "shared") {
    return "Shared Memory";
  }
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function inferMemoryLayer(
  memoryType: string,
  canonical: boolean,
): "situation" | "knowledge" | "operational" | "event_log" {
  if (memoryType === "session_summary" || memoryType === "historical_note") {
    return "event_log";
  }
  if (
    memoryType === "decision" ||
    memoryType === "snippet" ||
    memoryType === "repo_index" ||
    (canonical && memoryType === "current_context")
  ) {
    return "knowledge";
  }
  return "operational";
}

function timestampForFile(now: Date) {
  return now.toISOString().replace(/[:.]/g, "-");
}

async function sha256Hex(input: string) {
  const encoded = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function dateForDedup(now: Date) {
  return now.toISOString().slice(0, 10);
}

function normalizeProjectFromPath(path: string) {
  const parts = path.split("/").filter(Boolean);
  const projectsIndex = parts.indexOf("projects");
  if (projectsIndex >= 0 && parts[projectsIndex + 1]) {
    return normalizeProject(parts[projectsIndex + 1]);
  }
  return "shared";
}

function parseLooseMarkdown(markdown: string) {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) {
    return { frontmatter: {}, body: markdown };
  }
  try {
    return {
      frontmatter: (YAML.parse(match[1] ?? "") ?? {}) as Record<string, unknown>,
      body: markdown.slice(match[0].length),
    };
  } catch {
    return { frontmatter: {}, body: markdown.slice(match[0].length) };
  }
}

function buildMarkdownWithExtraFrontmatter(frontmatter: Record<string, unknown>, body: string) {
  return `---\n${YAML.stringify(frontmatter).trimEnd()}\n---\n\n${body.trim()}\n`;
}

function connectorPolicyFor(source: string) {
  const key = source.toLowerCase().replace(/[-\s]+/g, "_");
  const policies: Record<
    string,
    {
      save_policy: "durable_summary" | "live_only" | "requires_approval";
      durable: string[];
      requires_approval: string[];
      live_only: string[];
    }
  > = {
    zoho_crm: {
      save_policy: "durable_summary",
      durable: ["deal stage changes", "account updates", "contact summaries", "follow-up tasks"],
      requires_approval: ["full records", "private notes", "attachments"],
      live_only: ["raw CRM payloads"],
    },
    zoho_mail: {
      save_policy: "requires_approval",
      durable: ["thread summaries", "commitments", "deadlines", "decisions"],
      requires_approval: ["raw body", "attachments", "full thread"],
      live_only: ["message body", "attachments"],
    },
    zoho_calendar: {
      save_policy: "durable_summary",
      durable: ["meeting summaries", "deadlines", "follow-ups"],
      requires_approval: ["private descriptions", "full attendee lists"],
      live_only: ["raw event payloads"],
    },
    zoho_notes: {
      save_policy: "durable_summary",
      durable: ["note summaries", "decisions", "ideas", "tasks"],
      requires_approval: ["full private notes"],
      live_only: ["raw note payloads"],
    },
    github: {
      save_policy: "durable_summary",
      durable: ["repo changes", "issues", "pull requests", "release summaries"],
      requires_approval: ["large diffs", "private repo file bodies"],
      live_only: ["raw diffs"],
    },
    shopify: {
      save_policy: "durable_summary",
      durable: ["product updates", "order summaries without PII", "inventory changes"],
      requires_approval: ["customer PII", "order line items with identifying data"],
      live_only: ["raw order payloads"],
    },
    workdrive: {
      save_policy: "durable_summary",
      durable: ["document summaries", "decisions", "plans", "context updates"],
      requires_approval: ["full private documents"],
      live_only: ["binary files"],
    },
  };
  return (
    policies[key] ?? {
      save_policy: "requires_approval",
      durable: ["durable summary with source link"],
      requires_approval: ["raw source content"],
      live_only: ["unknown connector payloads"],
    }
  );
}

function currentContextTemplates(project: string, displayName: string) {
  return [
    {
      fileName: "overview.md",
      title: "Project Overview",
      markdown: `# ${displayName}\n\n## Purpose\n\nRecord the durable project purpose here.\n\n## Current State\n\nNo current state has been recorded yet.\n`,
    },
    {
      fileName: "architecture.md",
      title: "Current Architecture",
      markdown: `# Current Architecture\n\n## System Shape\n\nDescribe the current production architecture for ${project}.\n\n## Important Boundaries\n\nRecord service, storage, and integration boundaries here.\n`,
    },
    {
      fileName: "active-goals.md",
      title: "Active Goals",
      markdown:
        "# Active Goals\n\n## Now\n\nRecord the active goals and priorities here.\n\n## Later\n\nRecord deferred but still relevant goals here.\n",
    },
    {
      fileName: "constraints.md",
      title: "Known Constraints",
      markdown:
        "# Known Constraints\n\n## Technical Constraints\n\nRecord important constraints here.\n\n## Product Or Workflow Constraints\n\nRecord workflow-specific constraints here.\n",
    },
    {
      fileName: "setup-deployment.md",
      title: "Setup And Deployment",
      markdown:
        "# Setup And Deployment\n\n## Local Setup\n\nRecord local setup commands here.\n\n## Deployment\n\nRecord deployment, URLs, callbacks, and operational details here.\n",
    },
    {
      fileName: "repo-map.md",
      title: "Repo Map",
      markdown:
        "# Repo Map\n\n## Associated Repositories\n\nRecord associated repositories and their roles here.\n\n## Important Paths\n\nRecord important files and directories here.\n",
    },
  ];
}

function sliceLines(content: string, lineStart?: number, lineEnd?: number) {
  if (!lineStart && !lineEnd) {
    return content;
  }
  const lines = content.split("\n");
  const start = Math.max((lineStart ?? 1) - 1, 0);
  const end = Math.min(lineEnd ?? lines.length, lines.length);
  if (start >= end) {
    throw new Error("line_start must be before line_end.");
  }
  return lines.slice(start, end).join("\n");
}

function languageForPath(path: string) {
  const extension = path.split(".").pop()?.toLowerCase();
  const languages: Record<string, string> = {
    js: "javascript",
    jsx: "jsx",
    ts: "typescript",
    tsx: "tsx",
    py: "python",
    rb: "ruby",
    go: "go",
    rs: "rust",
    java: "java",
    kt: "kotlin",
    swift: "swift",
    php: "php",
    css: "css",
    html: "html",
    md: "markdown",
    json: "json",
    yaml: "yaml",
  };
  return languages[extension ?? ""] ?? extension ?? "text";
}

// ---------------------------------------------------------------------------
// DocumentService class
// ---------------------------------------------------------------------------

export class DocumentService {
  private readonly config: ReturnType<typeof loadConfig>;
  private readonly zoho: ZohoWorkDriveClient;
  private readonly github: GithubOAuthClient | null;

  constructor(
    private readonly env: Env,
    private readonly principal: MemoryPrincipal,
    private readonly projectRepo: ProjectRepository,
    private readonly docRepo: DocumentRepository,
    private readonly entityRepo: EntityRepository,
    config?: ReturnType<typeof loadConfig>,
    zoho?: ZohoWorkDriveClient,
    github: GithubOAuthClient | null = null,
  ) {
    this.config = config ?? loadConfig(env);
    this.zoho = zoho ?? new ZohoWorkDriveClient(env);
    this.github = github;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async ensureProjectMinimal(input: { project: string; displayName?: string; description?: string }) {
    const { project } = input;
    const displayName = input.displayName ?? titleFromSlug(project);
    const existing = await this.projectRepo.getProject(project);
    if (existing) {
      return existing;
    }
    return this.projectRepo.upsertProject({
      slug: project,
      displayName,
      description: input.description ?? null,
      status: "active",
      ownerLogin: this.principal.login,
      shared: project === "shared",
    });
  }

  private async resolveDocumentReference(input: {
    documentId?: string;
    path?: string;
    workdriveFileId?: string;
  }) {
    if (input.documentId) {
      return this.docRepo.getDocumentById(input.documentId);
    }
    if (input.path) {
      return this.docRepo.getDocumentByPath(input.path);
    }
    if (input.workdriveFileId) {
      return this.docRepo.getDocumentByWorkDriveFileId(input.workdriveFileId);
    }
    return null;
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
    await this.docRepo.updateReindexJob(jobId, {
      status: "running",
      incrementAttempts: true,
    });
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

  private async enqueueDocumentReindex(input: {
    workdriveFileId: string;
    path: string;
    documentId?: string;
    reason: string;
    project?: string;
  }) {
    const jobId = await this.docRepo.createReindexJob({
      scope: "document",
      documentId: input.documentId,
      workdriveFileId: input.workdriveFileId,
      path: input.path,
      requestedBy: this.principal.login,
      reason: input.reason,
      project: input.project ?? normalizeProjectFromPath(input.path),
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

  // ---------------------------------------------------------------------------
  // Public methods
  // ---------------------------------------------------------------------------

  async bootstrapProjectContext(input: {
    project: string;
    displayName?: string;
    description?: string;
    authorClient?: string;
  }) {
    await this.ensureProjectMinimal({
      project: input.project,
      displayName: input.displayName,
      description: input.description,
    });
    const existingProject = await this.projectRepo.getProject(normalizeProject(input.project));
    const project = normalizeProject(input.project);
    const displayName = input.displayName ?? existingProject?.displayName ?? titleFromSlug(project);

    const created: Array<{ path: string; job_id: string }> = [];
    const existing: string[] = [];

    for (const doc of currentContextTemplates(project, displayName)) {
      const path = buildLogicalPath(project, ["context", "current"], doc.fileName);
      const current = await this.docRepo.getDocumentByPath(path);
      if (current) {
        existing.push(path);
        continue;
      }
      const result = await this.updateContextDocument({
        project,
        path,
        title: doc.title,
        markdown: doc.markdown,
        expectedRevision: 0,
        authorClient: input.authorClient ?? this.principal.login,
      });
      created.push({ path: result.path, job_id: result.job_id });
    }

    return {
      project: existingProject,
      created,
      existing,
      current_context: await this.getCurrentContext({ project }),
    };
  }

  async getDocument(input: {
    documentId?: string;
    path?: string;
    workdriveFileId?: string;
    authoritative?: boolean;
  }) {
    const document = await this.resolveDocumentReference(input);
    if (!document) {
      throw new Error("Document not found.");
    }
    const snapshot = await this.docRepo.getLatestSnapshot(document.id);
    const authoritative = input.authoritative
      ? await this.zoho.downloadMarkdown(document.workdriveFileId)
      : null;
    return {
      document,
      snapshot,
      authoritative_markdown: authoritative?.markdown ?? null,
    };
  }

  async getCurrentContext(input: {
    project?: string;
    query?: string;
    authoritative?: boolean;
    searchMemoryFn?: (params: {
      query: string;
      project?: string;
      limit: number;
      activeOnly: boolean;
      includeSuperseded: boolean;
      memoryTypes: string[];
      authoritative?: boolean;
    }) => Promise<unknown>;
  }) {
    if (input.query) {
      if (!input.searchMemoryFn) {
        throw new Error("searchMemoryFn is required when a query is provided to getCurrentContext.");
      }
      return input.searchMemoryFn({
        query: input.query,
        project: input.project,
        limit: 10,
        activeOnly: true,
        includeSuperseded: false,
        memoryTypes: ["current_context", "decision"],
        authoritative: input.authoritative,
      });
    }

    const documents = await this.docRepo.listCurrentContextDocuments(
      input.project ? normalizeProject(input.project) : undefined,
    );

    const items = await Promise.all(
      documents.map(async (document) => {
        const snapshot = await this.docRepo.getLatestSnapshot(document.id);
        const authoritative = input.authoritative
          ? await this.zoho.downloadMarkdown(document.workdriveFileId)
          : null;
        return {
          document,
          snapshot,
          authoritative_markdown: authoritative?.markdown ?? null,
        };
      }),
    );

    return {
      items,
      grouped: {
        current_context: items.filter(
          (item) => item.document?.memoryType === "current_context",
        ),
        decisions: items.filter((item) => item.document?.memoryType === "decision"),
      },
    };
  }

  async writeSessionSummary(input: {
    project?: string;
    title: string;
    markdown: string;
    tags?: string[];
    authorClient?: string;
  }) {
    const project = normalizeProject(input.project);
    await this.ensureProjectMinimal({ project });
    const contentHash = await sha256Hex(input.markdown);
    const dedupKey = `${dateForDedup(new Date())}:${slugify(input.title)}:${contentHash}`;
    const existingDedup = await this.docRepo.findDedup({
      project,
      memoryType: "session_summary",
      dedupKey,
    });
    if (existingDedup) {
      const existingDocument = existingDedup.document_id
        ? await this.docRepo.getDocumentById(existingDedup.document_id)
        : null;
      return {
        deduped: true,
        document_id: existingDedup.document_id,
        path: existingDocument?.path,
        workdrive_file_id: existingDocument?.workdriveFileId,
        content_sha256: existingDedup.content_sha256,
      };
    }
    const folders = await resolveMemoryFoldersLocal(this.zoho, this.config, project);
    const now = new Date();
    const fileName = `${timestampForFile(now)}-${slugify(input.title || "session-summary")}.md`;
    const path = buildLogicalPath(project, ["sessions"], fileName);
    const parsed = parseMarkdownDocument(
      path,
      input.markdown,
      input.authorClient ?? this.principal.login,
    );
    const frontmatter = applyFrontmatterOverrides(parsed.frontmatter, {
      title: input.title,
      project,
      memory_type: "session_summary",
      status: "historical",
      canonical: false,
      tags: input.tags ?? parsed.frontmatter.tags,
      author_client: input.authorClient ?? this.principal.login,
    });
    const markdown = buildMarkdownDocument(frontmatter, parsed.body);
    const uploaded = await this.zoho.uploadMarkdownFile({
      folderId: folders.sessions.id,
      fileName,
      markdown,
      overrideExisting: false,
    });

    const jobId = await this.indexUploadedMarkdownAndRecordJob({
      file: uploaded,
      path,
      reason: "session summary write",
      project,
      markdown,
    });
    await this.docRepo.recordDedup({
      project,
      memoryType: "session_summary",
      dedupKey,
      documentId: (await this.docRepo.getDocumentByWorkDriveFileId(uploaded.id))?.id,
      contentSha256: contentHash,
    });

    return { path, workdrive_file_id: uploaded.id, job_id: jobId };
  }

  async recordDecision(input: {
    project?: string;
    title: string;
    markdown: string;
    tags?: string[];
    supersedesDocumentIds?: string[];
    authorClient?: string;
  }) {
    const project = normalizeProject(input.project);
    await this.ensureProjectMinimal({ project });
    const folders = await resolveMemoryFoldersLocal(this.zoho, this.config, project);
    const now = new Date();
    const fileName = `${timestampForFile(now)}-${slugify(input.title || "decision")}.md`;
    const path = buildLogicalPath(project, ["decisions"], fileName);
    const parsed = parseMarkdownDocument(
      path,
      input.markdown,
      input.authorClient ?? this.principal.login,
    );
    const frontmatter = applyFrontmatterOverrides(parsed.frontmatter, {
      title: input.title,
      project,
      memory_type: "decision",
      status: "active",
      canonical: false,
      tags: input.tags ?? parsed.frontmatter.tags,
      supersedes: input.supersedesDocumentIds ?? parsed.frontmatter.supersedes,
      author_client: input.authorClient ?? this.principal.login,
    });
    const markdown = buildMarkdownDocument(frontmatter, parsed.body);
    const uploaded = await this.zoho.uploadMarkdownFile({
      folderId: folders.decisions.id,
      fileName,
      markdown,
      overrideExisting: false,
    });
    const jobId = await this.indexUploadedMarkdownAndRecordJob({
      file: uploaded,
      path,
      reason: "decision write",
      project,
      markdown,
    });
    if (input.supersedesDocumentIds?.length) {
      await this.docRepo.markDocumentsSuperseded({
        documentIds: input.supersedesDocumentIds,
      });
    }
    return { path, workdrive_file_id: uploaded.id, job_id: jobId };
  }

  async saveSnippet(input: {
    project?: string;
    title: string;
    markdown: string;
    tags?: string[];
    source?: string;
    sourceUrls?: string[];
    repo?: string;
    path?: string;
    confidence?: number;
    usefulness?: number;
    authorClient?: string;
  }) {
    const project = normalizeProject(input.project);
    await this.ensureProjectMinimal({ project });
    const contentHash = await sha256Hex(input.markdown);
    const dedupKey = [
      input.source ?? "manual",
      input.repo ?? "",
      input.path ?? "",
      contentHash,
    ].join(":");
    const existingDedup = await this.docRepo.findDedup({
      project,
      memoryType: "snippet",
      dedupKey,
    });
    if (existingDedup) {
      const existingDocument = existingDedup.document_id
        ? await this.docRepo.getDocumentById(existingDedup.document_id)
        : null;
      return {
        deduped: true,
        document_id: existingDedup.document_id,
        path: existingDocument?.path,
        workdrive_file_id: existingDocument?.workdriveFileId,
        content_sha256: existingDedup.content_sha256,
      };
    }

    const folders = await resolveMemoryFoldersLocal(this.zoho, this.config, project);
    const fileName = `${timestampForFile(new Date())}-${slugify(input.title || "snippet")}.md`;
    const path = buildLogicalPath(project, ["snippets"], fileName);
    const parsed = parseMarkdownDocument(
      path,
      input.markdown,
      input.authorClient ?? this.principal.login,
    );
    const frontmatter = applyFrontmatterOverrides(parsed.frontmatter, {
      title: input.title,
      project,
      memory_type: "snippet",
      status: "active",
      canonical: false,
      tags: input.tags ?? parsed.frontmatter.tags,
      source: input.source,
      source_urls: input.sourceUrls ?? parsed.frontmatter.source_urls,
      repo: input.repo,
      path: input.path,
      confidence: input.confidence,
      usefulness: input.usefulness,
      author_client: input.authorClient ?? this.principal.login,
    });
    const markdown = buildMarkdownDocument(frontmatter, parsed.body);
    const uploaded = await this.zoho.uploadMarkdownFile({
      folderId: folders.snippets.id,
      fileName,
      markdown,
      overrideExisting: false,
    });
    const jobId = await this.indexUploadedMarkdownAndRecordJob({
      file: uploaded,
      path,
      reason: "snippet write",
      project,
      markdown,
    });
    await this.docRepo.recordDedup({
      project,
      memoryType: "snippet",
      dedupKey,
      documentId: (await this.docRepo.getDocumentByWorkDriveFileId(uploaded.id))?.id,
      contentSha256: contentHash,
    });
    return { path, workdrive_file_id: uploaded.id, job_id: jobId };
  }

  async updateContextDocument(input: {
    project?: string;
    path?: string;
    title?: string;
    markdown: string;
    expectedRevision?: number;
    authorClient?: string;
  }) {
    const project = normalizeProject(input.project);
    await this.ensureProjectMinimal({ project });
    const folders = await resolveMemoryFoldersLocal(this.zoho, this.config, project);
    const canonicalFileName = input.path
      ? (input.path.split("/").pop() ?? `${slugify(input.title ?? "context")}.md`)
      : `${slugify(input.title ?? "context")}.md`;
    const path =
      input.path ?? buildLogicalPath(project, ["context", "current"], canonicalFileName);

    const existing = await this.docRepo.getDocumentByPath(path);
    if (
      existing &&
      input.expectedRevision !== undefined &&
      input.expectedRevision !== existing.revision
    ) {
      throw new Error(
        `Revision mismatch for ${path}. Expected ${input.expectedRevision}, found ${existing.revision}.`,
      );
    }
    if (!existing && input.expectedRevision && input.expectedRevision !== 0) {
      throw new Error(
        `Document ${path} does not yet exist, so expected_revision must be 0 or omitted.`,
      );
    }

    const previousSnapshot = existing
      ? await this.docRepo.getLatestSnapshot(existing.id)
      : null;

    const parsed = parseMarkdownDocument(
      path,
      input.markdown,
      input.authorClient ?? this.principal.login,
    );
    const nextRevision = existing ? existing.revision + 1 : 1;
    const frontmatter = applyFrontmatterOverrides(parsed.frontmatter, {
      title: input.title ?? parsed.frontmatter.title,
      project,
      memory_type: "current_context",
      status: "active",
      canonical: true,
      revision: nextRevision,
      created_at: previousSnapshot?.frontmatter.created_at ?? parsed.frontmatter.created_at,
      updated_at: new Date().toISOString(),
      author_client: input.authorClient ?? this.principal.login,
    });
    const markdown = buildMarkdownDocument(frontmatter, parsed.body);

    let historyResult:
      | {
          path: string;
          workdrive_file_id: string;
          job_id: string;
        }
      | null = null;

    if (previousSnapshot && existing) {
      const historyFileName = `${canonicalFileName.replace(
        /\.md$/i,
        "",
      )}--rev-${previousSnapshot.revision}-${Date.now()}.md`;
      const historyPath = buildLogicalPath(project, ["context", "history"], historyFileName);
      const historyFrontmatter = applyFrontmatterOverrides(previousSnapshot.frontmatter, {
        memory_type: "historical_note",
        status: "historical",
        canonical: false,
        author_client: input.authorClient ?? this.principal.login,
      });
      const historyMarkdown = buildMarkdownDocument(
        historyFrontmatter,
        previousSnapshot.bodyMarkdown,
      );
      const uploadedHistory = await this.zoho.uploadMarkdownFile({
        folderId: folders.contextHistory.id,
        fileName: historyFileName,
        markdown: historyMarkdown,
        overrideExisting: false,
      });
      const historyJobId = await this.indexUploadedMarkdownAndRecordJob({
        file: uploadedHistory,
        path: historyPath,
        reason: "history snapshot write",
        project,
        markdown: historyMarkdown,
      });
      historyResult = {
        path: historyPath,
        workdrive_file_id: uploadedHistory.id,
        job_id: historyJobId,
      };
    }

    const targetFolderId = existing?.parentFolderId ?? folders.contextCurrent.id;
    const uploadedCanonical = await this.zoho.uploadMarkdownFile({
      folderId: targetFolderId,
      fileName: canonicalFileName,
      markdown,
      overrideExisting: Boolean(existing),
    });
    const jobId = await this.indexUploadedMarkdownAndRecordJob({
      file: uploadedCanonical,
      path,
      reason: "canonical context write",
      project,
      markdown,
    });

    return {
      path,
      workdrive_file_id: uploadedCanonical.id,
      job_id: jobId,
      history_snapshot: historyResult,
    };
  }

  async setSituationDocument(input: {
    financial_position?: string;
    location?: string;
    top_priorities?: string[];
    key_constraints?: string[];
    active_initiatives?: string[];
    notes?: string;
  }) {
    const project = "shared";
    await this.ensureProjectMinimal({ project });

    const sections: string[] = ["# Current Situation"];

    if (input.financial_position) {
      sections.push(`## Financial Position\n${input.financial_position}`);
    }
    if (input.location) {
      sections.push(`## Current Location\n${input.location}`);
    }
    if (input.top_priorities?.length) {
      sections.push(
        `## Top Priorities\n${input.top_priorities.map((p) => `- ${p}`).join("\n")}`,
      );
    }
    if (input.key_constraints?.length) {
      sections.push(
        `## Key Constraints\n${input.key_constraints.map((c) => `- ${c}`).join("\n")}`,
      );
    }
    if (input.active_initiatives?.length) {
      sections.push(
        `## Active Initiatives\n${input.active_initiatives.map((i) => `- ${i}`).join("\n")}`,
      );
    }
    if (input.notes) {
      sections.push(`## Notes\n${input.notes}`);
    }

    const body = sections.join("\n\n");
    const path = buildLogicalPath(project, ["context", "current"], "situation.md");
    const existing = await this.docRepo.getDocumentByPath(path);
    const now = new Date().toISOString();
    const nextRevision = existing ? existing.revision + 1 : 1;

    const frontmatter = applyFrontmatterOverrides(
      {
        id: existing?.id ?? crypto.randomUUID(),
        title: "Current Situation",
        project,
        memory_type: "current_context" as const,
        status: "active" as const,
        revision: nextRevision,
        tags: ["situation", "personal"],
        created_at: now,
        updated_at: now,
        author_client: this.principal.login,
        canonical: true,
        source_urls: [],
        supersedes: [],
        superseded_by: [],
        memory_layer: "situation" as const,
      },
      {},
    );

    const markdown = buildMarkdownDocument(frontmatter, body);
    const folders = await resolveMemoryFoldersLocal(this.zoho, this.config, project);
    const uploaded = await this.zoho.uploadMarkdownFile({
      folderId: existing?.parentFolderId ?? folders.contextCurrent.id,
      fileName: "situation.md",
      markdown,
      overrideExisting: Boolean(existing),
    });

    const jobId = await this.indexUploadedMarkdownAndRecordJob({
      file: uploaded,
      path,
      reason: "situation document write",
      project,
      markdown,
    });

    return { path, workdrive_file_id: uploaded.id, job_id: jobId };
  }

  async archiveMemoryDocument(input: {
    documentId?: string;
    path?: string;
    workdriveFileId?: string;
    archivedToPath?: string;
    reason: string;
    authorClient?: string;
  }) {
    if (!isAdminPrincipal(this.principal, this.config.adminGithubLogins)) {
      throw new Error("archive_memory_document is restricted to administrators.");
    }
    const document = await this.resolveDocumentReference({
      documentId: input.documentId,
      path: input.path,
      workdriveFileId: input.workdriveFileId,
    });
    if (!document) {
      throw new Error("Unable to resolve a document to archive.");
    }

    const downloaded = await this.zoho.downloadMarkdown(document.workdriveFileId);
    const parsed = parseLooseMarkdown(downloaded.markdown);
    const now = new Date().toISOString();
    const archivedToPath = input.archivedToPath ?? document.path;
    const frontmatter = {
      id: document.id,
      title: `Archived: ${document.title}`,
      project: document.project,
      memory_type: document.memoryType,
      status: "archived",
      revision: document.revision + 1,
      tags: [...new Set([...document.tags, "archived"])],
      created_at: now,
      updated_at: now,
      author_client: input.authorClient ?? this.principal.login,
      source: document.source ?? undefined,
      source_urls: document.sourceUrl ? [document.sourceUrl] : [],
      confidence: typeof document.confidence === "number" ? document.confidence : undefined,
      usefulness: typeof document.usefulness === "number" ? document.usefulness : undefined,
      repo: document.repo ?? undefined,
      path: document.repoPath ?? undefined,
      supersedes: [],
      superseded_by: [],
      canonical: false,
      archived_reason: input.reason,
      archived_from_path: document.path,
      archived_to_path: archivedToPath,
      original_status: document.status,
    };
    const markdown = buildMarkdownWithExtraFrontmatter(
      frontmatter,
      [
        `# Archived: ${document.title}`,
        "",
        "This file is no longer active Context OS Memory.",
        "",
        `- Original path: \`${document.path}\``,
        `- Replacement/archive path: \`${archivedToPath}\``,
        `- Reason: ${input.reason}`,
        "",
        "## Original Content",
        "",
        parsed.body.trim(),
      ].join("\n"),
    );
    const uploaded = await this.zoho.uploadMarkdownFile({
      folderId: document.parentFolderId,
      fileName: document.fileName,
      markdown,
      overrideExisting: true,
    });
    const jobId = await this.indexUploadedMarkdownAndRecordJob({
      file: uploaded,
      path: document.path,
      reason: "archive memory document",
      project: document.project,
      documentId: document.id,
      markdown,
    });
    await this.docRepo.markDocumentsNoncanonical({
      documentIds: [document.id],
      reason: input.reason,
      status: "archived",
      archivedToPath,
      manifestId: "manual-archive-memory-document",
      notes: {
        archived_from_path: document.path,
        archived_to_path: archivedToPath,
      },
    });
    return {
      archived: true,
      path: document.path,
      workdrive_file_id: uploaded.id,
      job_id: jobId,
      archived_to_path: archivedToPath,
    };
  }

  async reindexDocument(input: {
    documentId?: string;
    path?: string;
    workdriveFileId?: string;
  }) {
    const document =
      input.documentId || input.path || input.workdriveFileId
        ? await this.resolveDocumentReference({
            documentId: input.documentId,
            path: input.path,
            workdriveFileId: input.workdriveFileId,
          })
        : null;
    if (!document) {
      throw new Error("Unable to resolve a document to reindex.");
    }
    const jobId = await this.docRepo.createReindexJob({
      scope: "document",
      documentId: document.id,
      workdriveFileId: document.workdriveFileId,
      path: document.path,
      requestedBy: this.principal.login,
      reason: "manual document reindex",
      project: document.project,
      jobKind: "document",
    });
    // Run inline (mirrors runDocumentReindexJob from service.ts)
    await this.docRepo.updateReindexJob(jobId, { status: "running", incrementAttempts: true });
    try {
      await reindexWorkDriveDocument(this.env, document.workdriveFileId, document.path);
      await this.docRepo.updateReindexJob(jobId, { status: "completed" });
    } catch (error) {
      await this.docRepo.updateReindexJob(jobId, {
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
    return { job_id: jobId, path: document.path, status: "completed" };
  }

  async reindexAll() {
    if (!isAdminPrincipal(this.principal, this.config.adminGithubLogins)) {
      throw new Error("reindex_all is restricted to administrators.");
    }
    const jobId = await this.docRepo.createReindexJob({
      scope: "crawl",
      requestedBy: this.principal.login,
      reason: "manual full crawl",
    });
    await this.env.INDEX_QUEUE.send({
      jobId,
      kind: "crawl",
      requestedBy: this.principal.login,
    } satisfies IndexQueueMessage);
    return { job_id: jobId };
  }

  async adminStatus() {
    const status = await this.docRepo.getAdminStatus();
    return {
      ...status,
      connectivity: {
        workdrive_configured: Boolean(
          this.config.zoho.sharedRootFolderId &&
            this.config.zoho.projectsRootFolderId &&
            (this.config.zoho.accessToken ||
              (this.config.zoho.clientId &&
                this.config.zoho.clientSecret &&
                this.config.zoho.refreshToken)),
        ),
        github_configured: Boolean(
          this.config.github.accessToken ||
            (this.config.github.clientId && this.config.github.clientSecret) ||
            this.config.github.allowedRepos.length > 0,
        ),
        vectorize_bound: Boolean(this.env.MEMORY_INDEX),
        queue_bound: Boolean(this.env.INDEX_QUEUE),
      },
    };
  }

  async reconcileWorkDrive() {
    if (!isAdminPrincipal(this.principal, this.config.adminGithubLogins)) {
      throw new Error("admin_reconcile_workdrive is restricted to administrators.");
    }
    return runReconciliation(this.env, "manual");
  }

  async backfillMemoryLayers(input: { dryRun?: boolean } = {}): Promise<{
    updated: number;
    skipped: number;
    dry_run: boolean;
    samples: Array<{
      path: string;
      memory_type: string;
      canonical: boolean;
      assigned_layer: string;
    }>;
  }> {
    const dryRun = input.dryRun !== false;

    const rows = await this.docRepo.getAllDocumentsForLayerBackfill();
    let updated = 0;
    let skipped = 0;
    const samples: Array<{
      path: string;
      memory_type: string;
      canonical: boolean;
      assigned_layer: string;
    }> = [];

    for (const row of rows) {
      if (row.memory_layer) {
        skipped++;
        continue;
      }

      const layer = inferMemoryLayer(row.memory_type, row.canonical);

      if (samples.length < 20) {
        samples.push({
          path: row.path,
          memory_type: row.memory_type,
          canonical: row.canonical,
          assigned_layer: layer,
        });
      }

      if (!dryRun) {
        await this.docRepo.setDocumentMemoryLayer(row.id, layer);
      }
      updated++;
    }

    return { updated, skipped, dry_run: dryRun, samples };
  }

  async finishWorkSession(input: {
    project: string;
    title: string;
    summaryMarkdown: string;
    tags?: string[];
    decisions?: Array<{
      title: string;
      markdown: string;
      tags?: string[];
      supersedesDocumentIds?: string[];
    }>;
    snippets?: Array<{
      title: string;
      markdown: string;
      tags?: string[];
      source?: string;
      sourceUrls?: string[];
      repo?: string;
      path?: string;
    }>;
    tasks?: Array<{
      id?: string;
      title: string;
      description?: string | null;
      status?: ContextTask["status"];
      priority?: ContextTask["priority"];
      dueAt?: string | null;
      owner?: string | null;
      initiativeId?: string | null;
      entityId?: string | null;
      source?: string | null;
      sourceUrl?: string | null;
      reminderAt?: string | null;
      metadata?: Record<string, unknown>;
    }>;
    sourceEvents?: Array<{
      source: string;
      sourceId?: string | null;
      eventType: string;
      occurredAt?: string | null;
      title: string;
      summary: string;
      sensitivity?: SourceEvent["sensitivity"];
      savePolicy?: SourceEvent["savePolicy"];
      initiativeId?: string | null;
      entityId?: string | null;
      externalUrl?: string | null;
      metadata?: Record<string, unknown>;
    }>;
    facts?: Array<{
      title: string;
      body: string;
      factKey?: string | null;
      source?: string | null;
      sourceUrl?: string | null;
      confidence?: number | null;
      initiativeId?: string | null;
      entityId?: string | null;
      documentId?: string | null;
      metadata?: Record<string, unknown>;
    }>;
    authorClient?: string;
  }) {
    const summary = await this.writeSessionSummary({
      project: input.project,
      title: input.title,
      markdown: input.summaryMarkdown,
      tags: input.tags,
      authorClient: input.authorClient ?? this.principal.login,
    });
    const decisions = [];
    for (const decision of input.decisions ?? []) {
      decisions.push(
        await this.recordDecision({
          project: input.project,
          title: decision.title,
          markdown: decision.markdown,
          tags: decision.tags,
          supersedesDocumentIds: decision.supersedesDocumentIds,
          authorClient: input.authorClient ?? this.principal.login,
        }),
      );
    }
    const snippets = [];
    for (const snippet of input.snippets ?? []) {
      snippets.push(
        await this.saveSnippet({
          project: input.project,
          ...snippet,
          authorClient: input.authorClient ?? this.principal.login,
        }),
      );
    }
    const project = normalizeProject(input.project);
    const tasks = [];
    for (const task of input.tasks ?? []) {
      await this.ensureProjectMinimal({ project });
      tasks.push({
        task: await this.entityRepo.upsertTask({
          ...task,
          project,
        }),
      });
    }
    const sourceEvents = [];
    for (const event of input.sourceEvents ?? []) {
      await this.ensureProjectMinimal({ project });
      const policy = connectorPolicyFor(event.source);
      const savePolicy = event.savePolicy ?? policy.save_policy;
      if (savePolicy === "live_only") {
        sourceEvents.push({
          saved: false,
          reason: "Connector policy is live_only; no durable source event was written.",
          policy,
        });
      } else {
        sourceEvents.push({
          saved: true,
          policy,
          source_event: await this.entityRepo.saveSourceEvent({
            ...event,
            project,
            savePolicy,
          }),
        });
      }
    }
    const facts = [];
    for (const fact of input.facts ?? []) {
      facts.push(
        await this.entityRepo.upsertFact({
          ...fact,
          project,
        }),
      );
    }
    return { summary, decisions, snippets, tasks, source_events: sourceEvents, facts };
  }

  async saveGithubFileMemory(
    input: {
      repo: string;
      path: string;
      ref?: string;
      project?: string;
      title?: string;
      note?: string;
      lineStart?: number;
      lineEnd?: number;
      maxBytes?: number;
      authorClient?: string;
    },
    github: GithubOAuthClient,
  ) {
    const file = await github.getFile({
      repo: input.repo,
      path: input.path,
      ref: input.ref,
      maxBytes: input.maxBytes,
    });
    const content = sliceLines(file.content, input.lineStart, input.lineEnd);
    const title = input.title ?? `GitHub snippet: ${file.repo}/${file.path}`;
    const language = languageForPath(file.path);
    const lines =
      input.lineStart || input.lineEnd
        ? ` lines ${input.lineStart ?? 1}-${input.lineEnd ?? file.content.split("\n").length}`
        : "";
    const markdown = [
      `# ${title}`,
      "",
      input.note ? `${input.note}\n` : "",
      `Source: ${file.repo}/${file.path}${file.ref ? ` @ ${file.ref}` : ""}${lines}`,
      file.htmlUrl ? `URL: ${file.htmlUrl}` : "",
      `SHA: ${file.sha}`,
      "",
      `\`\`\`${language}`,
      content.trimEnd(),
      "```",
    ]
      .filter((part) => part !== "")
      .join("\n");

    return this.saveSnippet({
      project: input.project,
      title,
      markdown,
      tags: ["github", "code", file.repo, file.path],
      source: "github",
      sourceUrls: file.htmlUrl ? [file.htmlUrl] : [],
      repo: file.repo,
      path: file.path,
      authorClient: input.authorClient ?? this.principal.login,
    });
  }
}
