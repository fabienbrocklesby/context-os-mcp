import type {
  AlignmentAssessment,
  BranchProject,
  InitiativeProject,
  MemoryInitiative,
  StrategyAsset,
  StrategyMilestone,
  StrategyNode,
} from "~/domain/memory";
import type {
  InitiativeRow,
  InitiativeProjectRow,
  StrategyNodeRow,
  AssetRow,
  MilestoneRow,
  BranchProjectRow,
  AlignmentAssessmentRow,
} from "~/persistence/d1/types";

export class InitiativeRepository {
  constructor(private readonly db: D1Database) {}

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
