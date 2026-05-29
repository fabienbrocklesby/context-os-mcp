// src/service/InitiativeService.ts
// Initiative/strategy methods extracted from MemoryService.

import {
  normalizeProject,
  slugify,
  type AlignmentAssessment,
  type BranchProject,
  type ContextTask,
  type MemoryInitiative,
  type MemoryPrincipal,
  type MemoryProject,
  type SourceEvent,
  type StrategyAsset,
  type StrategyMilestone,
  type StrategyNode,
} from "~/domain/memory";
import type { EntityRepository } from "~/persistence/d1/EntityRepository";
import type { InitiativeRepository } from "~/persistence/d1/InitiativeRepository";
import type { ProjectRepository } from "~/persistence/d1/ProjectRepository";

// ---------------------------------------------------------------------------
// Local types
// ---------------------------------------------------------------------------

type ProposedWork = {
  title?: string;
  summary?: string;
  type?: "task" | "project" | "branch_project" | "milestone" | "initiative" | "research" | "other";
  project_slug?: string;
  initiative_id?: string;
  milestone_id?: string;
  asset_ids?: string[];
  expected_outcome?: string;
  estimated_effort?: "small" | "medium" | "large" | "unknown";
};

type StrategyContextPayload = {
  project: string;
  visions: Array<ReturnType<typeof compactStrategyNode>>;
  pillars: Array<ReturnType<typeof compactStrategyNode>>;
  outcomes: Array<ReturnType<typeof compactStrategyNode>>;
  initiatives: MemoryInitiative[];
  milestones: Array<ReturnType<typeof compactMilestone>>;
  assets: Array<ReturnType<typeof compactAsset>>;
  branch_project: BranchProject | null;
  warnings: string[];
};

// ---------------------------------------------------------------------------
// Module-level helpers (copied verbatim from service.ts)
// ---------------------------------------------------------------------------

function daysFromNowIso(days: number) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function projectMatchScore(project: MemoryProject, normalized: string | null, query: string) {
  let score = 0;
  const haystack = [
    project.slug,
    project.displayName,
    project.description ?? "",
    JSON.stringify(project.profile ?? {}),
  ]
    .join(" ")
    .toLowerCase();
  if (normalized && project.slug === normalized) {
    score += 100;
  }
  if (project.mergedIntoProject) {
    score -= 80;
  }
  if (project.canonicalStatus === "canonical") {
    score += 5;
  }
  for (const term of queryTerms(query)) {
    if (project.slug.includes(term)) {
      score += 8;
    }
    if (project.displayName.toLowerCase().includes(term)) {
      score += 6;
    }
    if (haystack.includes(term)) {
      score += 2;
    }
  }
  if (project.status === "active") {
    score += 1;
  }
  return score;
}

function projectMatchReasons(project: MemoryProject, normalized: string | null, query: string) {
  const reasons: string[] = [];
  if (normalized && project.slug === normalized) {
    reasons.push("exact slug or alias");
  }
  const display = project.displayName.toLowerCase();
  const terms = queryTerms(query);
  if (terms.some((term) => display.includes(term))) {
    reasons.push("display name match");
  }
  const profile = JSON.stringify(project.profile ?? {}).toLowerCase();
  if (terms.some((term) => profile.includes(term))) {
    reasons.push("profile metadata match");
  }
  if (project.description && terms.some((term) => project.description!.toLowerCase().includes(term))) {
    reasons.push("description match");
  }
  return reasons.length ? reasons : ["active project fallback"];
}

function queryTerms(query: string) {
  return [
    ...new Set(
      query
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .map((term) => term.trim())
        .filter((term) => term.length > 2),
    ),
  ].slice(0, 12);
}

function compactStrategyNodes(nodes: StrategyNode[]) {
  return nodes.map(compactStrategyNode);
}

function compactStrategyNode(node: StrategyNode) {
  return {
    id: node.id,
    slug: node.slug,
    type: node.type,
    title: node.title,
    summary: truncateNullable(node.summary, 240),
    status: node.status,
    parent_id: node.parentId,
    horizon: node.horizon,
    priority: node.priority,
    metric: node.metricName
      ? {
          name: node.metricName,
          target_value: node.targetValue,
          current_value: node.currentValue,
          unit: node.metricUnit,
          direction: node.metricDirection,
        }
      : null,
    due_at: node.dueAt,
    review_cadence: node.reviewCadence,
  };
}

function compactMilestone(milestone: StrategyMilestone) {
  return {
    id: milestone.id,
    slug: milestone.slug,
    title: milestone.title,
    summary: truncateNullable(milestone.summary, 220),
    status: milestone.status,
    initiative_id: milestone.initiativeId,
    project_slug: milestone.projectSlug,
    outcome_id: milestone.outcomeId,
    due_at: milestone.dueAt,
    success_metric: milestone.successMetric,
  };
}

function compactAsset(asset: StrategyAsset) {
  return {
    id: asset.id,
    slug: asset.slug,
    name: asset.name,
    type: asset.type,
    summary: truncateNullable(asset.summary, 220),
    status: asset.status,
    source: asset.source,
    source_url: asset.sourceUrl,
    live_source_kind: asset.liveSourceKind,
    sensitivity: asset.sensitivity,
    how_to_use: truncateNullable(asset.howToUse, 240),
    limitations: truncateNullable(asset.limitations, 180),
  };
}

function truncateNullable(value: string | null, max: number) {
  return value ? truncate(value, max) : null;
}

function truncate(text: string, maxLength: number) {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 1)}…`;
}

function filterByHorizon(nodes: StrategyNode[], horizon?: string) {
  if (!horizon) {
    return nodes;
  }
  const normalized = horizon.toLowerCase();
  return nodes.filter((node) => node.horizon?.toLowerCase().includes(normalized));
}

function buildStrategyWarnings(input: {
  visions: StrategyNode[];
  milestones: StrategyMilestone[];
  branchProject: BranchProject | null;
  now: Date;
}) {
  const warnings: string[] = [];
  if (input.visions.length === 0) {
    warnings.push("no_active_vision");
  }
  if (input.milestones.some((milestone) => !milestone.successMetric)) {
    warnings.push("missing_success_metric");
  }
  if (input.branchProject) {
    if (!input.branchProject.parentInitiativeId) {
      warnings.push("no_parent_initiative_for_branch_project");
    }
    const endsAt = Date.parse(input.branchProject.timeboxEndsAt);
    if (Number.isFinite(endsAt) && endsAt < input.now.getTime() && input.branchProject.status === "active") {
      warnings.push("branch_timebox_expired");
    }
  }
  return warnings;
}

function assessStrategicAlignment(input: {
  userIntent: string;
  proposedWork?: ProposedWork;
  strategyContext: StrategyContextPayload;
}) {
  const text = [
    input.userIntent,
    input.proposedWork?.title,
    input.proposedWork?.summary,
    input.proposedWork?.expected_outcome,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const evidence: string[] = [];
  const risks: string[] = [];
  const missingContext: string[] = [];
  const hasStrategy =
    input.strategyContext.visions.length > 0 ||
    input.strategyContext.pillars.length > 0 ||
    input.strategyContext.outcomes.length > 0 ||
    input.strategyContext.initiatives.length > 0;

  if (!hasStrategy) {
    missingContext.push("No active vision, pillar, outcome, or initiative is available for this project.");
    return alignmentResult({
      alignmentLabel: "unknown_until_more_context",
      score: 0,
      confidence: "low",
      rationale: "There is not enough active strategic context to classify this work without guessing.",
      evidence,
      risks,
      missingContext,
      scopeGuidance: "First capture or link the relevant vision, initiative, or outcome, then re-check alignment.",
    });
  }

  if (input.strategyContext.branch_project?.status === "killed" || text.includes("kill condition")) {
    risks.push("The work appears to touch a killed branch project or an explicit kill condition.");
    return alignmentResult({
      alignmentLabel: "conflicts",
      score: -2,
      confidence: "high",
      rationale: "The request conflicts with branch-project governance or a kill condition.",
      evidence,
      risks,
      missingContext,
      scopeGuidance: "Do not proceed unless the branch decision is reopened and recorded.",
    });
  }

  const linkedInitiative = input.proposedWork?.initiative_id
    ? input.strategyContext.initiatives.find((initiative) => initiative.id === input.proposedWork?.initiative_id)
    : null;
  const linkedMilestone = input.proposedWork?.milestone_id
    ? input.strategyContext.milestones.find((milestone) => milestone.id === input.proposedWork?.milestone_id)
    : null;
  const matchingOutcome = input.strategyContext.outcomes.find((outcome) => textMatchesNode(text, outcome));
  const matchingPillar = input.strategyContext.pillars.find((pillar) => textMatchesNode(text, pillar));
  const matchingVision = input.strategyContext.visions.find((vision) => textMatchesNode(text, vision));

  if (linkedMilestone || linkedInitiative || matchingOutcome || matchingPillar || matchingVision) {
    evidence.push(
      linkedMilestone
        ? `Linked milestone: ${linkedMilestone.title}`
        : linkedInitiative
          ? `Linked initiative: ${linkedInitiative.title}`
          : matchingOutcome
            ? `Matches outcome: ${matchingOutcome.title}`
            : matchingPillar
              ? `Matches pillar: ${matchingPillar.title}`
              : `Matches vision: ${matchingVision!.title}`,
    );
    return alignmentResult({
      alignmentLabel: "directly_advances",
      score: 2,
      confidence: linkedMilestone || linkedInitiative ? "high" : "medium",
      rationale: "The work maps to an active strategic object in the current project context.",
      evidence,
      risks,
      missingContext,
      scopeGuidance: "Scope the work around the linked strategic outcome and keep evidence of progress attached.",
    });
  }

  const hasAssetSupport = (input.proposedWork?.asset_ids?.length ?? 0) > 0 || supportIntentPattern.test(text);
  if (hasAssetSupport) {
    evidence.push("The work appears to improve or use an enabling asset, dependency, documentation, or process.");
    return alignmentResult({
      alignmentLabel: "indirectly_supports",
      score: 1,
      confidence: input.proposedWork?.asset_ids?.length ? "high" : "medium",
      rationale: "The request supports execution capacity but is not itself tied to a strategic outcome.",
      evidence,
      risks,
      missingContext,
      scopeGuidance: "Keep the scope small and link the resulting asset or dependency to the initiative it supports.",
    });
  }

  if (input.proposedWork?.type === "branch_project" || input.strategyContext.branch_project) {
    if (input.strategyContext.warnings.includes("branch_timebox_expired")) {
      risks.push("The active branch project timebox has expired.");
      return alignmentResult({
        alignmentLabel: "distraction_risk",
        score: -1,
        confidence: "high",
        rationale: "The project is governed as a branch experiment, but its timebox needs review before more work.",
        evidence,
        risks,
        missingContext,
        scopeGuidance: "Review success, merge-back, and kill conditions before adding new scope.",
      });
    }
    evidence.push("The work is framed as a governed branch project or experiment.");
    return alignmentResult({
      alignmentLabel: "neutral_experiment",
      score: 0,
      confidence: "medium",
      rationale: "The work can be valid as an experiment if it stays inside the branch protocol.",
      evidence,
      risks,
      missingContext,
      scopeGuidance: "Keep the experiment within its hypothesis, timebox, success metric, and kill condition.",
    });
  }

  if (input.proposedWork?.estimated_effort === "large") {
    risks.push("Large effort is not linked to an active strategic object.");
    return alignmentResult({
      alignmentLabel: "distraction_risk",
      score: -1,
      confidence: "medium",
      rationale: "The work may consume meaningful capacity without a visible link to active strategy.",
      evidence,
      risks,
      missingContext,
      scopeGuidance: "Reduce to a discovery task or link it to a specific initiative, milestone, or outcome first.",
    });
  }

  missingContext.push("No explicit initiative, milestone, asset, or outcome match was found.");
  return alignmentResult({
    alignmentLabel: "unknown_until_more_context",
    score: 0,
    confidence: "low",
    rationale: "The request is plausible but does not expose enough strategic linkage for a confident label.",
    evidence,
    risks,
    missingContext,
    scopeGuidance: "Ask for the intended outcome or parent initiative before committing significant work.",
  });
}

const supportIntentPattern = /\b(document|docs|asset|tool|dependency|refactor|setup|process|template|dataset|repo|enable|support)\b/i;

function textMatchesNode(
  text: string,
  node: { slug: string; title: string; summary: string | null },
) {
  const tokens = `${node.slug} ${node.title} ${node.summary ?? ""}`
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 3);
  return tokens.some((token) => text.includes(token));
}

function alignmentResult(input: Omit<AlignmentAssessment, "id" | "project" | "subjectType" | "subjectId" | "userIntent" | "strategySnapshot" | "createdAt">) {
  return input;
}

function compactStrategySnapshot(strategyContext: StrategyContextPayload) {
  return {
    project: strategyContext.project,
    vision_ids: strategyContext.visions.map((node) => node.id),
    pillar_ids: strategyContext.pillars.map((node) => node.id),
    outcome_ids: strategyContext.outcomes.map((node) => node.id),
    initiative_ids: strategyContext.initiatives.map((initiative) => initiative.id),
    milestone_ids: strategyContext.milestones.map((milestone) => milestone.id),
    asset_ids: strategyContext.assets.map((asset) => asset.id),
    branch_project_id: strategyContext.branch_project?.id ?? null,
    warnings: strategyContext.warnings,
  };
}

// ---------------------------------------------------------------------------
// Local utilities
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// InitiativeService
// ---------------------------------------------------------------------------

export class InitiativeService {
  constructor(
    private readonly env: Env,
    private readonly principal: MemoryPrincipal,
    private readonly initiativeRepo: InitiativeRepository,
    private readonly projectRepo: ProjectRepository,
    private readonly entityRepo: EntityRepository,
  ) {}

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private async ensureProject(input: {
    project: string;
    displayName?: string;
    description?: string;
    profile?: Record<string, unknown>;
  }) {
    const { project } = input;
    const existing = await this.projectRepo.getProject(project);
    if (existing) {
      return { project: existing };
    }
    const created = await this.projectRepo.upsertProject({
      slug: project,
      displayName: input.displayName ?? titleFromSlug(project),
      description: input.description ?? null,
      status: "active",
      ownerLogin: this.principal.login,
      shared: project === "shared",
      profile: input.profile,
    });
    return { project: created };
  }

  private async linkMemoryInternal(input: {
    project: string;
    fromType: string;
    fromId: string;
    toType: string;
    toId: string;
    relation: string;
    weight?: number;
    metadata?: Record<string, unknown>;
  }) {
    return {
      links: await this.entityRepo.linkMemory({
        ...input,
        project: input.project,
      }),
    };
  }

  // ---------------------------------------------------------------------------
  // Context resolution
  // ---------------------------------------------------------------------------

  private async resolveContext(input: { projectOrTopic?: string; userIntent?: string }) {
    const projects = await this.projectRepo.listProjects();
    const raw = input.projectOrTopic?.trim();
    const normalized = raw ? normalizeProject(raw) : null;
    const exact = normalized ? await this.projectRepo.getProject(normalized) : null;
    const query = [input.projectOrTopic, input.userIntent].filter(Boolean).join(" ").toLowerCase();
    const candidates = projects
      .map((project) => ({
        project,
        score: projectMatchScore(project, normalized, query),
        reasons: projectMatchReasons(project, normalized, query),
      }))
      .filter((candidate) => candidate.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, 8);
    const activeProject =
      exact ??
      candidates[0]?.project ??
      (await this.projectRepo.getProject("shared")) ??
      projects.find((project) => project.slug === "shared") ??
      projects[0];
    if (!activeProject) {
      throw new Error("No memory projects are available. Create a project before resolving context.");
    }
    const related = await this.projectRepo.listRelatedProjects(activeProject.slug);
    return {
      active_project: activeProject,
      candidates: candidates.map((candidate) => ({
        project: candidate.project,
        score: candidate.score,
        reasons: candidate.reasons,
      })),
      related_project_hints: related,
      project_switching: {
        selected: activeProject.slug,
        reason: exact
          ? `Exact project or alias match for ${raw ?? activeProject.slug}.`
          : candidates[0]
            ? `Best project match from topic and intent: ${candidates[0].reasons.join(", ")}.`
            : "No strong project match; using shared context.",
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Initiatives
  // ---------------------------------------------------------------------------

  async listInitiatives(input: { status?: string; project?: string; limit?: number }) {
    return { initiatives: await this.initiativeRepo.listInitiatives(input) };
  }

  async upsertInitiative(input: {
    slug?: string;
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
    const initiative = await this.initiativeRepo.upsertInitiative({
      slug: input.slug ? slugify(input.slug) : slugify(input.title),
      title: input.title,
      summary: input.summary,
      status: input.status,
      owner: input.owner,
      horizon: input.horizon,
      priority: input.priority,
      startsAt: input.startsAt,
      dueAt: input.dueAt,
      tags: input.tags,
      metadata: input.metadata,
      projectSlugs: input.projectSlugs?.map((project) => normalizeProject(project)),
    });
    return {
      initiative,
      projects: initiative ? await this.initiativeRepo.listInitiativeProjects(initiative.id) : [],
    };
  }

  async getInitiativeContext(input: { initiative: string }) {
    const initiative =
      (await this.initiativeRepo.getInitiativeBySlug(slugify(input.initiative))) ??
      (await this.initiativeRepo.getInitiativeById(input.initiative));
    if (!initiative) {
      throw new Error(`Initiative ${input.initiative} not found.`);
    }
    const projects = await this.initiativeRepo.listInitiativeProjects(initiative.id);
    const [tasks, facts, events] = await Promise.all([
      this.entityRepo.listTasks({ initiativeId: initiative.id, limit: 20 }),
      this.entityRepo.listFacts({ initiativeId: initiative.id, limit: 20 }),
      this.entityRepo.listSourceEvents({ limit: 20 }),
    ]);
    return {
      initiative,
      projects,
      open_tasks: tasks,
      facts,
      source_events: events.filter((event) => event.initiativeId === initiative.id).slice(0, 10),
    };
  }

  // ---------------------------------------------------------------------------
  // Visions / strategy nodes
  // ---------------------------------------------------------------------------

  async upsertVision(input: {
    project?: string;
    id?: string;
    slug?: string;
    type: StrategyNode["type"];
    title: string;
    summary?: string | null;
    status?: StrategyNode["status"];
    parentId?: string | null;
    horizon?: string | null;
    priority?: StrategyNode["priority"];
    metric?: {
      name?: string;
      target_value?: string;
      current_value?: string;
      unit?: string;
      direction?: StrategyNode["metricDirection"];
    };
    startsAt?: string | null;
    dueAt?: string | null;
    reviewCadence?: string | null;
    tags?: string[];
    metadata?: Record<string, unknown>;
  }) {
    const project = normalizeProject(input.project);
    await this.ensureProject({ project });
    if (input.parentId) {
      const parent = await this.initiativeRepo.getStrategyNodeById(input.parentId);
      if (!parent) {
        throw new Error(`Strategy parent ${input.parentId} not found.`);
      }
    }
    return {
      strategy_node: await this.initiativeRepo.upsertStrategyNode({
        id: input.id,
        project,
        slug: input.slug ? slugify(input.slug) : slugify(input.title),
        type: input.type,
        title: input.title,
        summary: input.summary,
        status: input.status,
        parentId: input.parentId,
        horizon: input.horizon,
        priority: input.priority,
        metricName: input.metric?.name,
        targetValue: input.metric?.target_value,
        currentValue: input.metric?.current_value,
        metricUnit: input.metric?.unit,
        metricDirection: input.metric?.direction,
        startsAt: input.startsAt,
        dueAt: input.dueAt,
        reviewCadence: input.reviewCadence,
        tags: input.tags,
        metadata: input.metadata,
      }),
    };
  }

  async listVisions(input: {
    project?: string;
    type?: StrategyNode["type"];
    status?: StrategyNode["status"];
    parentId?: string;
    includeChildren?: boolean;
    limit?: number;
  } = {}) {
    const project = input.project ? normalizeProject(input.project) : undefined;
    const nodes = await this.initiativeRepo.listStrategyNodes({
      project,
      type: input.type,
      status: input.status,
      parentId: input.parentId,
      limit: input.limit,
    });
    if (!input.includeChildren) {
      return { strategy_nodes: nodes };
    }
    const childrenByParent = new Map<string, StrategyNode[]>();
    const allNodes = await this.initiativeRepo.listStrategyNodes({ project, status: input.status, limit: 100 });
    for (const node of allNodes) {
      if (!node.parentId) {
        continue;
      }
      childrenByParent.set(node.parentId, [...(childrenByParent.get(node.parentId) ?? []), node]);
    }
    return {
      strategy_nodes: nodes.map((node) => ({
        ...node,
        children: childrenByParent.get(node.id) ?? [],
      })),
    };
  }

  // ---------------------------------------------------------------------------
  // Strategy context
  // ---------------------------------------------------------------------------

  async getStrategyContext(input: {
    projectOrTopic?: string;
    userIntent?: string;
    include?: Array<"visions" | "pillars" | "outcomes" | "initiatives" | "milestones" | "assets" | "branch_projects">;
    horizon?: string;
    limit?: number;
  } = {}) {
    const resolution = await this.resolveContext({
      projectOrTopic: input.projectOrTopic,
      userIntent: input.userIntent,
    });
    const project = resolution.active_project.slug;
    const include = new Set(input.include ?? [
      "visions",
      "pillars",
      "outcomes",
      "initiatives",
      "milestones",
      "assets",
      "branch_projects",
    ]);
    const compactLimit = Math.min(input.limit ?? 8, 20);
    const query = input.userIntent;
    const [
      visions,
      pillars,
      outcomes,
      initiatives,
      milestones,
      assets,
      branchProject,
    ] = await Promise.all([
      include.has("visions")
        ? this.initiativeRepo.listStrategyNodes({ project, status: "active", limit: 20 })
        : Promise.resolve([]),
      include.has("pillars")
        ? this.initiativeRepo.listStrategyNodes({ project, type: "strategic_pillar", status: "active", limit: 5 })
        : Promise.resolve([]),
      include.has("outcomes")
        ? this.initiativeRepo.listStrategyNodes({ project, type: "outcome", status: "active", query, limit: compactLimit })
        : Promise.resolve([]),
      include.has("initiatives")
        ? this.initiativeRepo.listInitiatives({ project, status: "active", limit: compactLimit })
        : Promise.resolve([]),
      include.has("milestones")
        ? this.initiativeRepo.listMilestones({ project, dueBefore: daysFromNowIso(90), limit: compactLimit })
        : Promise.resolve([]),
      include.has("assets")
        ? this.initiativeRepo.listAssets({ project, query, limit: compactLimit })
        : Promise.resolve([]),
      include.has("branch_projects") ? this.initiativeRepo.getBranchProject(project) : Promise.resolve(null),
    ]);
    const activeVisions = visions.filter((node) => node.type === "vision" || node.type === "north_star").slice(0, 2);
    const warnings = buildStrategyWarnings({
      visions: activeVisions,
      milestones,
      branchProject,
      now: new Date(),
    });
    return {
      context_resolution: resolution,
      strategy_context: {
        project,
        visions: compactStrategyNodes(activeVisions),
        pillars: compactStrategyNodes(pillars.slice(0, 5)),
        outcomes: compactStrategyNodes(filterByHorizon(outcomes, input.horizon).slice(0, compactLimit)),
        initiatives,
        milestones: milestones.slice(0, compactLimit).map(compactMilestone),
        assets: assets.slice(0, compactLimit).map(compactAsset),
        branch_project: branchProject,
        warnings,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Assets
  // ---------------------------------------------------------------------------

  async upsertAsset(input: {
    project?: string;
    id?: string;
    slug?: string;
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
    const project = normalizeProject(input.project);
    await this.ensureProject({ project });
    return {
      asset: await this.initiativeRepo.upsertAsset({
        ...input,
        project,
        slug: input.slug ? slugify(input.slug) : slugify(input.name),
      }),
    };
  }

  async listAssets(input: {
    project?: string;
    query?: string;
    type?: string;
    status?: string;
    includeArchived?: boolean;
    limit?: number;
  } = {}) {
    return {
      assets: await this.initiativeRepo.listAssets({
        ...input,
        project: input.project ? normalizeProject(input.project) : undefined,
      }),
    };
  }

  async linkAsset(input: {
    project?: string;
    assetId: string;
    toType: string;
    toId: string;
    relation: string;
    weight?: number;
    guidance?: string;
    metadata?: Record<string, unknown>;
  }) {
    const asset = await this.initiativeRepo.getAssetById(input.assetId);
    if (!asset) {
      throw new Error(`Asset ${input.assetId} not found.`);
    }
    const project = normalizeProject(input.project ?? asset.project);
    return this.linkMemoryInternal({
      project,
      fromType: "asset",
      fromId: input.assetId,
      toType: input.toType,
      toId: input.toId,
      relation: input.relation,
      weight: input.weight,
      metadata: {
        ...(input.metadata ?? {}),
        guidance: input.guidance,
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Milestones
  // ---------------------------------------------------------------------------

  async upsertMilestone(input: {
    project?: string;
    id?: string;
    slug?: string;
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
    const project = normalizeProject(input.project);
    await this.ensureProject({ project });
    if (input.initiativeId && !(await this.initiativeRepo.getInitiativeById(input.initiativeId))) {
      throw new Error(`Initiative ${input.initiativeId} not found.`);
    }
    if (input.outcomeId && !(await this.initiativeRepo.getStrategyNodeById(input.outcomeId))) {
      throw new Error(`Outcome ${input.outcomeId} not found.`);
    }
    return {
      milestone: await this.initiativeRepo.upsertMilestone({
        ...input,
        project,
        slug: input.slug ? slugify(input.slug) : slugify(input.title),
        projectSlug: input.projectSlug ? normalizeProject(input.projectSlug) : null,
      }),
    };
  }

  // ---------------------------------------------------------------------------
  // Branch projects
  // ---------------------------------------------------------------------------

  async createBranchProject(input: {
    project: string;
    displayName?: string;
    description?: string;
    parentInitiativeId: string;
    parentProjectSlug?: string | null;
    branchReason: string;
    hypothesis: string;
    timeboxStartsAt: string;
    timeboxEndsAt: string;
    successMetric: string;
    riskToParent: string;
    riskLevel: BranchProject["riskLevel"];
    mergeBackCondition: string;
    killCondition: string;
    assets?: string[];
    tags?: string[];
    metadata?: Record<string, unknown>;
  }) {
    const project = normalizeProject(input.project);
    const parentProjectSlug = input.parentProjectSlug ? normalizeProject(input.parentProjectSlug) : null;
    const initiative = await this.initiativeRepo.getInitiativeById(input.parentInitiativeId);
    if (!initiative) {
      throw new Error(`Parent initiative ${input.parentInitiativeId} not found.`);
    }
    const ensured = await this.ensureProject({
      project,
      displayName: input.displayName,
      description: input.description,
      profile: {
        branch_project: true,
        parent_initiative_id: input.parentInitiativeId,
        parent_project_slug: parentProjectSlug,
      },
    });
    await this.initiativeRepo.linkInitiativeProject({
      initiativeId: input.parentInitiativeId,
      projectSlug: project,
      role: "branch",
      status: "active",
    });
    if (parentProjectSlug) {
      await this.projectRepo.upsertProjectRelation({
        sourceProjectSlug: project,
        targetProjectSlug: parentProjectSlug,
        relation: "forked_from",
        reason: input.branchReason,
      });
    }
    const branchProject = await this.initiativeRepo.upsertBranchProject({
      projectSlug: project,
      parentInitiativeId: input.parentInitiativeId,
      parentProjectSlug,
      branchReason: input.branchReason,
      hypothesis: input.hypothesis,
      timeboxStartsAt: input.timeboxStartsAt,
      timeboxEndsAt: input.timeboxEndsAt,
      successMetric: input.successMetric,
      riskToParent: input.riskToParent,
      riskLevel: input.riskLevel,
      mergeBackCondition: input.mergeBackCondition,
      killCondition: input.killCondition,
      metadata: {
        ...(input.metadata ?? {}),
        tags: input.tags ?? [],
      },
    });
    for (const assetId of input.assets ?? []) {
      await this.entityRepo.linkMemory({
        project,
        fromType: "branch_project",
        fromId: branchProject!.id,
        toType: "asset",
        toId: assetId,
        relation: "uses",
      });
    }
    return {
      project: ensured.project,
      branch_project: branchProject,
    };
  }

  // ---------------------------------------------------------------------------
  // Alignment
  // ---------------------------------------------------------------------------

  async checkAlignment(input: {
    projectOrTopic?: string;
    userIntent: string;
    proposedWork?: ProposedWork;
    save?: boolean;
  }) {
    const strategy = await this.getStrategyContext({
      projectOrTopic: input.projectOrTopic ?? input.proposedWork?.project_slug,
      userIntent: input.userIntent,
    });
    const assessment = await this.buildAlignmentAssessment({
      userIntent: input.userIntent,
      proposedWork: input.proposedWork,
      strategyContext: strategy.strategy_context,
      save: input.save,
    });
    return {
      context_resolution: strategy.context_resolution,
      alignment_assessment: assessment,
    };
  }

  private async buildAlignmentAssessment(input: {
    userIntent: string;
    proposedWork?: ProposedWork;
    strategyContext: StrategyContextPayload;
    save?: boolean;
  }): Promise<AlignmentAssessment> {
    const assessment = assessStrategicAlignment({
      userIntent: input.userIntent,
      proposedWork: input.proposedWork,
      strategyContext: input.strategyContext,
    });
    if (!input.save) {
      return {
        id: "preview",
        project: input.strategyContext.project,
        subjectType: input.proposedWork?.type ?? "request",
        subjectId: input.proposedWork?.milestone_id ?? input.proposedWork?.initiative_id ?? null,
        userIntent: input.userIntent,
        alignmentLabel: assessment.alignmentLabel,
        score: assessment.score,
        confidence: assessment.confidence,
        rationale: assessment.rationale,
        evidence: assessment.evidence,
        risks: assessment.risks,
        scopeGuidance: assessment.scopeGuidance,
        missingContext: assessment.missingContext,
        strategySnapshot: compactStrategySnapshot(input.strategyContext),
        createdAt: new Date().toISOString(),
      };
    }
    return (await this.initiativeRepo.saveAlignmentAssessment({
      project: input.strategyContext.project,
      subjectType: input.proposedWork?.type ?? "request",
      subjectId: input.proposedWork?.milestone_id ?? input.proposedWork?.initiative_id ?? null,
      userIntent: input.userIntent,
      alignmentLabel: assessment.alignmentLabel,
      score: assessment.score,
      confidence: assessment.confidence,
      rationale: assessment.rationale,
      evidence: assessment.evidence,
      risks: assessment.risks,
      scopeGuidance: assessment.scopeGuidance,
      missingContext: assessment.missingContext,
      strategySnapshot: compactStrategySnapshot(input.strategyContext),
    }))!;
  }
}
