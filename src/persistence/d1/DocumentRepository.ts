import type {
  ChunkRecord,
  ContextTruthMigrationManifest,
  MemoryFrontmatter,
  MemoryLayer,
  MemoryStatus,
  MemoryType,
  MigrationAuditEvent,
  ResolvedMemoryDocument,
  WorkdriveCanonicalizationManifest,
} from "~/domain/memory";
import type {
  ChunkLookupRow,
  ContextTruthMigrationManifestRow,
  DocumentRow,
  MigrationAuditEventRow,
  ReindexJobRow,
  SnapshotRow,
  WorkdriveCanonicalizationManifestRow,
} from "~/persistence/d1/types";

export class DocumentRepository {
  constructor(private readonly db: D1Database) {}

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
      conditions.push("status IN ('active', 'historical')");
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

  async listChunksForDocument(documentId: string) {
    const result = await this.db
      .prepare(
        `
          SELECT vector_id, chunk_index, heading_path, content, token_estimate, updated_at_unix
          FROM chunks
          WHERE document_id = ?1
          ORDER BY chunk_index ASC
        `,
      )
      .bind(documentId)
      .all<{
        vector_id: string;
        chunk_index: number;
        heading_path: string;
        content: string;
        token_estimate: number;
        updated_at_unix: number;
      }>();
    return result.results.map((row) => ({
      vectorId: row.vector_id,
      chunkIndex: row.chunk_index,
      headingPath: row.heading_path,
      content: row.content,
      tokenEstimate: row.token_estimate,
      updatedAtUnix: row.updated_at_unix,
    }));
  }

  async getChunkCountForDocument(documentId: string) {
    const row = await this.db
      .prepare("SELECT COUNT(*) as count FROM chunks WHERE document_id = ?1")
      .bind(documentId)
      .first<{ count: number }>();
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

  async listAllDocuments(input: { project?: string; limit?: number } = {}) {
    const limit = Math.min(input.limit ?? 1000, 5000);
    const result = await this.db
      .prepare(
        `
          SELECT * FROM documents
          WHERE (?1 IS NULL OR project = ?1)
          ORDER BY project ASC, memory_type ASC, path ASC, updated_at DESC
          LIMIT ?2
        `,
      )
      .bind(input.project ?? null, limit)
      .all<DocumentRow>();
    return result.results.map((row) => mapDocument(row)!);
  }

  async findDocumentsByLayer(input: {
    project: string;
    memoryLayer: MemoryLayer;
    canonical?: boolean;
    limit?: number;
  }): Promise<ResolvedMemoryDocument[]> {
    const limit = input.limit ?? 10;
    const canonicalClause = input.canonical !== undefined ? "AND d.canonical = ?" : "";
    const canonicalBind = input.canonical !== undefined ? [input.canonical ? 1 : 0] : [];
    const rows = await this.db
      .prepare(
        `SELECT d.*, s.raw_markdown, s.body_markdown, s.frontmatter_json
         FROM documents d
         LEFT JOIN document_snapshots s ON s.id = d.current_snapshot_id
         WHERE d.project = ?
           AND d.memory_layer = ?
           AND d.status != 'archived'
           AND d.active = 1
           ${canonicalClause}
         ORDER BY d.updated_at DESC
         LIMIT ?`,
      )
      .bind(input.project, input.memoryLayer, ...canonicalBind, limit)
      .all<DocumentRow & { raw_markdown?: string; body_markdown?: string; frontmatter_json?: string }>();
    return rows.results.map((row) => mapDocument(row)!).filter(Boolean);
  }

  async listProjectAliases() {
    const result = await this.db
      .prepare("SELECT alias, project_slug, created_at FROM project_aliases ORDER BY project_slug ASC, alias ASC")
      .all<{ alias: string; project_slug: string; created_at: string }>();
    return result.results.map((row) => ({
      alias: row.alias,
      projectSlug: row.project_slug,
      createdAt: row.created_at,
    }));
  }

  async markDocumentsNoncanonical(input: {
    documentIds: string[];
    canonicalGroup?: string | null;
    reason: string;
    status?: MemoryStatus;
    archivedToPath?: string | null;
    manifestId?: string | null;
    notes?: Record<string, unknown>;
  }) {
    const now = new Date().toISOString();
    for (const documentId of input.documentIds) {
      await this.db
        .prepare(
          `
            UPDATE documents
            SET status = COALESCE(?6, status),
                active = 0,
                canonical = 0,
                canonical_group = ?2,
                noncanonical_reason = ?3,
                migration_notes_json = ?4,
                updated_at = ?5,
                archived_to_path = ?7,
                canonicalization_manifest_id = ?8
            WHERE id = ?1
          `,
        )
        .bind(
          documentId,
          input.canonicalGroup ?? null,
          input.reason,
          JSON.stringify(input.notes ?? {}),
          now,
          input.status ?? null,
          input.archivedToPath ?? null,
          input.manifestId ?? null,
        )
        .run();
    }
  }

  async recordWorkdriveCanonicalizationManifest(input: {
    id?: string;
    migrationSlug: string;
    canonicalProject: string;
    duplicateProject: string;
    dryRun: boolean;
    applyRequested?: boolean;
    status: string;
    summary: string;
    manifest: Record<string, unknown>;
    counts: Record<string, unknown>;
  }) {
    const id = input.id ?? crypto.randomUUID();
    await this.db
      .prepare(
        `
          INSERT INTO workdrive_canonicalization_manifests (
            id, migration_slug, canonical_project, duplicate_project, dry_run, apply_requested,
            status, summary, manifest_json, counts_json, created_at
          ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
          ON CONFLICT(id) DO UPDATE SET
            dry_run = excluded.dry_run,
            apply_requested = excluded.apply_requested,
            status = excluded.status,
            summary = excluded.summary,
            manifest_json = excluded.manifest_json,
            counts_json = excluded.counts_json
        `,
      )
      .bind(
        id,
        input.migrationSlug,
        input.canonicalProject,
        input.duplicateProject,
        input.dryRun ? 1 : 0,
        input.applyRequested ? 1 : 0,
        input.status,
        input.summary,
        JSON.stringify(input.manifest),
        JSON.stringify(input.counts),
        new Date().toISOString(),
      )
      .run();
    return id;
  }

  async listWorkdriveCanonicalizationManifests(input: {
    migrationSlug?: string;
    canonicalProject?: string;
    duplicateProject?: string;
    limit?: number;
  } = {}) {
    const limit = Math.min(input.limit ?? 10, 50);
    const result = await this.db
      .prepare(
        `
          SELECT * FROM workdrive_canonicalization_manifests
          WHERE (?1 IS NULL OR migration_slug = ?1)
            AND (?2 IS NULL OR canonical_project = ?2)
            AND (?3 IS NULL OR duplicate_project = ?3)
          ORDER BY created_at DESC
          LIMIT ?4
        `,
      )
      .bind(input.migrationSlug ?? null, input.canonicalProject ?? null, input.duplicateProject ?? null, limit)
      .all<WorkdriveCanonicalizationManifestRow>();
    return result.results.map(mapWorkdriveCanonicalizationManifest);
  }

  async recordContextTruthMigrationManifest(input: {
    id?: string;
    migrationSlug: string;
    project: string;
    dryRun: boolean;
    applyRequested?: boolean;
    status: string;
    summary: string;
    manifest: Record<string, unknown>;
    counts: Record<string, unknown>;
  }) {
    const id = input.id ?? crypto.randomUUID();
    await this.db
      .prepare(
        `
          INSERT INTO context_truth_migration_manifests (
            id, migration_slug, project, dry_run, apply_requested, status, summary,
            manifest_json, counts_json, created_at
          ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
          ON CONFLICT(id) DO UPDATE SET
            dry_run = excluded.dry_run,
            apply_requested = excluded.apply_requested,
            status = excluded.status,
            summary = excluded.summary,
            manifest_json = excluded.manifest_json,
            counts_json = excluded.counts_json
        `,
      )
      .bind(
        id,
        input.migrationSlug,
        input.project,
        input.dryRun ? 1 : 0,
        input.applyRequested ? 1 : 0,
        input.status,
        input.summary,
        JSON.stringify(input.manifest),
        JSON.stringify(input.counts),
        new Date().toISOString(),
      )
      .run();
    return id;
  }

  async listContextTruthMigrationManifests(input: {
    migrationSlug?: string;
    project?: string;
    limit?: number;
  } = {}) {
    const limit = Math.min(input.limit ?? 10, 50);
    const result = await this.db
      .prepare(
        `
          SELECT * FROM context_truth_migration_manifests
          WHERE (?1 IS NULL OR migration_slug = ?1)
            AND (?2 IS NULL OR project = ?2)
          ORDER BY created_at DESC
          LIMIT ?3
        `,
      )
      .bind(input.migrationSlug ?? null, input.project ?? null, limit)
      .all<ContextTruthMigrationManifestRow>();
    return result.results.map(mapContextTruthMigrationManifest);
  }

  async recordMigrationAuditEvent(input: {
    migrationSlug: string;
    phase: string;
    dryRun: boolean;
    status: string;
    summary: string;
    counts?: Record<string, unknown>;
  }) {
    await this.db
      .prepare(
        `
          INSERT INTO migration_audit_events (
            id, migration_slug, phase, dry_run, status, summary, counts_json, created_at
          ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
        `,
      )
      .bind(
        crypto.randomUUID(),
        input.migrationSlug,
        input.phase,
        input.dryRun ? 1 : 0,
        input.status,
        input.summary,
        JSON.stringify(input.counts ?? {}),
        new Date().toISOString(),
      )
      .run();
  }

  async listMigrationAuditEvents(input: { migrationSlug?: string; limit?: number } = {}) {
    const limit = Math.min(input.limit ?? 50, 200);
    const result = await this.db
      .prepare(
        `
          SELECT * FROM migration_audit_events
          WHERE (?1 IS NULL OR migration_slug = ?1)
          ORDER BY created_at DESC
          LIMIT ?2
        `,
      )
      .bind(input.migrationSlug ?? null, limit)
      .all<MigrationAuditEventRow>();
    return result.results.map(mapMigrationAuditEvent);
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

  async getAllDocumentsForLayerBackfill(): Promise<
    Array<{ id: string; path: string; memory_type: string; canonical: boolean; memory_layer: string | null }>
  > {
    const rows = await this.db
      .prepare(
        "SELECT id, path, memory_type, canonical, memory_layer FROM documents ORDER BY created_at ASC",
      )
      .all<{ id: string; path: string; memory_type: string; canonical: number; memory_layer: string | null }>();
    return rows.results.map((row) => ({
      id: row.id,
      path: row.path,
      memory_type: row.memory_type,
      canonical: row.canonical === 1,
      memory_layer: row.memory_layer,
    }));
  }

  async setDocumentMemoryLayer(documentId: string, layer: string): Promise<void> {
    const now = new Date().toISOString();
    await this.db
      .prepare("UPDATE documents SET memory_layer = ?, updated_at = ? WHERE id = ?")
      .bind(layer, now, documentId)
      .run();
  }

  async getAdminStatus() {
    const [projects, failedJobs, queuedJobs, lastSync] = await Promise.all([
      this.db.prepare("SELECT COUNT(*) as count FROM projects").first<{ count: number }>(),
      this.db.prepare("SELECT COUNT(*) as count FROM reindex_jobs WHERE status = 'failed'").first<{ count: number }>(),
      this.db.prepare("SELECT COUNT(*) as count FROM reindex_jobs WHERE status = 'queued'").first<{ count: number }>(),
      this.db.prepare("SELECT * FROM sync_runs ORDER BY created_at DESC LIMIT 1").first<Record<string, unknown>>(),
    ]);
    return {
      project_count: projects?.count ?? 0,
      failed_reindex_jobs: failedJobs?.count ?? 0,
      queued_reindex_jobs: queuedJobs?.count ?? 0,
      last_sync: lastSync ?? null,
    };
  }
}

// Module-level helpers

function mapDocument(
  row?: (DocumentRow & { raw_markdown?: string; body_markdown?: string; frontmatter_json?: string }) | null,
): ResolvedMemoryDocument | null {
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
    memoryLayer: row.memory_layer as ResolvedMemoryDocument["memoryLayer"] ?? undefined,
    supersededByDocumentId: row.superseded_by_document_id,
    lastRemoteModifiedAt: row.last_remote_modified_at,
    rawMarkdown: row.raw_markdown,
    bodyMarkdown: row.body_markdown,
  };
}

function mapWorkdriveCanonicalizationManifest(
  row: WorkdriveCanonicalizationManifestRow,
): WorkdriveCanonicalizationManifest {
  return {
    id: row.id,
    migrationSlug: row.migration_slug,
    canonicalProject: row.canonical_project,
    duplicateProject: row.duplicate_project,
    dryRun: row.dry_run === 1,
    applyRequested: row.apply_requested === 1,
    status: row.status,
    summary: row.summary,
    manifest: parseJsonObject(row.manifest_json),
    counts: parseJsonObject(row.counts_json),
    createdAt: row.created_at,
  };
}

function mapContextTruthMigrationManifest(
  row: ContextTruthMigrationManifestRow,
): ContextTruthMigrationManifest {
  return {
    id: row.id,
    migrationSlug: row.migration_slug,
    project: row.project,
    dryRun: row.dry_run === 1,
    applyRequested: row.apply_requested === 1,
    status: row.status,
    summary: row.summary,
    manifest: parseJsonObject(row.manifest_json),
    counts: parseJsonObject(row.counts_json),
    createdAt: row.created_at,
  };
}

function mapMigrationAuditEvent(row: MigrationAuditEventRow): MigrationAuditEvent {
  return {
    id: row.id,
    migrationSlug: row.migration_slug,
    phase: row.phase,
    dryRun: row.dry_run === 1,
    status: row.status,
    summary: row.summary,
    counts: parseJsonObject(row.counts_json),
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

function parseJsonValue(value: string | null): unknown {
  if (value === null) {
    return null;
  }
  try {
    return JSON.parse(value);
  } catch {
    return value;
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
