import type {
  ChunkRecord,
  ContextTask,
  DurableFact,
  InitiativeProject,
  MemoryFrontmatter,
  MemoryEntity,
  MemoryInitiative,
  MemoryLink,
  MemoryProject,
  MemoryStatus,
  MemoryType,
  ProjectGithubRepo,
  ResolvedMemoryDocument,
  SourceEvent,
} from "~/domain/memory";

type DocumentRow = {
  id: string;
  workdrive_file_id: string;
  path: string;
  title: string;
  project: string;
  namespace: string;
  parent_folder_id: string;
  file_name: string;
  permalink: string | null;
  download_url: string | null;
  memory_type: MemoryType;
  status: MemoryStatus;
  canonical: number;
  active: number;
  revision: number;
  current_snapshot_id: string | null;
  last_remote_modified_at: number | null;
  source: string | null;
  source_url: string | null;
  repo: string | null;
  repo_path: string | null;
  tags_json: string | null;
  confidence: number | null;
  usefulness: number | null;
  superseded_by_document_id: string | null;
};

type SnapshotRow = {
  id: string;
  document_id: string;
  revision: number;
  raw_markdown: string;
  body_markdown: string;
  frontmatter_json: string;
};

type ChunkLookupRow = {
  vector_id: string;
  content: string;
};

type ReindexJobRow = {
  id: string;
  status: string;
  path: string | null;
  workdrive_file_id: string | null;
  document_id: string | null;
};

type ProjectRow = {
  slug: string;
  display_name: string;
  description: string | null;
  status: "active" | "paused" | "archived";
  profile_json: string;
  owner_login: string | null;
  shared: number;
  workdrive_root_folder_id: string | null;
  context_current_folder_id: string | null;
  context_history_folder_id: string | null;
  decisions_folder_id: string | null;
  sessions_folder_id: string | null;
  snippets_folder_id: string | null;
  repo_index_folder_id: string | null;
  last_health_json: string | null;
  created_at: string;
  updated_at: string;
};

type ProjectGithubRepoRow = {
  id: string;
  project_slug: string;
  repo_full_name: string;
  default_branch: string | null;
  visibility: string | null;
  html_url: string | null;
  description: string | null;
  associated_by: string | null;
  associated_at: string;
  last_indexed_at: string | null;
  status: string;
};

type FolderCheckRow = {
  folder_path: string;
  folder_id: string | null;
  status: string;
  checked_at: string;
  error: string | null;
};

type CountRow = {
  count: number;
};

type InitiativeRow = {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  status: MemoryInitiative["status"];
  owner: string | null;
  horizon: string | null;
  priority: MemoryInitiative["priority"];
  starts_at: string | null;
  due_at: string | null;
  tags_json: string | null;
  metadata_json: string | null;
  created_at: string;
  updated_at: string;
};

type InitiativeProjectRow = {
  initiative_id: string;
  project_slug: string;
  role: string | null;
  status: string;
  created_at: string;
};

type EntityRow = {
  id: string;
  project: string;
  type: MemoryEntity["type"];
  slug: string;
  name: string;
  summary: string | null;
  source: string | null;
  source_id: string | null;
  confidence: number | null;
  metadata_json: string | null;
  created_at: string;
  updated_at: string;
};

type FactRow = {
  id: string;
  project: string;
  title: string;
  body: string;
  fact_key: string | null;
  status: DurableFact["status"];
  source: string | null;
  source_url: string | null;
  confidence: number | null;
  initiative_id: string | null;
  entity_id: string | null;
  document_id: string | null;
  metadata_json: string | null;
  created_at: string;
  updated_at: string;
};

type TaskRow = {
  id: string;
  project: string;
  title: string;
  description: string | null;
  status: ContextTask["status"];
  priority: ContextTask["priority"];
  due_at: string | null;
  owner: string | null;
  initiative_id: string | null;
  entity_id: string | null;
  source: string | null;
  source_url: string | null;
  reminder_at: string | null;
  metadata_json: string | null;
  created_at: string;
  updated_at: string;
};

type SourceEventRow = {
  id: string;
  project: string;
  source: string;
  source_id: string | null;
  event_type: string;
  occurred_at: string | null;
  title: string;
  summary: string;
  sensitivity: SourceEvent["sensitivity"];
  save_policy: SourceEvent["savePolicy"];
  initiative_id: string | null;
  entity_id: string | null;
  external_url: string | null;
  metadata_json: string | null;
  created_at: string;
  updated_at: string;
};

type MemoryLinkRow = {
  id: string;
  project: string;
  from_type: string;
  from_id: string;
  to_type: string;
  to_id: string;
  relation: string;
  weight: number;
  metadata_json: string | null;
  created_at: string;
};

export class MemoryRepository {
  constructor(private readonly db: D1Database) {}

  async getProject(slugOrAlias: string) {
    const direct = await this.db
      .prepare("SELECT * FROM projects WHERE slug = ?1")
      .bind(slugOrAlias)
      .first<ProjectRow>();
    if (direct) {
      return mapProject(direct);
    }

    const viaAlias = await this.db
      .prepare(
        `
          SELECT projects.*
          FROM project_aliases
          JOIN projects ON projects.slug = project_aliases.project_slug
          WHERE project_aliases.alias = ?1
        `,
      )
      .bind(slugOrAlias)
      .first<ProjectRow>();
    return mapProject(viaAlias);
  }

  async listProjects() {
    const result = await this.db
      .prepare("SELECT * FROM projects ORDER BY shared DESC, slug ASC")
      .all<ProjectRow>();
    return result.results.map((row) => mapProject(row)!);
  }

  async upsertProject(input: {
    slug: string;
    displayName: string;
    description?: string | null;
    status?: "active" | "paused" | "archived";
    profile?: Record<string, unknown>;
    ownerLogin?: string | null;
    shared?: boolean;
    workdriveRootFolderId?: string | null;
    contextCurrentFolderId?: string | null;
    contextHistoryFolderId?: string | null;
    decisionsFolderId?: string | null;
    sessionsFolderId?: string | null;
    snippetsFolderId?: string | null;
    repoIndexFolderId?: string | null;
    lastHealth?: Record<string, unknown> | null;
  }) {
    const existing = await this.getProject(input.slug);
    const now = new Date().toISOString();
    const profile = input.profile ?? existing?.profile ?? {};
    const lastHealth = input.lastHealth ?? existing?.lastHealth ?? null;

    await this.db
      .prepare(
        `
          INSERT INTO projects (
            slug, display_name, description, status, profile_json, owner_login, shared,
            workdrive_root_folder_id, context_current_folder_id, context_history_folder_id,
            decisions_folder_id, sessions_folder_id, snippets_folder_id, repo_index_folder_id,
            last_health_json, created_at, updated_at
          ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?16)
          ON CONFLICT(slug) DO UPDATE SET
            display_name = excluded.display_name,
            description = excluded.description,
            status = excluded.status,
            profile_json = excluded.profile_json,
            owner_login = COALESCE(excluded.owner_login, projects.owner_login),
            shared = excluded.shared,
            workdrive_root_folder_id = COALESCE(excluded.workdrive_root_folder_id, projects.workdrive_root_folder_id),
            context_current_folder_id = COALESCE(excluded.context_current_folder_id, projects.context_current_folder_id),
            context_history_folder_id = COALESCE(excluded.context_history_folder_id, projects.context_history_folder_id),
            decisions_folder_id = COALESCE(excluded.decisions_folder_id, projects.decisions_folder_id),
            sessions_folder_id = COALESCE(excluded.sessions_folder_id, projects.sessions_folder_id),
            snippets_folder_id = COALESCE(excluded.snippets_folder_id, projects.snippets_folder_id),
            repo_index_folder_id = COALESCE(excluded.repo_index_folder_id, projects.repo_index_folder_id),
            last_health_json = excluded.last_health_json,
            updated_at = excluded.updated_at
        `,
      )
      .bind(
        input.slug,
        input.displayName,
        input.description ?? existing?.description ?? null,
        input.status ?? existing?.status ?? "active",
        JSON.stringify(profile),
        input.ownerLogin ?? existing?.ownerLogin ?? null,
        input.shared ?? existing?.shared ? 1 : 0,
        input.workdriveRootFolderId ?? null,
        input.contextCurrentFolderId ?? null,
        input.contextHistoryFolderId ?? null,
        input.decisionsFolderId ?? null,
        input.sessionsFolderId ?? null,
        input.snippetsFolderId ?? null,
        input.repoIndexFolderId ?? null,
        lastHealth ? JSON.stringify(lastHealth) : null,
        existing?.createdAt ?? now,
      )
      .run();

    return this.getProject(input.slug);
  }

  async updateProjectProfile(input: {
    slug: string;
    displayName?: string;
    description?: string | null;
    status?: "active" | "paused" | "archived";
    profile?: Record<string, unknown>;
    aliases?: string[];
  }) {
    const existing = await this.getProject(input.slug);
    if (!existing) {
      throw new Error(`Project ${input.slug} does not exist.`);
    }
    const now = new Date().toISOString();
    await this.db
      .prepare(
        `
          UPDATE projects
          SET display_name = ?2, description = ?3, status = ?4, profile_json = ?5, updated_at = ?6
          WHERE slug = ?1
        `,
      )
      .bind(
        existing.slug,
        input.displayName ?? existing.displayName,
        input.description !== undefined ? input.description : existing.description,
        input.status ?? existing.status,
        JSON.stringify(input.profile ?? existing.profile),
        now,
      )
      .run();

    if (input.aliases) {
      for (const alias of input.aliases) {
        await this.db
          .prepare(
            `
              INSERT INTO project_aliases (alias, project_slug, created_at)
              VALUES (?1, ?2, ?3)
              ON CONFLICT(alias) DO UPDATE SET project_slug = excluded.project_slug
            `,
          )
          .bind(alias, existing.slug, now)
          .run();
      }
    }

    return this.getProject(existing.slug);
  }

  async recordProjectFolderCheck(input: {
    projectSlug: string;
    folderPath: string;
    folderId?: string | null;
    status: "ok" | "missing" | "error";
    error?: string | null;
  }) {
    await this.db
      .prepare(
        `
          INSERT INTO project_folder_checks (
            id, project_slug, folder_path, folder_id, status, checked_at, error
          ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
          ON CONFLICT(project_slug, folder_path) DO UPDATE SET
            folder_id = excluded.folder_id,
            status = excluded.status,
            checked_at = excluded.checked_at,
            error = excluded.error
        `,
      )
      .bind(
        crypto.randomUUID(),
        input.projectSlug,
        input.folderPath,
        input.folderId ?? null,
        input.status,
        new Date().toISOString(),
        input.error ?? null,
      )
      .run();
  }

  async listProjectFolderChecks(projectSlug: string) {
    const result = await this.db
      .prepare(
        "SELECT folder_path, folder_id, status, checked_at, error FROM project_folder_checks WHERE project_slug = ?1 ORDER BY folder_path",
      )
      .bind(projectSlug)
      .all<FolderCheckRow>();
    return result.results.map((row) => ({
      folder_path: row.folder_path,
      folder_id: row.folder_id,
      status: row.status,
      checked_at: row.checked_at,
      error: row.error,
    }));
  }

  async associateGithubRepo(input: {
    projectSlug: string;
    repoFullName: string;
    defaultBranch?: string | null;
    visibility?: string | null;
    htmlUrl?: string | null;
    description?: string | null;
    associatedBy?: string | null;
  }) {
    const now = new Date().toISOString();
    await this.db
      .prepare(
        `
          INSERT INTO project_github_repos (
            id, project_slug, repo_full_name, default_branch, visibility, html_url,
            description, associated_by, associated_at, status
          ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'active')
          ON CONFLICT(project_slug, repo_full_name) DO UPDATE SET
            default_branch = excluded.default_branch,
            visibility = excluded.visibility,
            html_url = excluded.html_url,
            description = excluded.description,
            associated_by = excluded.associated_by,
            status = 'active'
        `,
      )
      .bind(
        crypto.randomUUID(),
        input.projectSlug,
        input.repoFullName.toLowerCase(),
        input.defaultBranch ?? null,
        input.visibility ?? null,
        input.htmlUrl ?? null,
        input.description ?? null,
        input.associatedBy ?? null,
        now,
      )
      .run();
  }

  async listProjectGithubRepos(projectSlug: string) {
    const result = await this.db
      .prepare(
        "SELECT * FROM project_github_repos WHERE project_slug = ?1 AND status != 'archived' ORDER BY repo_full_name",
      )
      .bind(projectSlug)
      .all<ProjectGithubRepoRow>();
    return result.results.map((row) => mapProjectGithubRepo(row));
  }

  async createRepoIndexJob(input: {
    projectSlug: string;
    repoFullName: string;
    ref?: string | null;
    mode: string;
    globs?: string[];
    limits?: Record<string, unknown>;
    status?: string;
  }) {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await this.db
      .prepare(
        `
          INSERT INTO repo_index_jobs (
            id, project_slug, repo_full_name, ref, mode, globs_json, status,
            limits_json, created_at, updated_at
          ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)
        `,
      )
      .bind(
        id,
        input.projectSlug,
        input.repoFullName.toLowerCase(),
        input.ref ?? null,
        input.mode,
        JSON.stringify(input.globs ?? []),
        input.status ?? "running",
        JSON.stringify(input.limits ?? {}),
        now,
      )
      .run();
    return id;
  }

  async completeRepoIndexJob(
    id: string,
    input: { status: string; result?: unknown; error?: string | null },
  ) {
    await this.db
      .prepare(
        `
          UPDATE repo_index_jobs
          SET status = ?2, result_json = ?3, error = ?4, updated_at = ?5
          WHERE id = ?1
        `,
      )
      .bind(
        id,
        input.status,
        input.result === undefined ? null : JSON.stringify(input.result),
        input.error ?? null,
        new Date().toISOString(),
      )
      .run();
  }

  async markRepoIndexed(projectSlug: string, repoFullName: string) {
    await this.db
      .prepare(
        `
          UPDATE project_github_repos
          SET last_indexed_at = ?3
          WHERE project_slug = ?1 AND repo_full_name = ?2
        `,
      )
      .bind(projectSlug, repoFullName.toLowerCase(), new Date().toISOString())
      .run();
  }

  async findDedup(input: { project: string; memoryType: string; dedupKey: string }) {
    return (
      (await this.db
        .prepare(
          "SELECT document_id, content_sha256 FROM memory_write_dedup WHERE project = ?1 AND memory_type = ?2 AND dedup_key = ?3",
        )
        .bind(input.project, input.memoryType, input.dedupKey)
        .first<{ document_id: string | null; content_sha256: string }>()) ?? null
    );
  }

  async recordDedup(input: {
    project: string;
    memoryType: string;
    dedupKey: string;
    documentId?: string | null;
    contentSha256: string;
  }) {
    await this.db
      .prepare(
        `
          INSERT INTO memory_write_dedup (
            id, project, memory_type, dedup_key, document_id, content_sha256, created_at
          ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
          ON CONFLICT(project, memory_type, dedup_key) DO UPDATE SET
            document_id = COALESCE(excluded.document_id, memory_write_dedup.document_id),
            content_sha256 = excluded.content_sha256
        `,
      )
      .bind(
        crypto.randomUUID(),
        input.project,
        input.memoryType,
        input.dedupKey,
        input.documentId ?? null,
        input.contentSha256,
        new Date().toISOString(),
      )
      .run();
  }

  async getDocumentById(id: string) {
    return mapDocument(
      await this.db
        .prepare("SELECT * FROM documents WHERE id = ?1")
        .bind(id)
        .first<DocumentRow>(),
    );
  }

  async getDocumentByPath(path: string) {
    return mapDocument(
      await this.db
        .prepare("SELECT * FROM documents WHERE path = ?1")
        .bind(path)
        .first<DocumentRow>(),
    );
  }

  async getDocumentByWorkDriveFileId(fileId: string) {
    return mapDocument(
      await this.db
        .prepare("SELECT * FROM documents WHERE workdrive_file_id = ?1")
        .bind(fileId)
        .first<DocumentRow>(),
    );
  }

  async getLatestSnapshot(documentId: string) {
    const row = await this.db
      .prepare(
        "SELECT * FROM document_snapshots WHERE document_id = ?1 ORDER BY revision DESC LIMIT 1",
      )
      .bind(documentId)
      .first<SnapshotRow>();
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      documentId: row.document_id,
      revision: row.revision,
      rawMarkdown: row.raw_markdown,
      bodyMarkdown: row.body_markdown,
      frontmatter: JSON.parse(row.frontmatter_json) as MemoryFrontmatter,
    };
  }

  async getChunkContentsByVectorIds(vectorIds: string[]) {
    if (vectorIds.length === 0) {
      return new Map<string, string>();
    }
    const placeholders = vectorIds.map((_, index) => `?${index + 1}`).join(", ");
    const statement = this.db.prepare(
      `SELECT vector_id, content FROM chunks WHERE vector_id IN (${placeholders})`,
    );
    const result = await statement.bind(...vectorIds).all<ChunkLookupRow>();
    return new Map(result.results.map((row) => [row.vector_id, row.content]));
  }

  async getDocumentsByIds(documentIds: string[]) {
    if (documentIds.length === 0) {
      return new Map<string, ResolvedMemoryDocument>();
    }
    const uniqueIds = [...new Set(documentIds.filter(Boolean))];
    const placeholders = uniqueIds.map((_, index) => `?${index + 1}`).join(", ");
    const result = await this.db
      .prepare(`SELECT * FROM documents WHERE id IN (${placeholders})`)
      .bind(...uniqueIds)
      .all<DocumentRow>();
    return new Map(
      result.results
        .map((row) => mapDocument(row)!)
        .map((document) => [document.id, document]),
    );
  }

  async searchDocumentsKeyword(input: {
    query: string;
    project?: string;
    limit?: number;
    includeSuperseded?: boolean;
    memoryTypes?: MemoryType[];
    repo?: string;
    path?: string;
    source?: string;
  }) {
    const limit = Math.min(input.limit ?? 8, 20);
    const terms = [
      ...new Set(
        input.query
          .toLowerCase()
          .split(/[^a-z0-9/._-]+/)
          .map((term) => term.trim())
          .filter((term) => term.length > 2),
      ),
    ].slice(0, 10);
    const searchTerms = terms.length ? terms : [input.query.toLowerCase()];
    const binds: Array<string | number> = [...searchTerms];
    const termConditions = searchTerms.map((_, index) => {
      const placeholder = `?${index + 1}`;
      return `(instr(lower(title), ${placeholder}) > 0 OR instr(lower(path), ${placeholder}) > 0 OR instr(lower(COALESCE(tags_json, '')), ${placeholder}) > 0 OR instr(lower(COALESCE(source_url, '')), ${placeholder}) > 0 OR instr(lower(COALESCE(repo, '')), ${placeholder}) > 0 OR instr(lower(COALESCE(repo_path, '')), ${placeholder}) > 0)`;
    });
    const conditions = [`(${termConditions.join(" OR ")})`];

    if (input.project) {
      binds.push(input.project);
      conditions.push(`(project = 'shared' OR project = ?${binds.length})`);
    }
    if (!input.includeSuperseded) {
      conditions.push("status != 'superseded'");
      conditions.push("active = 1");
    }
    if (input.memoryTypes?.length) {
      const placeholders = input.memoryTypes.map((type) => {
        binds.push(type);
        return `?${binds.length}`;
      });
      conditions.push(`memory_type IN (${placeholders.join(", ")})`);
    }
    if (input.repo) {
      binds.push(input.repo.toLowerCase());
      conditions.push(`lower(COALESCE(repo, '')) = ?${binds.length}`);
    }
    if (input.path) {
      binds.push(input.path.toLowerCase());
      conditions.push(`instr(lower(COALESCE(repo_path, path, '')), ?${binds.length}) > 0`);
    }
    if (input.source) {
      binds.push(input.source.toLowerCase());
      conditions.push(`lower(COALESCE(source, '')) = ?${binds.length}`);
    }
    binds.push(limit);

    const result = await this.db
      .prepare(
        `
          SELECT * FROM documents
          WHERE ${conditions.join(" AND ")}
          ORDER BY active DESC, canonical DESC, updated_at DESC
          LIMIT ?${binds.length}
        `,
      )
      .bind(...binds)
      .all<DocumentRow>();
    return result.results.map((row) => mapDocument(row)!);
  }

  async getChunkVectorIdsForDocument(documentId: string) {
    const result = await this.db
      .prepare("SELECT vector_id, content FROM chunks WHERE document_id = ?1")
      .bind(documentId)
      .all<ChunkLookupRow>();
    return result.results.map((row) => row.vector_id);
  }

  async getChunkCountForDocument(documentId: string) {
    const row = await this.db
      .prepare("SELECT COUNT(*) as count FROM chunks WHERE document_id = ?1")
      .bind(documentId)
      .first<CountRow>();
    return row?.count ?? 0;
  }

  async createReindexJob(input: {
    scope: "document" | "crawl";
    documentId?: string;
    workdriveFileId?: string;
    path?: string;
    requestedBy?: string;
    reason: string;
    project?: string;
    jobKind?: string;
  }) {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await this.db
      .prepare(
        `
          INSERT INTO reindex_jobs (
            id, scope, document_id, workdrive_file_id, path, status, reason, attempts, requested_by,
            project, job_kind, created_at, updated_at
          ) VALUES (?1, ?2, ?3, ?4, ?5, 'queued', ?6, 0, ?7, ?8, ?9, ?10, ?10)
        `,
      )
      .bind(
        id,
        input.scope,
        input.documentId ?? null,
        input.workdriveFileId ?? null,
        input.path ?? null,
        input.reason,
        input.requestedBy ?? null,
        input.project ?? null,
        input.jobKind ?? null,
        now,
      )
      .run();
    return id;
  }

  async getReindexJob(jobId: string) {
    return (
      (await this.db
        .prepare("SELECT id, status, path, workdrive_file_id, document_id FROM reindex_jobs WHERE id = ?1")
        .bind(jobId)
        .first<ReindexJobRow>()) ?? null
    );
  }

  async updateReindexJob(
    jobId: string,
    input: { status: string; error?: string | null; incrementAttempts?: boolean },
  ) {
    await this.db
      .prepare(
        `
          UPDATE reindex_jobs
          SET
            status = ?2,
            error = ?3,
            attempts = attempts + ?4,
            updated_at = ?5
          WHERE id = ?1
        `,
      )
      .bind(
        jobId,
        input.status,
        input.error ?? null,
        input.incrementAttempts ? 1 : 0,
        new Date().toISOString(),
      )
      .run();
  }

  async upsertIndexedDocument(input: {
    documentId?: string;
    snapshotId?: string;
    workdriveFileId: string;
    path: string;
    title: string;
    project: string;
    namespace: string;
    parentFolderId: string;
    fileName: string;
    permalink?: string | null;
    downloadUrl?: string | null;
    memoryType: MemoryType;
    status: MemoryStatus;
    canonical: boolean;
    active: boolean;
    revision: number;
    source?: string | null;
    sourceUrl?: string | null;
    repo?: string | null;
    repoPath?: string | null;
    tags?: string[];
    confidence?: number | null;
    usefulness?: number | null;
    rawMarkdown: string;
    bodyMarkdown: string;
    frontmatter: MemoryFrontmatter;
    contentHash: string;
    lastRemoteModifiedAt?: number | null;
    chunks: ChunkRecord[];
  }) {
    const existing =
      (await this.getDocumentByWorkDriveFileId(input.workdriveFileId)) ??
      (await this.getDocumentByPath(input.path));

    const documentId = input.documentId ?? existing?.id ?? crypto.randomUUID();
    const snapshotId = input.snapshotId ?? crypto.randomUUID();
    const oldVectorIds = existing
      ? await this.getChunkVectorIdsForDocument(existing.id)
      : [];
    const now = new Date().toISOString();

    const statements = [
      this.db
        .prepare(
          `
            INSERT INTO documents (
              id, workdrive_file_id, path, title, project, namespace, parent_folder_id, file_name,
              permalink, download_url, memory_type, status, canonical, active, revision,
              current_snapshot_id, last_remote_modified_at, last_indexed_at, source, source_url,
              repo, repo_path, tags_json, confidence, usefulness, created_at, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26, ?26)
            ON CONFLICT(id) DO UPDATE SET
              workdrive_file_id = excluded.workdrive_file_id,
              path = excluded.path,
              title = excluded.title,
              project = excluded.project,
              namespace = excluded.namespace,
              parent_folder_id = excluded.parent_folder_id,
              file_name = excluded.file_name,
              permalink = excluded.permalink,
              download_url = excluded.download_url,
              memory_type = excluded.memory_type,
              status = excluded.status,
              canonical = excluded.canonical,
              active = excluded.active,
              revision = excluded.revision,
              current_snapshot_id = excluded.current_snapshot_id,
              last_remote_modified_at = excluded.last_remote_modified_at,
              last_indexed_at = excluded.last_indexed_at,
              source = excluded.source,
              source_url = excluded.source_url,
              repo = excluded.repo,
              repo_path = excluded.repo_path,
              tags_json = excluded.tags_json,
              confidence = excluded.confidence,
              usefulness = excluded.usefulness,
              updated_at = excluded.updated_at
          `,
        )
        .bind(
          documentId,
          input.workdriveFileId,
          input.path,
          input.title,
          input.project,
          input.namespace,
          input.parentFolderId,
          input.fileName,
          input.permalink ?? null,
          input.downloadUrl ?? null,
          input.memoryType,
          input.status,
          input.canonical ? 1 : 0,
          input.active ? 1 : 0,
          input.revision,
          snapshotId,
          input.lastRemoteModifiedAt ?? null,
          Date.now(),
          input.source ?? null,
          input.sourceUrl ?? null,
          input.repo ?? null,
          input.repoPath ?? null,
          JSON.stringify(input.tags ?? input.frontmatter.tags ?? []),
          input.confidence ?? null,
          input.usefulness ?? null,
          now,
        ),
      this.db
        .prepare(
          `
            INSERT INTO document_snapshots (
              id, document_id, workdrive_file_id, revision, content_sha256, raw_markdown, frontmatter_json,
              body_markdown, status, created_at, remote_modified_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
          `,
        )
        .bind(
          snapshotId,
          documentId,
          input.workdriveFileId,
          input.revision,
          input.contentHash,
          input.rawMarkdown,
          JSON.stringify(input.frontmatter),
          input.bodyMarkdown,
          input.status,
          now,
          input.lastRemoteModifiedAt ?? null,
        ),
      this.db.prepare("DELETE FROM chunks WHERE document_id = ?1").bind(documentId),
      ...input.chunks.map((chunk) =>
        this.db
          .prepare(
            `
              INSERT INTO chunks (
                vector_id, document_id, snapshot_id, namespace, chunk_index, heading_path,
                content, token_estimate, updated_at_unix, project, memory_type, status, repo,
                repo_path, tags_json
              ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)
            `,
          )
          .bind(
            chunk.vectorId,
            documentId,
            snapshotId,
            input.namespace,
            chunk.chunkIndex,
            chunk.headingPath,
            chunk.content,
            chunk.tokenEstimate,
            chunk.updatedAtUnix,
            input.project,
            input.memoryType,
            input.status,
            input.repo ?? null,
            input.repoPath ?? null,
            JSON.stringify(input.tags ?? input.frontmatter.tags ?? []),
          ),
      ),
    ];

    await this.db.batch(statements);
    return {
      documentId,
      snapshotId,
      oldVectorIds,
    };
  }

  async recordSupersession(input: {
    fromDocumentId: string;
    fromSnapshotId: string;
    toDocumentId: string;
    relationType: "canonical_update" | "decision_override";
  }) {
    await this.db
      .prepare(
        `
          INSERT INTO supersessions (
            id, from_document_id, from_snapshot_id, to_document_id, relation_type, recorded_at
          ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
        `,
      )
      .bind(
        crypto.randomUUID(),
        input.fromDocumentId,
        input.fromSnapshotId,
        input.toDocumentId,
        input.relationType,
        new Date().toISOString(),
      )
      .run();
  }

  async markDocumentsSuperseded(input: {
    documentIds: string[];
    supersededByDocumentId?: string | null;
  }) {
    for (const documentId of input.documentIds) {
      await this.db
        .prepare(
          `
            UPDATE documents
            SET status = 'superseded', active = 0, superseded_by_document_id = ?2, updated_at = ?3
            WHERE id = ?1
          `,
        )
        .bind(documentId, input.supersededByDocumentId ?? null, new Date().toISOString())
        .run();
    }
  }

  async listCurrentContextDocuments(project?: string) {
    const result = project
      ? await this.db
          .prepare(
            `
              SELECT * FROM documents
              WHERE active = 1
                AND project = ?1
                AND memory_type IN ('current_context', 'decision')
              ORDER BY canonical DESC, updated_at DESC
            `,
          )
          .bind(project)
          .all<DocumentRow>()
      : await this.db
          .prepare(
            `
              SELECT * FROM documents
              WHERE active = 1
                AND project = 'shared'
                AND memory_type IN ('current_context', 'decision')
              ORDER BY updated_at DESC
            `,
          )
          .all<DocumentRow>();

    return result.results.map((row) => mapDocument(row)!);
  }

  async listDocumentsByProject(project?: string) {
    const result = project
      ? await this.db
          .prepare("SELECT * FROM documents WHERE project = ?1 OR project = 'shared'")
          .bind(project)
          .all<DocumentRow>()
      : await this.db.prepare("SELECT * FROM documents WHERE project = 'shared'").all<DocumentRow>();
    return result.results.map((row) => mapDocument(row)!);
  }

  async getProjectStats(projectSlug: string) {
    const [documentCount, currentContextCount, decisionCount, chunkCount, failedJobs] = await Promise.all([
      this.db
        .prepare("SELECT COUNT(*) as count FROM documents WHERE project = ?1")
        .bind(projectSlug)
        .first<CountRow>(),
      this.db
        .prepare("SELECT COUNT(*) as count FROM documents WHERE project = ?1 AND memory_type = 'current_context' AND active = 1")
        .bind(projectSlug)
        .first<CountRow>(),
      this.db
        .prepare("SELECT COUNT(*) as count FROM documents WHERE project = ?1 AND memory_type = 'decision' AND active = 1")
        .bind(projectSlug)
        .first<CountRow>(),
      this.db
        .prepare("SELECT COUNT(*) as count FROM chunks WHERE project = ?1")
        .bind(projectSlug)
        .first<CountRow>(),
      this.db
        .prepare("SELECT COUNT(*) as count FROM reindex_jobs WHERE (project = ?1 OR path LIKE ?2) AND status = 'failed' AND reason != 'reconciliation'")
        .bind(projectSlug, `%/projects/${projectSlug}/%`)
        .first<CountRow>(),
    ]);

    return {
      document_count: documentCount?.count ?? 0,
      current_context_count: currentContextCount?.count ?? 0,
      active_decision_count: decisionCount?.count ?? 0,
      chunk_count: chunkCount?.count ?? 0,
      failed_job_count: failedJobs?.count ?? 0,
    };
  }

  async upsertInitiative(input: {
    id?: string;
    slug: string;
    title: string;
    summary?: string | null;
    status?: MemoryInitiative["status"];
    owner?: string | null;
    horizon?: string | null;
    priority?: MemoryInitiative["priority"];
    startsAt?: string | null;
    dueAt?: string | null;
    tags?: string[];
    metadata?: Record<string, unknown>;
    projectSlugs?: string[];
  }) {
    const now = new Date().toISOString();
    const existing = await this.getInitiativeBySlug(input.slug);
    const id = input.id ?? existing?.id ?? crypto.randomUUID();
    await this.db
      .prepare(
        `
          INSERT INTO initiatives (
            id, slug, title, summary, status, owner, horizon, priority, starts_at, due_at,
            tags_json, metadata_json, created_at, updated_at
          ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
          ON CONFLICT(slug) DO UPDATE SET
            title = excluded.title,
            summary = excluded.summary,
            status = excluded.status,
            owner = excluded.owner,
            horizon = excluded.horizon,
            priority = excluded.priority,
            starts_at = excluded.starts_at,
            due_at = excluded.due_at,
            tags_json = excluded.tags_json,
            metadata_json = excluded.metadata_json,
            updated_at = excluded.updated_at
        `,
      )
      .bind(
        id,
        input.slug,
        input.title,
        input.summary ?? existing?.summary ?? null,
        input.status ?? existing?.status ?? "active",
        input.owner ?? existing?.owner ?? null,
        input.horizon ?? existing?.horizon ?? null,
        input.priority ?? existing?.priority ?? "normal",
        input.startsAt ?? existing?.startsAt ?? null,
        input.dueAt ?? existing?.dueAt ?? null,
        JSON.stringify(input.tags ?? existing?.tags ?? []),
        JSON.stringify(input.metadata ?? existing?.metadata ?? {}),
        existing?.createdAt ?? now,
        now,
      )
      .run();

    for (const projectSlug of input.projectSlugs ?? []) {
      await this.linkInitiativeProject({
        initiativeId: id,
        projectSlug,
      });
    }
    return this.getInitiativeBySlug(input.slug);
  }

  async getInitiativeBySlug(slug: string) {
    return mapInitiative(
      await this.db
        .prepare("SELECT * FROM initiatives WHERE slug = ?1")
        .bind(slug)
        .first<InitiativeRow>(),
    );
  }

  async getInitiativeById(id: string) {
    return mapInitiative(
      await this.db
        .prepare("SELECT * FROM initiatives WHERE id = ?1")
        .bind(id)
        .first<InitiativeRow>(),
    );
  }

  async listInitiatives(input: { status?: string; project?: string; limit?: number } = {}) {
    const limit = Math.min(input.limit ?? 50, 100);
    if (input.project) {
      const result = await this.db
        .prepare(
          `
            SELECT initiatives.*
            FROM initiatives
            JOIN initiative_projects ON initiative_projects.initiative_id = initiatives.id
            WHERE initiative_projects.project_slug = ?1
              AND initiative_projects.status != 'archived'
              AND (?2 IS NULL OR initiatives.status = ?2)
            ORDER BY initiatives.status = 'active' DESC, initiatives.updated_at DESC
            LIMIT ?3
          `,
        )
        .bind(input.project, input.status ?? null, limit)
        .all<InitiativeRow>();
      return result.results.map((row) => mapInitiative(row)!);
    }
    const result = await this.db
      .prepare(
        `
          SELECT * FROM initiatives
          WHERE (?1 IS NULL OR status = ?1)
          ORDER BY status = 'active' DESC, updated_at DESC
          LIMIT ?2
        `,
      )
      .bind(input.status ?? null, limit)
      .all<InitiativeRow>();
    return result.results.map((row) => mapInitiative(row)!);
  }

  async linkInitiativeProject(input: {
    initiativeId: string;
    projectSlug: string;
    role?: string | null;
    status?: string;
  }) {
    await this.db
      .prepare(
        `
          INSERT INTO initiative_projects (initiative_id, project_slug, role, status, created_at)
          VALUES (?1, ?2, ?3, ?4, ?5)
          ON CONFLICT(initiative_id, project_slug) DO UPDATE SET
            role = COALESCE(excluded.role, initiative_projects.role),
            status = excluded.status
        `,
      )
      .bind(
        input.initiativeId,
        input.projectSlug,
        input.role ?? null,
        input.status ?? "active",
        new Date().toISOString(),
      )
      .run();
  }

  async listInitiativeProjects(initiativeId: string) {
    const result = await this.db
      .prepare(
        "SELECT * FROM initiative_projects WHERE initiative_id = ?1 AND status != 'archived' ORDER BY project_slug",
      )
      .bind(initiativeId)
      .all<InitiativeProjectRow>();
    return result.results.map(mapInitiativeProject);
  }

  async upsertEntity(input: {
    id?: string;
    project: string;
    type: MemoryEntity["type"];
    slug: string;
    name: string;
    summary?: string | null;
    source?: string | null;
    sourceId?: string | null;
    confidence?: number | null;
    metadata?: Record<string, unknown>;
  }) {
    const now = new Date().toISOString();
    const existing = await this.findEntity({
      project: input.project,
      type: input.type,
      slug: input.slug,
    });
    const id = input.id ?? existing?.id ?? crypto.randomUUID();
    await this.db
      .prepare(
        `
          INSERT INTO memory_entities (
            id, project, type, slug, name, summary, source, source_id, confidence,
            metadata_json, created_at, updated_at
          ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
          ON CONFLICT(project, type, slug) DO UPDATE SET
            name = excluded.name,
            summary = excluded.summary,
            source = excluded.source,
            source_id = excluded.source_id,
            confidence = excluded.confidence,
            metadata_json = excluded.metadata_json,
            updated_at = excluded.updated_at
        `,
      )
      .bind(
        id,
        input.project,
        input.type,
        input.slug,
        input.name,
        input.summary ?? existing?.summary ?? null,
        input.source ?? existing?.source ?? null,
        input.sourceId ?? existing?.sourceId ?? null,
        input.confidence ?? existing?.confidence ?? null,
        JSON.stringify(input.metadata ?? existing?.metadata ?? {}),
        existing?.createdAt ?? now,
        now,
      )
      .run();
    return this.findEntity({ project: input.project, type: input.type, slug: input.slug });
  }

  async findEntity(input: { project: string; type: string; slug: string }) {
    return mapEntity(
      await this.db
        .prepare("SELECT * FROM memory_entities WHERE project = ?1 AND type = ?2 AND slug = ?3")
        .bind(input.project, input.type, input.slug)
        .first<EntityRow>(),
    );
  }

  async getEntity(id: string) {
    return mapEntity(
      await this.db
        .prepare("SELECT * FROM memory_entities WHERE id = ?1")
        .bind(id)
        .first<EntityRow>(),
    );
  }

  async searchEntities(input: { project?: string; query?: string; limit?: number }) {
    const limit = Math.min(input.limit ?? 20, 50);
    const query = input.query?.toLowerCase();
    const result = await this.db
      .prepare(
        `
          SELECT * FROM memory_entities
          WHERE (?1 IS NULL OR project = ?1 OR project = 'shared')
            AND (?2 IS NULL OR instr(lower(name), ?2) > 0 OR instr(lower(slug), ?2) > 0 OR instr(lower(COALESCE(summary, '')), ?2) > 0)
          ORDER BY updated_at DESC
          LIMIT ?3
        `,
      )
      .bind(input.project ?? null, query ?? null, limit)
      .all<EntityRow>();
    return result.results.map((row) => mapEntity(row)!);
  }

  async upsertTask(input: {
    id?: string;
    project: string;
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
  }) {
    const now = new Date().toISOString();
    const existing = input.id ? await this.getTask(input.id) : null;
    const id = input.id ?? crypto.randomUUID();
    await this.db
      .prepare(
        `
          INSERT INTO context_tasks (
            id, project, title, description, status, priority, due_at, owner,
            initiative_id, entity_id, source, source_url, reminder_at, metadata_json,
            created_at, updated_at
          ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)
          ON CONFLICT(id) DO UPDATE SET
            project = excluded.project,
            title = excluded.title,
            description = excluded.description,
            status = excluded.status,
            priority = excluded.priority,
            due_at = excluded.due_at,
            owner = excluded.owner,
            initiative_id = excluded.initiative_id,
            entity_id = excluded.entity_id,
            source = excluded.source,
            source_url = excluded.source_url,
            reminder_at = excluded.reminder_at,
            metadata_json = excluded.metadata_json,
            updated_at = excluded.updated_at
        `,
      )
      .bind(
        id,
        input.project,
        input.title,
        input.description ?? existing?.description ?? null,
        input.status ?? existing?.status ?? "open",
        input.priority ?? existing?.priority ?? "normal",
        input.dueAt ?? existing?.dueAt ?? null,
        input.owner ?? existing?.owner ?? null,
        input.initiativeId ?? existing?.initiativeId ?? null,
        input.entityId ?? existing?.entityId ?? null,
        input.source ?? existing?.source ?? null,
        input.sourceUrl ?? existing?.sourceUrl ?? null,
        input.reminderAt ?? existing?.reminderAt ?? null,
        JSON.stringify(input.metadata ?? existing?.metadata ?? {}),
        existing?.createdAt ?? now,
        now,
      )
      .run();
    return this.getTask(id);
  }

  async getTask(id: string) {
    return mapTask(
      await this.db
        .prepare("SELECT * FROM context_tasks WHERE id = ?1")
        .bind(id)
        .first<TaskRow>(),
    );
  }

  async listTasks(input: {
    project?: string;
    initiativeId?: string;
    entityId?: string;
    includeDone?: boolean;
    dueBefore?: string;
    limit?: number;
  } = {}) {
    const limit = Math.min(input.limit ?? 30, 100);
    const result = await this.db
      .prepare(
        `
          SELECT * FROM context_tasks
          WHERE (?1 IS NULL OR project = ?1 OR project = 'shared')
            AND (?2 IS NULL OR initiative_id = ?2)
            AND (?3 IS NULL OR entity_id = ?3)
            AND (?4 = 1 OR status NOT IN ('done', 'cancelled'))
            AND (?5 IS NULL OR due_at <= ?5 OR reminder_at <= ?5)
          ORDER BY
            CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
            COALESCE(due_at, reminder_at, updated_at) ASC
          LIMIT ?6
        `,
      )
      .bind(
        input.project ?? null,
        input.initiativeId ?? null,
        input.entityId ?? null,
        input.includeDone ? 1 : 0,
        input.dueBefore ?? null,
        limit,
      )
      .all<TaskRow>();
    return result.results.map((row) => mapTask(row)!);
  }

  async saveSourceEvent(input: {
    id?: string;
    project: string;
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
  }) {
    const now = new Date().toISOString();
    const id = input.id ?? crypto.randomUUID();
    await this.db
      .prepare(
        `
          INSERT INTO source_events (
            id, project, source, source_id, event_type, occurred_at, title, summary,
            sensitivity, save_policy, initiative_id, entity_id, external_url,
            metadata_json, created_at, updated_at
          ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)
          ON CONFLICT(project, source, source_id) DO UPDATE SET
            event_type = excluded.event_type,
            occurred_at = excluded.occurred_at,
            title = excluded.title,
            summary = excluded.summary,
            sensitivity = excluded.sensitivity,
            save_policy = excluded.save_policy,
            initiative_id = excluded.initiative_id,
            entity_id = excluded.entity_id,
            external_url = excluded.external_url,
            metadata_json = excluded.metadata_json,
            updated_at = excluded.updated_at
        `,
      )
      .bind(
        id,
        input.project,
        input.source,
        input.sourceId ?? null,
        input.eventType,
        input.occurredAt ?? null,
        input.title,
        input.summary,
        input.sensitivity ?? "internal",
        input.savePolicy ?? "durable_summary",
        input.initiativeId ?? null,
        input.entityId ?? null,
        input.externalUrl ?? null,
        JSON.stringify(input.metadata ?? {}),
        now,
        now,
      )
      .run();
    return input.sourceId
      ? this.getSourceEventBySource(input.project, input.source, input.sourceId)
      : this.getSourceEvent(id);
  }

  async getSourceEvent(id: string) {
    return mapSourceEvent(
      await this.db
        .prepare("SELECT * FROM source_events WHERE id = ?1")
        .bind(id)
        .first<SourceEventRow>(),
    );
  }

  async getSourceEventBySource(project: string, source: string, sourceId: string) {
    return mapSourceEvent(
      await this.db
        .prepare("SELECT * FROM source_events WHERE project = ?1 AND source = ?2 AND source_id = ?3")
        .bind(project, source, sourceId)
        .first<SourceEventRow>(),
    );
  }

  async listSourceEvents(input: { project?: string; source?: string; limit?: number } = {}) {
    const limit = Math.min(input.limit ?? 20, 100);
    const result = await this.db
      .prepare(
        `
          SELECT * FROM source_events
          WHERE (?1 IS NULL OR project = ?1 OR project = 'shared')
            AND (?2 IS NULL OR source = ?2)
          ORDER BY COALESCE(occurred_at, updated_at) DESC
          LIMIT ?3
        `,
      )
      .bind(input.project ?? null, input.source ?? null, limit)
      .all<SourceEventRow>();
    return result.results.map((row) => mapSourceEvent(row)!);
  }

  async upsertFact(input: {
    id?: string;
    project: string;
    title: string;
    body: string;
    factKey?: string | null;
    status?: DurableFact["status"];
    source?: string | null;
    sourceUrl?: string | null;
    confidence?: number | null;
    initiativeId?: string | null;
    entityId?: string | null;
    documentId?: string | null;
    metadata?: Record<string, unknown>;
  }) {
    const now = new Date().toISOString();
    const id = input.id ?? crypto.randomUUID();
    await this.db
      .prepare(
        `
          INSERT INTO durable_facts (
            id, project, title, body, fact_key, status, source, source_url, confidence,
            initiative_id, entity_id, document_id, metadata_json, created_at, updated_at
          ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)
          ON CONFLICT(project, fact_key) DO UPDATE SET
            title = excluded.title,
            body = excluded.body,
            status = excluded.status,
            source = excluded.source,
            source_url = excluded.source_url,
            confidence = excluded.confidence,
            initiative_id = excluded.initiative_id,
            entity_id = excluded.entity_id,
            document_id = excluded.document_id,
            metadata_json = excluded.metadata_json,
            updated_at = excluded.updated_at
        `,
      )
      .bind(
        id,
        input.project,
        input.title,
        input.body,
        input.factKey ?? null,
        input.status ?? "active",
        input.source ?? null,
        input.sourceUrl ?? null,
        input.confidence ?? null,
        input.initiativeId ?? null,
        input.entityId ?? null,
        input.documentId ?? null,
        JSON.stringify(input.metadata ?? {}),
        now,
        now,
      )
      .run();
    return input.factKey ? this.getFactByKey(input.project, input.factKey) : this.getFact(id);
  }

  async getFact(id: string) {
    return mapFact(
      await this.db
        .prepare("SELECT * FROM durable_facts WHERE id = ?1")
        .bind(id)
        .first<FactRow>(),
    );
  }

  async getFactByKey(project: string, factKey: string) {
    return mapFact(
      await this.db
        .prepare("SELECT * FROM durable_facts WHERE project = ?1 AND fact_key = ?2")
        .bind(project, factKey)
        .first<FactRow>(),
    );
  }

  async listFacts(input: { project?: string; initiativeId?: string; entityId?: string; limit?: number } = {}) {
    const limit = Math.min(input.limit ?? 20, 100);
    const result = await this.db
      .prepare(
        `
          SELECT * FROM durable_facts
          WHERE status = 'active'
            AND (?1 IS NULL OR project = ?1 OR project = 'shared')
            AND (?2 IS NULL OR initiative_id = ?2)
            AND (?3 IS NULL OR entity_id = ?3)
          ORDER BY updated_at DESC
          LIMIT ?4
        `,
      )
      .bind(input.project ?? null, input.initiativeId ?? null, input.entityId ?? null, limit)
      .all<FactRow>();
    return result.results.map((row) => mapFact(row)!);
  }

  async linkMemory(input: {
    project: string;
    fromType: string;
    fromId: string;
    toType: string;
    toId: string;
    relation: string;
    weight?: number;
    metadata?: Record<string, unknown>;
  }) {
    await this.db
      .prepare(
        `
          INSERT INTO memory_links (
            id, project, from_type, from_id, to_type, to_id, relation, weight,
            metadata_json, created_at
          ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
          ON CONFLICT(project, from_type, from_id, to_type, to_id, relation) DO UPDATE SET
            weight = excluded.weight,
            metadata_json = excluded.metadata_json
        `,
      )
      .bind(
        crypto.randomUUID(),
        input.project,
        input.fromType,
        input.fromId,
        input.toType,
        input.toId,
        input.relation,
        input.weight ?? 1,
        JSON.stringify(input.metadata ?? {}),
        new Date().toISOString(),
      )
      .run();
    return this.listLinks({
      project: input.project,
      fromType: input.fromType,
      fromId: input.fromId,
    });
  }

  async listLinks(input: { project?: string; fromType?: string; fromId?: string; toType?: string; toId?: string } = {}) {
    const result = await this.db
      .prepare(
        `
          SELECT * FROM memory_links
          WHERE (?1 IS NULL OR project = ?1 OR project = 'shared')
            AND (?2 IS NULL OR from_type = ?2)
            AND (?3 IS NULL OR from_id = ?3)
            AND (?4 IS NULL OR to_type = ?4)
            AND (?5 IS NULL OR to_id = ?5)
          ORDER BY weight DESC, created_at DESC
          LIMIT 100
        `,
      )
      .bind(
        input.project ?? null,
        input.fromType ?? null,
        input.fromId ?? null,
        input.toType ?? null,
        input.toId ?? null,
      )
      .all<MemoryLinkRow>();
    return result.results.map(mapMemoryLink);
  }

  async listRelatedProjects(projectSlug: string) {
    const [direct, reverse, initiativeRows] = await Promise.all([
      this.db
        .prepare(
          "SELECT target_project_slug as slug, relation, reason FROM project_relations WHERE source_project_slug = ?1 AND status = 'active'",
        )
        .bind(projectSlug)
        .all<{ slug: string; relation: string; reason: string | null }>(),
      this.db
        .prepare(
          "SELECT source_project_slug as slug, relation, reason FROM project_relations WHERE target_project_slug = ?1 AND status = 'active'",
        )
        .bind(projectSlug)
        .all<{ slug: string; relation: string; reason: string | null }>(),
      this.db
        .prepare(
          `
            SELECT other.project_slug as slug, 'same_initiative' as relation, initiatives.title as reason
            FROM initiative_projects self
            JOIN initiative_projects other ON other.initiative_id = self.initiative_id
            JOIN initiatives ON initiatives.id = self.initiative_id
            WHERE self.project_slug = ?1
              AND other.project_slug != ?1
              AND self.status != 'archived'
              AND other.status != 'archived'
              AND initiatives.status = 'active'
          `,
        )
        .bind(projectSlug)
        .all<{ slug: string; relation: string; reason: string | null }>(),
    ]);
    const seen = new Set<string>();
    return [...direct.results, ...reverse.results, ...initiativeRows.results].filter((item) => {
      if (seen.has(item.slug)) {
        return false;
      }
      seen.add(item.slug);
      return true;
    });
  }

  async getAdminStatus() {
    const [projects, failedJobs, queuedJobs, lastSync] = await Promise.all([
      this.db.prepare("SELECT COUNT(*) as count FROM projects").first<CountRow>(),
      this.db.prepare("SELECT COUNT(*) as count FROM reindex_jobs WHERE status = 'failed'").first<CountRow>(),
      this.db.prepare("SELECT COUNT(*) as count FROM reindex_jobs WHERE status = 'queued'").first<CountRow>(),
      this.db.prepare("SELECT * FROM sync_runs ORDER BY created_at DESC LIMIT 1").first<Record<string, unknown>>(),
    ]);
    return {
      project_count: projects?.count ?? 0,
      failed_reindex_jobs: failedJobs?.count ?? 0,
      queued_reindex_jobs: queuedJobs?.count ?? 0,
      last_sync: lastSync ?? null,
    };
  }

  async createSyncRun(triggerKind: "cron" | "manual") {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await this.db
      .prepare(
        `
          INSERT INTO sync_runs (id, trigger_kind, status, scanned_count, enqueued_count, created_at, updated_at)
          VALUES (?1, ?2, 'running', 0, 0, ?3, ?3)
        `,
      )
      .bind(id, triggerKind, now)
      .run();
    return id;
  }

  async completeSyncRun(
    syncRunId: string,
    input: { status: "completed" | "failed"; scannedCount: number; enqueuedCount: number; error?: string | null },
  ) {
    await this.db
      .prepare(
        `
          UPDATE sync_runs
          SET status = ?2, scanned_count = ?3, enqueued_count = ?4, error = ?5, updated_at = ?6
          WHERE id = ?1
        `,
      )
      .bind(
        syncRunId,
        input.status,
        input.scannedCount,
        input.enqueuedCount,
        input.error ?? null,
        new Date().toISOString(),
      )
      .run();
  }
}

function mapDocument(row?: DocumentRow | null): ResolvedMemoryDocument | null {
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    workdriveFileId: row.workdrive_file_id,
    currentSnapshotId: row.current_snapshot_id,
    path: row.path,
    title: row.title,
    project: row.project,
    namespace: row.namespace,
    parentFolderId: row.parent_folder_id,
    fileName: row.file_name,
    permalink: row.permalink,
    downloadUrl: row.download_url,
    memoryType: row.memory_type,
    status: row.status,
    canonical: row.canonical === 1,
    active: row.active === 1,
    revision: row.revision,
    source: row.source,
    sourceUrl: row.source_url,
    repo: row.repo,
    repoPath: row.repo_path,
    tags: parseJsonArray(row.tags_json),
    confidence: row.confidence,
    usefulness: row.usefulness,
    supersededByDocumentId: row.superseded_by_document_id,
    lastRemoteModifiedAt: row.last_remote_modified_at,
  };
}

function mapProject(row?: ProjectRow | null): MemoryProject | null {
  if (!row) {
    return null;
  }
  return {
    slug: row.slug,
    displayName: row.display_name,
    description: row.description,
    status: row.status,
    profile: parseJsonObject(row.profile_json),
    ownerLogin: row.owner_login,
    shared: row.shared === 1,
    workdriveRootFolderId: row.workdrive_root_folder_id,
    contextCurrentFolderId: row.context_current_folder_id,
    contextHistoryFolderId: row.context_history_folder_id,
    decisionsFolderId: row.decisions_folder_id,
    sessionsFolderId: row.sessions_folder_id,
    snippetsFolderId: row.snippets_folder_id,
    repoIndexFolderId: row.repo_index_folder_id,
    lastHealth: row.last_health_json ? parseJsonObject(row.last_health_json) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapProjectGithubRepo(row: ProjectGithubRepoRow): ProjectGithubRepo {
  return {
    id: row.id,
    projectSlug: row.project_slug,
    repoFullName: row.repo_full_name,
    defaultBranch: row.default_branch,
    visibility: row.visibility,
    htmlUrl: row.html_url,
    description: row.description,
    associatedBy: row.associated_by,
    associatedAt: row.associated_at,
    lastIndexedAt: row.last_indexed_at,
    status: row.status,
  };
}

function mapInitiative(row?: InitiativeRow | null): MemoryInitiative | null {
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    status: row.status,
    owner: row.owner,
    horizon: row.horizon,
    priority: row.priority,
    startsAt: row.starts_at,
    dueAt: row.due_at,
    tags: parseJsonArray(row.tags_json),
    metadata: parseJsonObject(row.metadata_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapInitiativeProject(row: InitiativeProjectRow): InitiativeProject {
  return {
    initiativeId: row.initiative_id,
    projectSlug: row.project_slug,
    role: row.role,
    status: row.status,
    createdAt: row.created_at,
  };
}

function mapEntity(row?: EntityRow | null): MemoryEntity | null {
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    project: row.project,
    type: row.type,
    slug: row.slug,
    name: row.name,
    summary: row.summary,
    source: row.source,
    sourceId: row.source_id,
    confidence: row.confidence,
    metadata: parseJsonObject(row.metadata_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapFact(row?: FactRow | null): DurableFact | null {
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    project: row.project,
    title: row.title,
    body: row.body,
    factKey: row.fact_key,
    status: row.status,
    source: row.source,
    sourceUrl: row.source_url,
    confidence: row.confidence,
    initiativeId: row.initiative_id,
    entityId: row.entity_id,
    documentId: row.document_id,
    metadata: parseJsonObject(row.metadata_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapTask(row?: TaskRow | null): ContextTask | null {
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    project: row.project,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    dueAt: row.due_at,
    owner: row.owner,
    initiativeId: row.initiative_id,
    entityId: row.entity_id,
    source: row.source,
    sourceUrl: row.source_url,
    reminderAt: row.reminder_at,
    metadata: parseJsonObject(row.metadata_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSourceEvent(row?: SourceEventRow | null): SourceEvent | null {
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    project: row.project,
    source: row.source,
    sourceId: row.source_id,
    eventType: row.event_type,
    occurredAt: row.occurred_at,
    title: row.title,
    summary: row.summary,
    sensitivity: row.sensitivity,
    savePolicy: row.save_policy,
    initiativeId: row.initiative_id,
    entityId: row.entity_id,
    externalUrl: row.external_url,
    metadata: parseJsonObject(row.metadata_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMemoryLink(row: MemoryLinkRow): MemoryLink {
  return {
    id: row.id,
    project: row.project,
    fromType: row.from_type,
    fromId: row.from_id,
    toType: row.to_type,
    toId: row.to_id,
    relation: row.relation,
    weight: row.weight,
    metadata: parseJsonObject(row.metadata_json),
    createdAt: row.created_at,
  };
}

function parseJsonObject(value: string | null): Record<string, unknown> {
  if (!value) {
    return {};
  }
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function parseJsonArray(value: string | null): string[] {
  if (!value) {
    return [];
  }
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}
