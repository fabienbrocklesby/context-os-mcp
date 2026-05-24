import type {
  AlignmentAssessment,
  BranchProject,
  ChunkRecord,
  ClientEnvironment,
  ContextTruthMigrationManifest,
  ContextTask,
  DurableFact,
  EnvironmentCapability,
  EntityAlias,
  EntityState,
  InitiativeProject,
  MigrationAuditEvent,
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
  StrategyAsset,
  StrategyMilestone,
  StrategyNode,
  ToolCapability,
  WorkdriveCanonicalizationManifest,
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
  canonical_project?: string | null;
  merged_into_project?: string | null;
  noncanonical_reason?: string | null;
  canonical_status?: string | null;
  canonical_updated_at?: string | null;
  created_at: string;
  updated_at: string;
};

type ClientEnvironmentRow = {
  id: string;
  slug: string;
  display_name: string;
  description: string | null;
  default_tool_style: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

type ToolCapabilityRow = {
  id: string;
  slug: string;
  display_name: string;
  source_kind: string;
  action_kind: string;
  source_of_truth: number;
  volatile: number;
  sensitivity: ToolCapability["sensitivity"];
  requires_confirmation: number;
  destructive: number;
  save_policy: ToolCapability["savePolicy"];
  instructions_markdown: string | null;
  input_hints_json: string | null;
  output_hints_json: string | null;
  created_at: string;
  updated_at: string;
};

type EnvironmentCapabilityRow = {
  id: string;
  environment_slug: string;
  capability_slug: string;
  availability: EnvironmentCapability["availability"];
  invocation_style: EnvironmentCapability["invocationStyle"];
  tool_name: string | null;
  usage_instructions_markdown: string | null;
  limitations_markdown: string | null;
  priority: number;
  created_at: string;
  updated_at: string;
};

type MigrationAuditEventRow = {
  id: string;
  migration_slug: string;
  phase: string;
  dry_run: number;
  status: string;
  summary: string;
  counts_json: string | null;
  created_at: string;
};

type WorkdriveCanonicalizationManifestRow = {
  id: string;
  migration_slug: string;
  canonical_project: string;
  duplicate_project: string;
  dry_run: number;
  apply_requested: number;
  status: string;
  summary: string;
  manifest_json: string;
  counts_json: string | null;
  created_at: string;
};

type ContextTruthMigrationManifestRow = {
  id: string;
  migration_slug: string;
  project: string;
  dry_run: number;
  apply_requested: number;
  status: string;
  summary: string;
  manifest_json: string;
  counts_json: string | null;
  created_at: string;
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

type EntityAliasRow = {
  id: string;
  project: string;
  entity_id: string;
  alias: string;
  normalized_alias: string;
  source: string | null;
  confidence: number | null;
  created_at: string;
  updated_at: string;
};

type EntityStateRow = {
  id: string;
  project: string;
  entity_id: string;
  state_key: string;
  value_json: string;
  status: EntityState["status"];
  confidence: number | null;
  source: string | null;
  source_id: string | null;
  source_event_id: string | null;
  valid_from: string | null;
  valid_until: string | null;
  superseded_by_state_id: string | null;
  observed_at: string | null;
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

type StrategyNodeRow = {
  id: string;
  project: string;
  slug: string;
  type: StrategyNode["type"];
  title: string;
  summary: string | null;
  status: StrategyNode["status"];
  parent_id: string | null;
  horizon: string | null;
  priority: StrategyNode["priority"];
  metric_name: string | null;
  target_value: string | null;
  current_value: string | null;
  metric_unit: string | null;
  metric_direction: StrategyNode["metricDirection"];
  starts_at: string | null;
  due_at: string | null;
  review_cadence: string | null;
  tags_json: string | null;
  metadata_json: string | null;
  created_at: string;
  updated_at: string;
};

type AssetRow = {
  id: string;
  project: string;
  slug: string;
  name: string;
  type: StrategyAsset["type"];
  summary: string | null;
  status: StrategyAsset["status"];
  owner: string | null;
  source: string | null;
  source_id: string | null;
  source_url: string | null;
  live_source_kind: StrategyAsset["liveSourceKind"];
  sensitivity: StrategyAsset["sensitivity"];
  how_to_use: string | null;
  limitations: string | null;
  tags_json: string | null;
  metadata_json: string | null;
  created_at: string;
  updated_at: string;
};

type MilestoneRow = {
  id: string;
  project: string;
  slug: string;
  title: string;
  summary: string | null;
  status: StrategyMilestone["status"];
  initiative_id: string | null;
  project_slug: string | null;
  outcome_id: string | null;
  owner: string | null;
  due_at: string | null;
  completed_at: string | null;
  success_metric: string | null;
  evidence: string | null;
  tags_json: string | null;
  metadata_json: string | null;
  created_at: string;
  updated_at: string;
};

type BranchProjectRow = {
  id: string;
  project_slug: string;
  parent_initiative_id: string;
  parent_project_slug: string | null;
  branch_reason: string;
  hypothesis: string;
  timebox_starts_at: string;
  timebox_ends_at: string;
  success_metric: string;
  risk_to_parent: string;
  risk_level: BranchProject["riskLevel"];
  merge_back_condition: string;
  kill_condition: string;
  status: BranchProject["status"];
  decision_log: string | null;
  metadata_json: string | null;
  created_at: string;
  updated_at: string;
};

type AlignmentAssessmentRow = {
  id: string;
  project: string;
  subject_type: string;
  subject_id: string | null;
  user_intent: string;
  alignment_label: AlignmentAssessment["alignmentLabel"];
  score: AlignmentAssessment["score"];
  confidence: AlignmentAssessment["confidence"];
  rationale: string;
  evidence_json: string | null;
  risks_json: string | null;
  scope_guidance: string | null;
  missing_context_json: string | null;
  strategy_snapshot_json: string | null;
  created_at: string;
};

export class MemoryRepository {
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

  async upsertEntityAliases(input: {
    project: string;
    entityId: string;
    aliases: string[];
    source?: string | null;
    confidence?: number | null;
  }) {
    const now = new Date().toISOString();
    const normalizedAliases = [
      ...new Map(
        input.aliases
          .map((alias) => alias.trim())
          .filter(Boolean)
          .map((alias) => [normalizeEntityAlias(alias), alias] as const),
      ).entries(),
    ];
    if (normalizedAliases.length === 0) {
      return [];
    }
    await this.db.batch(
      normalizedAliases.map(([normalizedAlias, alias]) =>
        this.db
          .prepare(
            `
              INSERT INTO entity_aliases (
                id, project, entity_id, alias, normalized_alias, source, confidence, created_at, updated_at
              ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)
              ON CONFLICT(project, normalized_alias, entity_id) DO UPDATE SET
                alias = excluded.alias,
                source = COALESCE(excluded.source, entity_aliases.source),
                confidence = COALESCE(excluded.confidence, entity_aliases.confidence),
                updated_at = excluded.updated_at
            `,
          )
          .bind(
            crypto.randomUUID(),
            input.project,
            input.entityId,
            alias,
            normalizedAlias,
            input.source ?? null,
            input.confidence ?? null,
            now,
          ),
      ),
    );
    return this.listEntityAliases({ project: input.project, entityId: input.entityId });
  }

  async listEntityAliases(input: { project?: string; entityId?: string; limit?: number } = {}) {
    const limit = Math.min(input.limit ?? 100, 500);
    const result = await this.db
      .prepare(
        `
          SELECT * FROM entity_aliases
          WHERE (?1 IS NULL OR project = ?1 OR project = 'shared')
            AND (?2 IS NULL OR entity_id = ?2)
          ORDER BY confidence DESC, updated_at DESC, alias ASC
          LIMIT ?3
        `,
      )
      .bind(input.project ?? null, input.entityId ?? null, limit)
      .all<EntityAliasRow>();
    return this.attachEntitiesToAliases(result.results.map(mapEntityAlias));
  }

  async searchEntityAliases(input: { project?: string; query?: string; limit?: number }) {
    const limit = Math.min(input.limit ?? 20, 100);
    const normalizedQuery = normalizeEntityAlias(input.query ?? "");
    const result = await this.db
      .prepare(
        `
          SELECT * FROM entity_aliases
          WHERE (?1 IS NULL OR project = ?1 OR project = 'shared')
            AND (
              ?2 = ''
              OR instr(?2, normalized_alias) > 0
              OR instr(normalized_alias, ?2) > 0
            )
          ORDER BY
            CASE WHEN normalized_alias = ?2 THEN 0 ELSE 1 END,
            length(normalized_alias) DESC,
            confidence DESC,
            updated_at DESC
          LIMIT ?3
        `,
      )
      .bind(input.project ?? null, normalizedQuery, limit)
      .all<EntityAliasRow>();
    return this.attachEntitiesToAliases(result.results.map(mapEntityAlias));
  }

  async upsertEntityState(input: {
    id?: string;
    project: string;
    entityId: string;
    stateKey: string;
    value: unknown;
    confidence?: number | null;
    source?: string | null;
    sourceId?: string | null;
    sourceEventId?: string | null;
    validFrom?: string | null;
    validUntil?: string | null;
    observedAt?: string | null;
    status?: EntityState["status"];
    supersedeActive?: boolean;
  }) {
    const now = new Date().toISOString();
    const id = input.id ?? crypto.randomUUID();
    const status = input.status ?? "active";
    const observedAt = input.observedAt ?? now;
    const statements = [];
    if (status === "active" && input.supersedeActive !== false) {
      statements.push(
        this.db
          .prepare(
            `
              UPDATE entity_states
              SET status = 'superseded',
                  valid_until = COALESCE(valid_until, ?4),
                  superseded_by_state_id = ?5,
                  updated_at = ?4
              WHERE project = ?1
                AND entity_id = ?2
                AND state_key = ?3
                AND status = 'active'
            `,
          )
          .bind(input.project, input.entityId, input.stateKey, now, id),
      );
    }
    statements.push(
      this.db
        .prepare(
          `
            INSERT INTO entity_states (
              id, project, entity_id, state_key, value_json, status, confidence, source,
              source_id, source_event_id, valid_from, valid_until, superseded_by_state_id,
              observed_at, created_at, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)
            ON CONFLICT(id) DO UPDATE SET
              value_json = excluded.value_json,
              status = excluded.status,
              confidence = excluded.confidence,
              source = excluded.source,
              source_id = excluded.source_id,
              source_event_id = excluded.source_event_id,
              valid_from = excluded.valid_from,
              valid_until = excluded.valid_until,
              superseded_by_state_id = excluded.superseded_by_state_id,
              observed_at = excluded.observed_at,
              updated_at = excluded.updated_at
          `,
        )
        .bind(
          id,
          input.project,
          input.entityId,
          input.stateKey,
          JSON.stringify(input.value),
          status,
          input.confidence ?? null,
          input.source ?? null,
          input.sourceId ?? null,
          input.sourceEventId ?? null,
          input.validFrom ?? observedAt,
          input.validUntil ?? null,
          null,
          observedAt,
          now,
          now,
        ),
    );
    await this.db.batch(statements);
    return this.getEntityState(id);
  }

  async getEntityState(id: string) {
    return mapEntityState(
      await this.db
        .prepare("SELECT * FROM entity_states WHERE id = ?1")
        .bind(id)
        .first<EntityStateRow>(),
    );
  }

  async listEntityStatesForEntities(input: {
    project?: string;
    entityIds: string[];
    includeSuperseded?: boolean;
    stateKeys?: string[];
    limit?: number;
  }) {
    const entityIds = [...new Set(input.entityIds.filter(Boolean))];
    if (entityIds.length === 0) {
      return [];
    }
    const limit = Math.min(input.limit ?? 200, 500);
    const binds: Array<string | number> = [];
    const entityPlaceholders = entityIds.map((entityId) => {
      binds.push(entityId);
      return `?${binds.length}`;
    });
    const conditions = [`entity_id IN (${entityPlaceholders.join(", ")})`];
    if (input.project) {
      binds.push(input.project);
      conditions.push(`(project = ?${binds.length} OR project = 'shared')`);
    }
    if (!input.includeSuperseded) {
      conditions.push("status = 'active'");
    }
    if (input.stateKeys?.length) {
      const keyPlaceholders = input.stateKeys.map((key) => {
        binds.push(key);
        return `?${binds.length}`;
      });
      conditions.push(`state_key IN (${keyPlaceholders.join(", ")})`);
    }
    binds.push(limit);
    const result = await this.db
      .prepare(
        `
          SELECT * FROM entity_states
          WHERE ${conditions.join(" AND ")}
          ORDER BY
            CASE status WHEN 'active' THEN 0 WHEN 'superseded' THEN 1 ELSE 2 END,
            COALESCE(observed_at, updated_at) DESC
          LIMIT ?${binds.length}
        `,
      )
      .bind(...binds)
      .all<EntityStateRow>();
    return result.results.map((row) => mapEntityState(row)!);
  }

  private async attachEntitiesToAliases(aliases: EntityAlias[]) {
    const entityIds = [...new Set(aliases.map((alias) => alias.entityId))];
    const entities = new Map<string, MemoryEntity>();
    for (const entityId of entityIds) {
      const entity = await this.getEntity(entityId);
      if (entity) {
        entities.set(entityId, entity);
      }
    }
    return aliases.map((alias) => ({
      ...alias,
      entity: entities.get(alias.entityId) ?? null,
    }));
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

  async upsertStrategyNode(input: {
    id?: string;
    project: string;
    slug: string;
    type: StrategyNode["type"];
    title: string;
    summary?: string | null;
    status?: StrategyNode["status"];
    parentId?: string | null;
    horizon?: string | null;
    priority?: StrategyNode["priority"];
    metricName?: string | null;
    targetValue?: string | null;
    currentValue?: string | null;
    metricUnit?: string | null;
    metricDirection?: StrategyNode["metricDirection"];
    startsAt?: string | null;
    dueAt?: string | null;
    reviewCadence?: string | null;
    tags?: string[];
    metadata?: Record<string, unknown>;
  }) {
    const now = new Date().toISOString();
    const existing = await this.getStrategyNodeBySlug(input.project, input.slug);
    const id = input.id ?? existing?.id ?? crypto.randomUUID();
    await this.db
      .prepare(
        `
          INSERT INTO strategy_nodes (
            id, project, slug, type, title, summary, status, parent_id, horizon, priority,
            metric_name, target_value, current_value, metric_unit, metric_direction,
            starts_at, due_at, review_cadence, tags_json, metadata_json, created_at, updated_at
          ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22)
          ON CONFLICT(project, slug) DO UPDATE SET
            type = excluded.type,
            title = excluded.title,
            summary = excluded.summary,
            status = excluded.status,
            parent_id = excluded.parent_id,
            horizon = excluded.horizon,
            priority = excluded.priority,
            metric_name = excluded.metric_name,
            target_value = excluded.target_value,
            current_value = excluded.current_value,
            metric_unit = excluded.metric_unit,
            metric_direction = excluded.metric_direction,
            starts_at = excluded.starts_at,
            due_at = excluded.due_at,
            review_cadence = excluded.review_cadence,
            tags_json = excluded.tags_json,
            metadata_json = excluded.metadata_json,
            updated_at = excluded.updated_at
        `,
      )
      .bind(
        id,
        input.project,
        input.slug,
        input.type,
        input.title,
        input.summary ?? existing?.summary ?? null,
        input.status ?? existing?.status ?? "active",
        input.parentId ?? existing?.parentId ?? null,
        input.horizon ?? existing?.horizon ?? null,
        input.priority ?? existing?.priority ?? "normal",
        input.metricName ?? existing?.metricName ?? null,
        input.targetValue ?? existing?.targetValue ?? null,
        input.currentValue ?? existing?.currentValue ?? null,
        input.metricUnit ?? existing?.metricUnit ?? null,
        input.metricDirection ?? existing?.metricDirection ?? null,
        input.startsAt ?? existing?.startsAt ?? null,
        input.dueAt ?? existing?.dueAt ?? null,
        input.reviewCadence ?? existing?.reviewCadence ?? null,
        JSON.stringify(input.tags ?? existing?.tags ?? []),
        JSON.stringify(input.metadata ?? existing?.metadata ?? {}),
        existing?.createdAt ?? now,
        now,
      )
      .run();
    return this.getStrategyNodeBySlug(input.project, input.slug);
  }

  async getStrategyNodeBySlug(project: string, slug: string) {
    return mapStrategyNode(
      await this.db
        .prepare("SELECT * FROM strategy_nodes WHERE project = ?1 AND slug = ?2")
        .bind(project, slug)
        .first<StrategyNodeRow>(),
    );
  }

  async getStrategyNodeById(id: string) {
    return mapStrategyNode(
      await this.db
        .prepare("SELECT * FROM strategy_nodes WHERE id = ?1")
        .bind(id)
        .first<StrategyNodeRow>(),
    );
  }

  async listStrategyNodes(input: {
    project?: string;
    type?: StrategyNode["type"];
    status?: StrategyNode["status"];
    parentId?: string;
    query?: string;
    limit?: number;
  } = {}) {
    const limit = Math.min(input.limit ?? 50, 100);
    const query = input.query?.toLowerCase();
    const result = await this.db
      .prepare(
        `
          SELECT * FROM strategy_nodes
          WHERE (?1 IS NULL OR project = ?1 OR project = 'shared')
            AND (?2 IS NULL OR type = ?2)
            AND (?3 IS NULL OR status = ?3)
            AND (?4 IS NULL OR parent_id = ?4)
            AND (?5 IS NULL OR instr(lower(title), ?5) > 0 OR instr(lower(slug), ?5) > 0 OR instr(lower(COALESCE(summary, '')), ?5) > 0)
          ORDER BY
            CASE type WHEN 'vision' THEN 0 WHEN 'north_star' THEN 1 WHEN 'strategic_pillar' THEN 2 ELSE 3 END,
            status = 'active' DESC,
            updated_at DESC
          LIMIT ?6
        `,
      )
      .bind(input.project ?? null, input.type ?? null, input.status ?? null, input.parentId ?? null, query ?? null, limit)
      .all<StrategyNodeRow>();
    return result.results.map((row) => mapStrategyNode(row)!);
  }

  async upsertAsset(input: {
    id?: string;
    project: string;
    slug: string;
    name: string;
    type: StrategyAsset["type"];
    summary?: string | null;
    status?: StrategyAsset["status"];
    owner?: string | null;
    source?: string | null;
    sourceId?: string | null;
    sourceUrl?: string | null;
    liveSourceKind?: StrategyAsset["liveSourceKind"];
    sensitivity?: StrategyAsset["sensitivity"];
    howToUse?: string | null;
    limitations?: string | null;
    tags?: string[];
    metadata?: Record<string, unknown>;
  }) {
    const now = new Date().toISOString();
    const existing = await this.getAssetBySlug(input.project, input.slug);
    const id = input.id ?? existing?.id ?? crypto.randomUUID();
    await this.db
      .prepare(
        `
          INSERT INTO assets (
            id, project, slug, name, type, summary, status, owner, source, source_id,
            source_url, live_source_kind, sensitivity, how_to_use, limitations,
            tags_json, metadata_json, created_at, updated_at
          ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)
          ON CONFLICT(project, slug) DO UPDATE SET
            name = excluded.name,
            type = excluded.type,
            summary = excluded.summary,
            status = excluded.status,
            owner = excluded.owner,
            source = excluded.source,
            source_id = excluded.source_id,
            source_url = excluded.source_url,
            live_source_kind = excluded.live_source_kind,
            sensitivity = excluded.sensitivity,
            how_to_use = excluded.how_to_use,
            limitations = excluded.limitations,
            tags_json = excluded.tags_json,
            metadata_json = excluded.metadata_json,
            updated_at = excluded.updated_at
        `,
      )
      .bind(
        id,
        input.project,
        input.slug,
        input.name,
        input.type,
        input.summary ?? existing?.summary ?? null,
        input.status ?? existing?.status ?? "active",
        input.owner ?? existing?.owner ?? null,
        input.source ?? existing?.source ?? null,
        input.sourceId ?? existing?.sourceId ?? null,
        input.sourceUrl ?? existing?.sourceUrl ?? null,
        input.liveSourceKind ?? existing?.liveSourceKind ?? null,
        input.sensitivity ?? existing?.sensitivity ?? "internal",
        input.howToUse ?? existing?.howToUse ?? null,
        input.limitations ?? existing?.limitations ?? null,
        JSON.stringify(input.tags ?? existing?.tags ?? []),
        JSON.stringify(input.metadata ?? existing?.metadata ?? {}),
        existing?.createdAt ?? now,
        now,
      )
      .run();
    return this.getAssetBySlug(input.project, input.slug);
  }

  async getAssetBySlug(project: string, slug: string) {
    return mapAsset(
      await this.db
        .prepare("SELECT * FROM assets WHERE project = ?1 AND slug = ?2")
        .bind(project, slug)
        .first<AssetRow>(),
    );
  }

  async getAssetById(id: string) {
    return mapAsset(
      await this.db
        .prepare("SELECT * FROM assets WHERE id = ?1")
        .bind(id)
        .first<AssetRow>(),
    );
  }

  async listAssets(input: {
    project?: string;
    query?: string;
    type?: string;
    status?: string;
    includeArchived?: boolean;
    limit?: number;
  } = {}) {
    const limit = Math.min(input.limit ?? 30, 100);
    const query = input.query?.toLowerCase();
    const result = await this.db
      .prepare(
        `
          SELECT * FROM assets
          WHERE (?1 IS NULL OR project = ?1 OR project = 'shared')
            AND (?2 IS NULL OR type = ?2)
            AND (?3 IS NULL OR status = ?3)
            AND (?4 = 1 OR status != 'archived')
            AND (?5 IS NULL OR instr(lower(name), ?5) > 0 OR instr(lower(slug), ?5) > 0 OR instr(lower(COALESCE(summary, '')), ?5) > 0 OR instr(lower(COALESCE(how_to_use, '')), ?5) > 0)
          ORDER BY status = 'active' DESC, updated_at DESC
          LIMIT ?6
        `,
      )
      .bind(input.project ?? null, input.type ?? null, input.status ?? null, input.includeArchived ? 1 : 0, query ?? null, limit)
      .all<AssetRow>();
    return result.results.map((row) => mapAsset(row)!);
  }

  async upsertMilestone(input: {
    id?: string;
    project: string;
    slug: string;
    title: string;
    summary?: string | null;
    status?: StrategyMilestone["status"];
    initiativeId?: string | null;
    projectSlug?: string | null;
    outcomeId?: string | null;
    owner?: string | null;
    dueAt?: string | null;
    completedAt?: string | null;
    successMetric?: string | null;
    evidence?: string | null;
    tags?: string[];
    metadata?: Record<string, unknown>;
  }) {
    const now = new Date().toISOString();
    const existing = await this.getMilestoneBySlug(input.project, input.slug);
    const id = input.id ?? existing?.id ?? crypto.randomUUID();
    await this.db
      .prepare(
        `
          INSERT INTO milestones (
            id, project, slug, title, summary, status, initiative_id, project_slug, outcome_id,
            owner, due_at, completed_at, success_metric, evidence, tags_json, metadata_json,
            created_at, updated_at
          ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)
          ON CONFLICT(project, slug) DO UPDATE SET
            title = excluded.title,
            summary = excluded.summary,
            status = excluded.status,
            initiative_id = excluded.initiative_id,
            project_slug = excluded.project_slug,
            outcome_id = excluded.outcome_id,
            owner = excluded.owner,
            due_at = excluded.due_at,
            completed_at = excluded.completed_at,
            success_metric = excluded.success_metric,
            evidence = excluded.evidence,
            tags_json = excluded.tags_json,
            metadata_json = excluded.metadata_json,
            updated_at = excluded.updated_at
        `,
      )
      .bind(
        id,
        input.project,
        input.slug,
        input.title,
        input.summary ?? existing?.summary ?? null,
        input.status ?? existing?.status ?? "planned",
        input.initiativeId ?? existing?.initiativeId ?? null,
        input.projectSlug ?? existing?.projectSlug ?? null,
        input.outcomeId ?? existing?.outcomeId ?? null,
        input.owner ?? existing?.owner ?? null,
        input.dueAt ?? existing?.dueAt ?? null,
        input.completedAt ?? existing?.completedAt ?? null,
        input.successMetric ?? existing?.successMetric ?? null,
        input.evidence ?? existing?.evidence ?? null,
        JSON.stringify(input.tags ?? existing?.tags ?? []),
        JSON.stringify(input.metadata ?? existing?.metadata ?? {}),
        existing?.createdAt ?? now,
        now,
      )
      .run();
    return this.getMilestoneBySlug(input.project, input.slug);
  }

  async getMilestoneBySlug(project: string, slug: string) {
    return mapMilestone(
      await this.db
        .prepare("SELECT * FROM milestones WHERE project = ?1 AND slug = ?2")
        .bind(project, slug)
        .first<MilestoneRow>(),
    );
  }

  async getMilestoneById(id: string) {
    return mapMilestone(
      await this.db
        .prepare("SELECT * FROM milestones WHERE id = ?1")
        .bind(id)
        .first<MilestoneRow>(),
    );
  }

  async listMilestones(input: {
    project?: string;
    status?: string;
    initiativeId?: string;
    projectSlug?: string;
    outcomeId?: string;
    dueBefore?: string;
    limit?: number;
  } = {}) {
    const limit = Math.min(input.limit ?? 30, 100);
    const result = await this.db
      .prepare(
        `
          SELECT * FROM milestones
          WHERE (?1 IS NULL OR project = ?1 OR project = 'shared')
            AND (?2 IS NULL OR status = ?2)
            AND (?3 IS NULL OR initiative_id = ?3)
            AND (?4 IS NULL OR project_slug = ?4)
            AND (?5 IS NULL OR outcome_id = ?5)
            AND (?6 IS NULL OR due_at <= ?6)
          ORDER BY
            CASE status WHEN 'active' THEN 0 WHEN 'planned' THEN 1 WHEN 'blocked' THEN 2 ELSE 3 END,
            COALESCE(due_at, updated_at) ASC
          LIMIT ?7
        `,
      )
      .bind(
        input.project ?? null,
        input.status ?? null,
        input.initiativeId ?? null,
        input.projectSlug ?? null,
        input.outcomeId ?? null,
        input.dueBefore ?? null,
        limit,
      )
      .all<MilestoneRow>();
    return result.results.map((row) => mapMilestone(row)!);
  }

  async upsertBranchProject(input: {
    id?: string;
    projectSlug: string;
    parentInitiativeId: string;
    parentProjectSlug?: string | null;
    branchReason: string;
    hypothesis: string;
    timeboxStartsAt: string;
    timeboxEndsAt: string;
    successMetric: string;
    riskToParent: string;
    riskLevel?: BranchProject["riskLevel"];
    mergeBackCondition: string;
    killCondition: string;
    status?: BranchProject["status"];
    decisionLog?: string | null;
    metadata?: Record<string, unknown>;
  }) {
    const now = new Date().toISOString();
    const existing = await this.getBranchProject(input.projectSlug);
    const id = input.id ?? existing?.id ?? crypto.randomUUID();
    await this.db
      .prepare(
        `
          INSERT INTO branch_projects (
            id, project_slug, parent_initiative_id, parent_project_slug, branch_reason, hypothesis,
            timebox_starts_at, timebox_ends_at, success_metric, risk_to_parent, risk_level,
            merge_back_condition, kill_condition, status, decision_log, metadata_json, created_at, updated_at
          ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)
          ON CONFLICT(project_slug) DO UPDATE SET
            parent_initiative_id = excluded.parent_initiative_id,
            parent_project_slug = excluded.parent_project_slug,
            branch_reason = excluded.branch_reason,
            hypothesis = excluded.hypothesis,
            timebox_starts_at = excluded.timebox_starts_at,
            timebox_ends_at = excluded.timebox_ends_at,
            success_metric = excluded.success_metric,
            risk_to_parent = excluded.risk_to_parent,
            risk_level = excluded.risk_level,
            merge_back_condition = excluded.merge_back_condition,
            kill_condition = excluded.kill_condition,
            status = excluded.status,
            decision_log = excluded.decision_log,
            metadata_json = excluded.metadata_json,
            updated_at = excluded.updated_at
        `,
      )
      .bind(
        id,
        input.projectSlug,
        input.parentInitiativeId,
        input.parentProjectSlug ?? existing?.parentProjectSlug ?? null,
        input.branchReason,
        input.hypothesis,
        input.timeboxStartsAt,
        input.timeboxEndsAt,
        input.successMetric,
        input.riskToParent,
        input.riskLevel ?? existing?.riskLevel ?? "medium",
        input.mergeBackCondition,
        input.killCondition,
        input.status ?? existing?.status ?? "active",
        input.decisionLog ?? existing?.decisionLog ?? null,
        JSON.stringify(input.metadata ?? existing?.metadata ?? {}),
        existing?.createdAt ?? now,
        now,
      )
      .run();
    return this.getBranchProject(input.projectSlug);
  }

  async getBranchProject(projectSlug: string) {
    return mapBranchProject(
      await this.db
        .prepare("SELECT * FROM branch_projects WHERE project_slug = ?1")
        .bind(projectSlug)
        .first<BranchProjectRow>(),
    );
  }

  async listBranchProjects(input: { parentInitiativeId?: string; status?: string; limit?: number } = {}) {
    const limit = Math.min(input.limit ?? 30, 100);
    const result = await this.db
      .prepare(
        `
          SELECT * FROM branch_projects
          WHERE (?1 IS NULL OR parent_initiative_id = ?1)
            AND (?2 IS NULL OR status = ?2)
          ORDER BY status = 'active' DESC, updated_at DESC
          LIMIT ?3
        `,
      )
      .bind(input.parentInitiativeId ?? null, input.status ?? null, limit)
      .all<BranchProjectRow>();
    return result.results.map((row) => mapBranchProject(row)!);
  }

  async saveAlignmentAssessment(input: {
    project: string;
    subjectType: string;
    subjectId?: string | null;
    userIntent: string;
    alignmentLabel: AlignmentAssessment["alignmentLabel"];
    score: AlignmentAssessment["score"];
    confidence: AlignmentAssessment["confidence"];
    rationale: string;
    evidence?: string[];
    risks?: string[];
    scopeGuidance?: string | null;
    missingContext?: string[];
    strategySnapshot?: Record<string, unknown>;
  }) {
    const id = crypto.randomUUID();
    await this.db
      .prepare(
        `
          INSERT INTO alignment_assessments (
            id, project, subject_type, subject_id, user_intent, alignment_label, score,
            confidence, rationale, evidence_json, risks_json, scope_guidance,
            missing_context_json, strategy_snapshot_json, created_at
          ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)
        `,
      )
      .bind(
        id,
        input.project,
        input.subjectType,
        input.subjectId ?? null,
        input.userIntent,
        input.alignmentLabel,
        input.score,
        input.confidence,
        input.rationale,
        JSON.stringify(input.evidence ?? []),
        JSON.stringify(input.risks ?? []),
        input.scopeGuidance ?? null,
        JSON.stringify(input.missingContext ?? []),
        JSON.stringify(input.strategySnapshot ?? {}),
        new Date().toISOString(),
      )
      .run();
    return this.getAlignmentAssessment(id);
  }

  async getAlignmentAssessment(id: string) {
    return mapAlignmentAssessment(
      await this.db
        .prepare("SELECT * FROM alignment_assessments WHERE id = ?1")
        .bind(id)
        .first<AlignmentAssessmentRow>(),
    );
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

function mapEntityAlias(row: EntityAliasRow): EntityAlias {
  return {
    id: row.id,
    project: row.project,
    entityId: row.entity_id,
    alias: row.alias,
    normalizedAlias: row.normalized_alias,
    source: row.source,
    confidence: row.confidence,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapEntityState(row?: EntityStateRow | null): EntityState | null {
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    project: row.project,
    entityId: row.entity_id,
    stateKey: row.state_key,
    value: parseJsonValue(row.value_json),
    valueJson: row.value_json,
    status: row.status,
    confidence: row.confidence,
    source: row.source,
    sourceId: row.source_id,
    sourceEventId: row.source_event_id,
    validFrom: row.valid_from,
    validUntil: row.valid_until,
    supersededByStateId: row.superseded_by_state_id,
    observedAt: row.observed_at,
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

function mapStrategyNode(row?: StrategyNodeRow | null): StrategyNode | null {
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    project: row.project,
    slug: row.slug,
    type: row.type,
    title: row.title,
    summary: row.summary,
    status: row.status,
    parentId: row.parent_id,
    horizon: row.horizon,
    priority: row.priority,
    metricName: row.metric_name,
    targetValue: row.target_value,
    currentValue: row.current_value,
    metricUnit: row.metric_unit,
    metricDirection: row.metric_direction,
    startsAt: row.starts_at,
    dueAt: row.due_at,
    reviewCadence: row.review_cadence,
    tags: parseJsonArray(row.tags_json),
    metadata: parseJsonObject(row.metadata_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapAsset(row?: AssetRow | null): StrategyAsset | null {
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    project: row.project,
    slug: row.slug,
    name: row.name,
    type: row.type,
    summary: row.summary,
    status: row.status,
    owner: row.owner,
    source: row.source,
    sourceId: row.source_id,
    sourceUrl: row.source_url,
    liveSourceKind: row.live_source_kind,
    sensitivity: row.sensitivity,
    howToUse: row.how_to_use,
    limitations: row.limitations,
    tags: parseJsonArray(row.tags_json),
    metadata: parseJsonObject(row.metadata_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMilestone(row?: MilestoneRow | null): StrategyMilestone | null {
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    project: row.project,
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    status: row.status,
    initiativeId: row.initiative_id,
    projectSlug: row.project_slug,
    outcomeId: row.outcome_id,
    owner: row.owner,
    dueAt: row.due_at,
    completedAt: row.completed_at,
    successMetric: row.success_metric,
    evidence: row.evidence,
    tags: parseJsonArray(row.tags_json),
    metadata: parseJsonObject(row.metadata_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapBranchProject(row?: BranchProjectRow | null): BranchProject | null {
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    projectSlug: row.project_slug,
    parentInitiativeId: row.parent_initiative_id,
    parentProjectSlug: row.parent_project_slug,
    branchReason: row.branch_reason,
    hypothesis: row.hypothesis,
    timeboxStartsAt: row.timebox_starts_at,
    timeboxEndsAt: row.timebox_ends_at,
    successMetric: row.success_metric,
    riskToParent: row.risk_to_parent,
    riskLevel: row.risk_level,
    mergeBackCondition: row.merge_back_condition,
    killCondition: row.kill_condition,
    status: row.status,
    decisionLog: row.decision_log,
    metadata: parseJsonObject(row.metadata_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapAlignmentAssessment(row?: AlignmentAssessmentRow | null): AlignmentAssessment | null {
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    project: row.project,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    userIntent: row.user_intent,
    alignmentLabel: row.alignment_label,
    score: row.score,
    confidence: row.confidence,
    rationale: row.rationale,
    evidence: parseJsonArray(row.evidence_json),
    risks: parseJsonArray(row.risks_json),
    scopeGuidance: row.scope_guidance,
    missingContext: parseJsonArray(row.missing_context_json),
    strategySnapshot: parseJsonObject(row.strategy_snapshot_json),
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

function normalizeEntityAlias(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
