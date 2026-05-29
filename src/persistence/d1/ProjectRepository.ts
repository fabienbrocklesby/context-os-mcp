import type {
  ClientEnvironment,
  EnvironmentCapability,
  MemoryProject,
  ProjectGithubRepo,
  ToolCapability,
} from "~/domain/memory";
import type {
  ProjectRow,
  ClientEnvironmentRow,
  ToolCapabilityRow,
  EnvironmentCapabilityRow,
  ProjectGithubRepoRow,
  FolderCheckRow,
  CountRow,
} from "~/persistence/d1/types";

export class ProjectRepository {
  constructor(private readonly db: D1Database) {}

  private async getProjectRowBySlug(slug: string) {
    return this.db
      .prepare("SELECT * FROM projects WHERE slug = ?1")
      .bind(slug)
      .first<ProjectRow>();
  }

  async getProject(slugOrAlias: string) {
    const direct = await this.db
      .prepare("SELECT * FROM projects WHERE slug = ?1")
      .bind(slugOrAlias)
      .first<ProjectRow>();
    if (direct) {
      if (direct.merged_into_project && direct.merged_into_project !== direct.slug) {
        const canonical = await this.db
          .prepare("SELECT * FROM projects WHERE slug = ?1")
          .bind(direct.merged_into_project)
          .first<ProjectRow>();
        if (canonical) {
          return mapProject(canonical);
        }
      }
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

  async listProjects(input: { includeMerged?: boolean; includeArchived?: boolean } = {}) {
    const conditions: string[] = [];
    if (!input.includeMerged) {
      conditions.push("(canonical_status IS NULL OR canonical_status != 'merged')");
    }
    if (!input.includeArchived) {
      conditions.push("status != 'archived'");
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const result = await this.db
      .prepare(`SELECT * FROM projects ${where} ORDER BY shared DESC, slug ASC`)
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
    const existing = mapProject(await this.getProjectRowBySlug(input.slug));
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
    canonicalProject?: string | null;
    mergedIntoProject?: string | null;
    noncanonicalReason?: string | null;
    canonicalStatus?: string | null;
  }) {
    const existing = mapProject(await this.getProjectRowBySlug(input.slug));
    if (!existing) {
      throw new Error(`Project ${input.slug} does not exist.`);
    }
    const now = new Date().toISOString();
    await this.db
      .prepare(
        `
          UPDATE projects
          SET display_name = ?2,
              description = ?3,
              status = ?4,
              profile_json = ?5,
              updated_at = ?6,
              canonical_project = ?7,
              merged_into_project = ?8,
              noncanonical_reason = ?9,
              canonical_status = ?10,
              canonical_updated_at = ?6
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
        input.canonicalProject !== undefined ? input.canonicalProject : existing.canonicalProject ?? existing.slug,
        input.mergedIntoProject !== undefined ? input.mergedIntoProject : existing.mergedIntoProject ?? null,
        input.noncanonicalReason !== undefined ? input.noncanonicalReason : existing.noncanonicalReason ?? null,
        input.canonicalStatus ?? existing.canonicalStatus ?? "canonical",
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

  async listClientEnvironments() {
    const result = await this.db
      .prepare("SELECT * FROM client_environments ORDER BY slug ASC")
      .all<ClientEnvironmentRow>();
    return result.results.map(mapClientEnvironment);
  }

  async upsertClientEnvironment(input: {
    slug: string;
    displayName: string;
    description?: string | null;
    defaultToolStyle?: string | null;
    notes?: string | null;
  }) {
    const now = new Date().toISOString();
    await this.db
      .prepare(
        `
          INSERT INTO client_environments (
            id, slug, display_name, description, default_tool_style, notes, created_at, updated_at
          ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
          ON CONFLICT(slug) DO UPDATE SET
            display_name = excluded.display_name,
            description = excluded.description,
            default_tool_style = excluded.default_tool_style,
            notes = excluded.notes,
            updated_at = excluded.updated_at
        `,
      )
      .bind(crypto.randomUUID(), input.slug, input.displayName, input.description ?? null, input.defaultToolStyle ?? null, input.notes ?? null, now)
      .run();
    return (await this.listClientEnvironments()).find((environment) => environment.slug === input.slug) ?? null;
  }

  async listToolCapabilities() {
    const result = await this.db
      .prepare("SELECT * FROM tool_capabilities ORDER BY source_kind ASC, slug ASC")
      .all<ToolCapabilityRow>();
    return result.results.map(mapToolCapability);
  }

  async upsertToolCapability(input: {
    slug: string;
    displayName: string;
    sourceKind: string;
    actionKind: string;
    sourceOfTruth?: boolean;
    volatile?: boolean;
    sensitivity?: ToolCapability["sensitivity"];
    requiresConfirmation?: boolean;
    destructive?: boolean;
    savePolicy?: ToolCapability["savePolicy"];
    instructionsMarkdown?: string | null;
    inputHints?: Record<string, unknown>;
    outputHints?: Record<string, unknown>;
  }) {
    const now = new Date().toISOString();
    await this.db
      .prepare(
        `
          INSERT INTO tool_capabilities (
            id, slug, display_name, source_kind, action_kind, source_of_truth, volatile,
            sensitivity, requires_confirmation, destructive, save_policy,
            instructions_markdown, input_hints_json, output_hints_json, created_at, updated_at
          ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?15)
          ON CONFLICT(slug) DO UPDATE SET
            display_name = excluded.display_name,
            source_kind = excluded.source_kind,
            action_kind = excluded.action_kind,
            source_of_truth = excluded.source_of_truth,
            volatile = excluded.volatile,
            sensitivity = excluded.sensitivity,
            requires_confirmation = excluded.requires_confirmation,
            destructive = excluded.destructive,
            save_policy = excluded.save_policy,
            instructions_markdown = excluded.instructions_markdown,
            input_hints_json = excluded.input_hints_json,
            output_hints_json = excluded.output_hints_json,
            updated_at = excluded.updated_at
        `,
      )
      .bind(
        crypto.randomUUID(),
        input.slug,
        input.displayName,
        input.sourceKind,
        input.actionKind,
        input.sourceOfTruth ? 1 : 0,
        input.volatile ? 1 : 0,
        input.sensitivity ?? "internal",
        input.requiresConfirmation ? 1 : 0,
        input.destructive ? 1 : 0,
        input.savePolicy ?? "durable_summary",
        input.instructionsMarkdown ?? null,
        JSON.stringify(input.inputHints ?? {}),
        JSON.stringify(input.outputHints ?? {}),
        now,
      )
      .run();
    return (await this.listToolCapabilities()).find((capability) => capability.slug === input.slug) ?? null;
  }

  async listEnvironmentCapabilities(environmentSlug?: string) {
    const result = await this.db
      .prepare(
        `
          SELECT * FROM environment_capabilities
          WHERE (?1 IS NULL OR environment_slug = ?1)
          ORDER BY environment_slug ASC, priority ASC, capability_slug ASC
        `,
      )
      .bind(environmentSlug ?? null)
      .all<EnvironmentCapabilityRow>();
    return result.results.map(mapEnvironmentCapability);
  }

  async upsertEnvironmentCapability(input: {
    environmentSlug: string;
    capabilitySlug: string;
    availability?: EnvironmentCapability["availability"];
    invocationStyle?: EnvironmentCapability["invocationStyle"];
    toolName?: string | null;
    usageInstructionsMarkdown?: string | null;
    limitationsMarkdown?: string | null;
    priority?: number;
  }) {
    const now = new Date().toISOString();
    await this.db
      .prepare(
        `
          INSERT INTO environment_capabilities (
            id, environment_slug, capability_slug, availability, invocation_style, tool_name,
            usage_instructions_markdown, limitations_markdown, priority, created_at, updated_at
          ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)
          ON CONFLICT(environment_slug, capability_slug) DO UPDATE SET
            availability = excluded.availability,
            invocation_style = excluded.invocation_style,
            tool_name = excluded.tool_name,
            usage_instructions_markdown = excluded.usage_instructions_markdown,
            limitations_markdown = excluded.limitations_markdown,
            priority = excluded.priority,
            updated_at = excluded.updated_at
        `,
      )
      .bind(
        crypto.randomUUID(),
        input.environmentSlug,
        input.capabilitySlug,
        input.availability ?? "unknown",
        input.invocationStyle ?? "manual_instruction",
        input.toolName ?? null,
        input.usageInstructionsMarkdown ?? null,
        input.limitationsMarkdown ?? null,
        input.priority ?? 100,
        now,
      )
      .run();
    return (await this.listEnvironmentCapabilities(input.environmentSlug)).find(
      (capability) => capability.capabilitySlug === input.capabilitySlug,
    ) ?? null;
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

  async upsertProjectRelation(input: {
    sourceProjectSlug: string;
    targetProjectSlug: string;
    relation: string;
    reason?: string | null;
    status?: string;
  }) {
    const now = new Date().toISOString();
    await this.db
      .prepare(
        `
          INSERT INTO project_relations (
            id, source_project_slug, target_project_slug, relation, reason, status, created_at, updated_at
          ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
          ON CONFLICT(source_project_slug, target_project_slug, relation) DO UPDATE SET
            reason = excluded.reason,
            status = excluded.status,
            updated_at = excluded.updated_at
        `,
      )
      .bind(
        crypto.randomUUID(),
        input.sourceProjectSlug,
        input.targetProjectSlug,
        input.relation,
        input.reason ?? null,
        input.status ?? "active",
        now,
        now,
      )
      .run();
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
    canonicalProject: row.canonical_project,
    mergedIntoProject: row.merged_into_project,
    noncanonicalReason: row.noncanonical_reason,
    canonicalStatus: row.canonical_status,
    canonicalUpdatedAt: row.canonical_updated_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapClientEnvironment(row: ClientEnvironmentRow): ClientEnvironment {
  return {
    id: row.id,
    slug: row.slug,
    displayName: row.display_name,
    description: row.description,
    defaultToolStyle: row.default_tool_style,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapToolCapability(row: ToolCapabilityRow): ToolCapability {
  return {
    id: row.id,
    slug: row.slug,
    displayName: row.display_name,
    sourceKind: row.source_kind,
    actionKind: row.action_kind,
    sourceOfTruth: row.source_of_truth === 1,
    volatile: row.volatile === 1,
    sensitivity: row.sensitivity,
    requiresConfirmation: row.requires_confirmation === 1,
    destructive: row.destructive === 1,
    savePolicy: row.save_policy,
    instructionsMarkdown: row.instructions_markdown,
    inputHints: parseJsonObject(row.input_hints_json),
    outputHints: parseJsonObject(row.output_hints_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapEnvironmentCapability(row: EnvironmentCapabilityRow): EnvironmentCapability {
  return {
    id: row.id,
    environmentSlug: row.environment_slug,
    capabilitySlug: row.capability_slug,
    availability: row.availability,
    invocationStyle: row.invocation_style,
    toolName: row.tool_name,
    usageInstructionsMarkdown: row.usage_instructions_markdown,
    limitationsMarkdown: row.limitations_markdown,
    priority: row.priority,
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
