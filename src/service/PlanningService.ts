// src/service/PlanningService.ts
// Session planning / briefing methods extracted from MemoryService.

import { loadConfig } from "~/config/env";
import { assessContextCompleteness } from "~/domain/context-completeness";
import { buildAssistantActionPlan } from "~/domain/assistant-planning";
import {
  defaultClientEnvironments,
  defaultEnvironmentCapabilities,
  defaultToolCapabilities,
  planEnvironmentToolUse,
} from "~/domain/environment-capabilities";
import {
  buildOperatingBrief,
  buildRequestPlan,
} from "~/domain/operating-brief";
import {
  buildLogicalPath,
  normalizeProject,
  slugify,
  type AssistantSearchScope,
  type ContextTask,
  type MemoryInitiative,
  type MemoryLayer,
  type MemoryPrincipal,
  type MemoryProject,
  type MemorySearchFilters,
  type MemorySearchHit,
  type ResolvedMemoryDocument,
  type SourceEvent,
  type StrategyNode,
  type StrategyAsset,
  type StrategyMilestone,
  type BranchProject,
  type AlignmentAssessment,
} from "~/domain/memory";
import { classifyRequest, deriveRetrievalIntent } from "~/domain/request-classification";
import {
  buildRequiredContextPack,
  inferTaskProfile,
  type TaskProfile,
} from "~/domain/retrieval-policy";
import {
  compactContextResolution,
  compactCurrentContextDocuments,
  compactEntities,
  compactEnvironmentToolGuidance,
  compactFacts,
  compactInitiativeContext,
  compactLiveCheckRecommendations,
  compactOperatingBrief,
  compactProject,
  compactSearchMemory,
  compactSourceEvents,
  compactStrategyContext,
  compactTasks,
  compactToolPlan,
  enforceCompactSessionBudget,
  retrievalGuidance,
  type AssistantSessionResponseMode,
} from "~/domain/session-payload";
import type { DocumentRepository } from "~/persistence/d1/DocumentRepository";
import type { EntityRepository } from "~/persistence/d1/EntityRepository";
import type { InitiativeRepository } from "~/persistence/d1/InitiativeRepository";
import type { ProjectRepository } from "~/persistence/d1/ProjectRepository";
import type { DocumentService } from "~/service/DocumentService";
import type { InitiativeService } from "~/service/InitiativeService";
import type { RetrievalService } from "~/service/RetrievalService";

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isPresent<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
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

function classifyRetrievalMode(result: unknown) {
  const diagnostics =
    result &&
    typeof result === "object" &&
    "diagnostics" in result &&
    result.diagnostics &&
    typeof result.diagnostics === "object"
      ? (result.diagnostics as Record<string, unknown>)
      : result && typeof result === "object"
        ? (result as Record<string, unknown>)
        : {};
  const vectorHits = Number(diagnostics.vector_hits ?? 0);
  const rankedVectorHits = Number(diagnostics.ranked_vector_hits ?? 0);
  const keywordHits = Number(diagnostics.keyword_hits ?? 0);
  const vectorError = diagnostics.vector_error;
  if (vectorError) {
    return "vector_error";
  }
  if (vectorHits === 0 && keywordHits > 0) {
    return "keyword_fallback_only";
  }
  if (vectorHits > 0 && rankedVectorHits === 0) {
    return "filtered_out";
  }
  if (rankedVectorHits > 0) {
    return "semantic";
  }
  return "no_hits";
}

function buildContextWarnings(input: {
  projectStatus: { health?: { ok?: boolean; stats?: Record<string, number> } };
  groupedMemory: unknown;
  retrievalMode: string;
  entities: unknown[];
  initiatives: unknown[];
  activeSources?: string[];
}) {
  const warnings: string[] = [];
  if (!input.projectStatus.health?.ok) {
    warnings.push("Project health is not clean; inspect missing folders or failed jobs before relying on context.");
  }
  const stats = input.projectStatus.health?.stats ?? {};
  if ((stats.current_context_count ?? 0) === 0) {
    warnings.push("Project has no active current-context documents.");
  }
  if (input.retrievalMode === "keyword_fallback_only") {
    warnings.push("Retrieval is keyword-only for this request; semantic recall did not produce results.");
  }
  if (input.retrievalMode === "no_hits") {
    warnings.push("No memory matched the user intent; live source checks or context bootstrap may be needed.");
  }
  if (input.entities.length === 0) {
    warnings.push("No structured entities are linked to this context yet.");
  }
  if (input.initiatives.length === 0) {
    warnings.push("No active initiative is linked to this project.");
  }
  for (const source of input.activeSources ?? []) {
    const policy = connectorPolicyFor(source);
    if (policy.save_policy === "requires_approval") {
      warnings.push(`${source} contains approval-gated data; save only durable summaries unless explicitly approved.`);
    }
  }
  return warnings;
}

function recommendedLiveChecks(input: {
  project: string;
  activeSources?: string[];
  entities: unknown[];
  tasks: ContextTask[];
  sourceEvents: SourceEvent[];
  warnings: string[];
  currentTruthChecks?: unknown[];
}) {
  const checks = new Set<string>();
  for (const source of input.activeSources ?? []) {
    checks.add(`Check live ${source} for fresh context before writing durable summaries.`);
  }
  if (input.tasks.some((task) => task.dueAt || task.reminderAt)) {
    checks.add("Check calendar/reminder source for due-date freshness.");
  }
  if (input.sourceEvents.length === 0) {
    checks.add("If this task depends on CRM/email/calendar/shopify state, query that live MCP before deciding.");
  }
  if (input.warnings.some((warning) => warning.includes("semantic"))) {
    checks.add("Run retrieval_diagnostics and consider reindexing before assuming memory is complete.");
  }
  for (const rawCheck of input.currentTruthChecks ?? []) {
    const check = isRecord(rawCheck) ? rawCheck : {};
    const sourceKind = typeof check.source_kind === "string" ? check.source_kind : "source";
    const reason = typeof check.reason === "string" ? check.reason : "current truth guardrail";
    checks.add(`Check live ${sourceKind} before relying on current-state recommendations: ${reason}`);
  }
  return [...checks];
}

function selectiveWriteBackPolicy(activeSources?: string[]) {
  const sources = activeSources?.length
    ? activeSources
    : ["zoho_crm", "zoho_mail", "zoho_calendar", "zoho_notes", "github", "shopify", "workdrive"];
  return {
    mode: "selective_durable_facts",
    rules: [
      "Store durable summaries, decisions, deadlines, relationships, and source links.",
      "Keep raw external payloads, full private emails, attachments, and sensitive PII live-only unless explicitly approved.",
      "Prefer source_event + fact/task/entity writes over large copied documents.",
    ],
    connector_policies: Object.fromEntries(
      sources.map((source) => [source, connectorPolicyFor(source)]),
    ),
  };
}

function connectorPolicyFor(source: string) {
  const key = source.toLowerCase().replace(/[-\s]+/g, "_");
  const policies: Record<string, {
    save_policy: "durable_summary" | "live_only" | "requires_approval";
    durable: string[];
    requires_approval: string[];
    live_only: string[];
  }> = {
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
  return policies[key] ?? {
    save_policy: "requires_approval" as const,
    durable: ["durable summary with source link"],
    requires_approval: ["raw source content"],
    live_only: ["unknown connector payloads"],
  };
}

function buildRecommendedNextSteps(input: {
  alignment: AlignmentAssessment;
  toolPlan: { required_tools: Array<{ tool: string; reason: string; timing: string }> };
  actionability: { recommended_now?: string[] };
}) {
  const steps = [...(input.actionability.recommended_now ?? [])];
  for (const tool of input.toolPlan.required_tools.slice(0, 3)) {
    steps.push(`Use ${tool.tool} ${tool.timing.replace(/_/g, " ")}: ${tool.reason}`);
  }
  if (input.alignment.alignmentLabel === "directly_advances") {
    steps.push("Proceed with a scope tied to the matched strategic outcome.");
  } else if (input.alignment.alignmentLabel === "indirectly_supports") {
    steps.push("Keep the work bounded and link the resulting asset or dependency.");
  } else if (input.alignment.alignmentLabel === "neutral_experiment") {
    steps.push("Confirm hypothesis, timebox, success metric, merge-back, and kill condition.");
  } else if (input.alignment.alignmentLabel === "distraction_risk") {
    steps.push("Narrow the work or attach it to an active initiative before committing capacity.");
  } else if (input.alignment.alignmentLabel === "conflicts") {
    steps.push("Pause and resolve the strategic conflict before taking action.");
  } else {
    steps.push("Gather the missing parent initiative, outcome, or asset context before deciding.");
  }
  return [...new Set(steps)].slice(0, 8);
}

function buildSuggestedFocus(
  tasks: ContextTask[],
  initiatives: MemoryInitiative[],
  events: SourceEvent[],
) {
  const focus: string[] = [];
  for (const task of tasks.slice(0, 5)) {
    focus.push(`Task: ${task.title}${task.dueAt ? ` due ${task.dueAt}` : ""}`);
  }
  for (const initiative of initiatives.slice(0, 3)) {
    focus.push(`Initiative: ${initiative.title}`);
  }
  for (const event of events.slice(0, 3)) {
    focus.push(`Recent ${event.source}: ${event.title}`);
  }
  return focus;
}

// ---------------------------------------------------------------------------
// PlanningService
// ---------------------------------------------------------------------------

export class PlanningService {
  private readonly config: ReturnType<typeof loadConfig>;

  constructor(
    private readonly env: Env,
    private readonly principal: MemoryPrincipal,
    private readonly projectRepo: ProjectRepository,
    private readonly documentRepo: DocumentRepository,
    private readonly entityRepo: EntityRepository,
    private readonly initiativeRepo: InitiativeRepository,
    private readonly retrieval: RetrievalService,
    private readonly initiatives: InitiativeService,
    private readonly docs: DocumentService,
    config?: ReturnType<typeof loadConfig>,
  ) {
    this.config = config ?? loadConfig(env);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  async resolveContext(input: { projectOrTopic?: string; userIntent?: string }) {
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

  private async ensureProjectMinimal(input: { project: string }) {
    const { project } = input;
    const existing = await this.projectRepo.getProject(project);
    if (existing) {
      return { project: existing };
    }
    const created = await this.projectRepo.upsertProject({
      slug: project,
      displayName: titleFromSlug(project),
      status: "active",
      ownerLogin: this.principal.login,
      shared: project === "shared",
    });
    return { project: created };
  }

  private async projectStatusInternal(input: { project: string }) {
    const project = await this.projectRepo.getProject(normalizeProject(input.project));
    if (!project) {
      throw new Error(`Project ${input.project} not found.`);
    }
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

  private async findSituationDocument(): Promise<ResolvedMemoryDocument | null> {
    try {
      const docs = await this.documentRepo.findDocumentsByLayer({
        project: "shared",
        memoryLayer: "situation",
        canonical: true,
        limit: 1,
      });
      return docs[0] ?? null;
    } catch {
      return null;
    }
  }

  private async loadRelatedProjects(
    project: string,
    links: Array<{ slug: string; relation: string; reason: string | null }>,
  ) {
    const projects = [];
    for (const link of links) {
      const related = await this.projectRepo.getProject(link.slug);
      if (related) {
        projects.push({
          project: related,
          relation: link.relation,
          reason: link.reason,
        });
      }
    }
    const profile = (await this.projectRepo.getProject(project))?.profile ?? {};
    const profileRelated = Array.isArray(profile.related_projects)
      ? profile.related_projects.filter((item): item is string => typeof item === "string")
      : [];
    for (const slug of profileRelated) {
      if (projects.some((item) => item.project.slug === slug)) {
        continue;
      }
      const related = await this.projectRepo.getProject(slug);
      if (related) {
        projects.push({
          project: related,
          relation: "profile_related",
          reason: "Project profile related_projects metadata",
        });
      }
    }
    return projects;
  }

  private async buildAlignmentAssessmentLocal(input: {
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

  private planAssistantActionInternal(input: {
    userIntent?: string;
    activeSources?: string[];
    availableTools?: string[];
    timezone?: string;
    now?: string;
    businessHours?: {
      start?: string;
      end?: string;
      business_days?: number[];
    };
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

  // ---------------------------------------------------------------------------
  // Public methods
  // ---------------------------------------------------------------------------

  async prepareWorkSession(input: {
    project: string;
    topic?: string;
    authoritative?: boolean;
    taskProfile?: TaskProfile;
  }) {
    const assistantSession = await this.prepareAssistantSession({
      projectOrTopic: input.project,
      userIntent: input.topic,
      authoritative: input.authoritative,
      taskProfile: input.taskProfile,
      responseMode: "expanded",
    });
    const project = assistantSession.active_project.slug;
    return {
      project: assistantSession.active_project,
      current_context: assistantSession.current_context,
      relevant_memory: assistantSession.grouped_memory,
      github_repos: await this.projectRepo.listProjectGithubRepos(project),
      assistant_session: assistantSession,
      suggested_flow: [
        "Use assistant_session.context_resolution before assuming project scope.",
        "Use grouped_memory and initiative_context before answering broad requests.",
        "Run recommended live MCP checks when freshness warnings mention external sources.",
        "Call finish_work_session for durable changes, tasks, source events, facts, and remaining work.",
      ],
    };
  }

  async prepareAssistantSession(input: {
    projectOrTopic?: string;
    userIntent?: string;
    environment?: string;
    activeSources?: string[];
    availableTools?: string[];
    timezone?: string;
    now?: string;
    businessHours?: {
      start?: string;
      end?: string;
      business_days?: number[];
    };
    authoritative?: boolean;
    taskProfile?: TaskProfile;
    responseMode?: AssistantSessionResponseMode;
  }) {
    const situationDoc = await this.findSituationDocument();
    const resolution = await this.resolveContext({
      projectOrTopic: input.projectOrTopic,
      userIntent: input.userIntent,
    });
    const activeProject = resolution.active_project;
    const project = activeProject.slug;
    const taskProfile = input.taskProfile ?? inferTaskProfile(input.userIntent);
    const requiredContextPack = buildRequiredContextPack({
      project,
      taskProfile,
      userIntent: input.userIntent,
    });
    await this.ensureProjectMinimal({ project });
    const assistantActionPlan = this.planAssistantActionInternal({
      userIntent: input.userIntent,
      activeSources: input.activeSources,
      availableTools: input.availableTools,
      timezone: input.timezone,
      now: input.now,
      businessHours: input.businessHours,
      projectTimezone: activeProject.profile.timezone,
    });
    const responseMode = input.responseMode ?? "compact";

    const [
      currentContextDocuments,
      initiatives,
      relatedProjectLinks,
      entities,
      tasks,
      sourceEvents,
      facts,
      projectStatus,
    ] = await Promise.all([
      this.documentRepo.listCurrentContextDocuments(project),
      this.initiativeRepo.listInitiatives({ project, status: "active", limit: 10 }),
      this.projectRepo.listRelatedProjects(project),
      this.entityRepo.searchEntities({ project, query: input.userIntent, limit: 12 }),
      this.entityRepo.listTasks({ project, dueBefore: daysFromNowIso(14), limit: 12 }),
      this.entityRepo.listSourceEvents({ project, limit: 10 }),
      this.entityRepo.listFacts({ project, limit: 12 }),
      this.projectStatusInternal({ project }),
    ]);
    const currentContext = responseMode === "expanded"
      ? await this.docs.getCurrentContext({ project, authoritative: input.authoritative })
      : compactCurrentContextDocuments(currentContextDocuments);

    const groupedMemory = input.userIntent
      ? await this.retrieval.searchMemory({
          query: input.userIntent,
          project,
          limit: 12,
          authoritative: input.authoritative,
          scope: relatedProjectLinks.length ? "all_related" : "project",
          taskProfile,
        })
      : { results: [], grouped: {}, documents: [], diagnostics: null };

    const initiativeContext = await Promise.all(
      initiatives.map(async (initiative) => this.initiatives.getInitiativeContext({ initiative: initiative.slug })),
    );
    const relatedProjects = await this.loadRelatedProjects(project, relatedProjectLinks);
    const strategyContext = await this.initiatives.getStrategyContext({
      projectOrTopic: project,
      userIntent: input.userIntent,
      limit: 8,
    });
    const currentTruth = "current_truth" in groupedMemory ? groupedMemory.current_truth : null;
    const retrievalMode = classifyRetrievalMode(groupedMemory);
    const contextCompleteness = await this.retrieval.assessContextCompletenessSafely({
      project,
      currentContextDocuments: currentContextDocuments.map((document) => ({
        title: document.title,
        path: document.path,
        tags: document.tags,
      })),
      repoFullNames: projectStatus.github_repos?.map((repo) => repo.repoFullName) ?? [],
    });
    const warnings = buildContextWarnings({
      projectStatus,
      groupedMemory,
      retrievalMode,
      entities,
      initiatives,
      activeSources: input.activeSources,
    })
      .concat(project === "light-lane" ? contextCompleteness.warnings : [])
      .concat(currentTruth?.warnings ?? []);
    const contextHealth = {
      retrieval_mode: retrievalMode,
      warnings,
      project_health: projectStatus.health,
      context_completeness: contextCompleteness,
    };
    const writeBackPolicy = selectiveWriteBackPolicy(input.activeSources);
    const environmentToolGuidance = planEnvironmentToolUse({
      environment: input.environment,
      userIntent: input.userIntent ?? "",
      projectOrTopic: input.projectOrTopic ?? project,
      availableTools: input.availableTools,
      activeSources: input.activeSources,
      includeInstructions: true,
    });
    const alignmentAssessment = await this.buildAlignmentAssessmentLocal({
      userIntent: input.userIntent ?? "",
      proposedWork: {
        type: "other",
        summary: input.userIntent,
        project_slug: project,
      },
      strategyContext: strategyContext.strategy_context,
      save: false,
    });
    const operatingBrief = buildOperatingBrief({
      userIntent: input.userIntent,
      contextResolution: resolution,
      relatedProjects,
      operationalContext: assistantActionPlan.operational_context,
      requestClassification: assistantActionPlan.request_classification,
      actionability: assistantActionPlan.actionability,
      toolPlan: assistantActionPlan.tool_plan,
      strategyContext: strategyContext.strategy_context,
      alignmentAssessment,
      groupedMemory,
      contextHealth,
      tasks,
      sourceEvents,
      writeBackPolicy,
      availableTools: input.availableTools,
      environmentToolGuidance,
    });

    const session = {
      response_mode: responseMode,
      task_profile: taskProfile,
      required_context_pack: requiredContextPack,
      context_completeness: contextCompleteness,
      repo_coverage: contextCompleteness.repo_coverage,
      memory_quality_gates: contextCompleteness.memory_quality_gates,
      context_resolution: resolution,
      situation: situationDoc
        ? {
            content: situationDoc.bodyMarkdown ?? null,
            path: situationDoc.path,
          }
        : null,
      active_project: activeProject,
      related_projects: relatedProjects,
      initiative_context: initiativeContext,
      strategy_context: strategyContext.strategy_context,
      current_context: currentContext,
      grouped_memory: groupedMemory,
      current_truth: currentTruth,
      entities,
      tasks,
      source_events: sourceEvents,
      facts,
      context_health: contextHealth,
      environment_tool_guidance: environmentToolGuidance,
      ...assistantActionPlan,
      operating_brief: operatingBrief,
      recommended_live_mcp_checks: recommendedLiveChecks({
        project,
        activeSources: input.activeSources,
        entities,
        tasks,
        sourceEvents,
        warnings,
        currentTruthChecks: currentTruth?.required_live_checks,
      }),
      write_back_policy: writeBackPolicy,
      retrieval_guidance: retrievalGuidance(),
      payload_budget: responseMode === "expanded"
        ? { max_bytes: null, serialized_bytes: null, trimmed: false }
        : { max_bytes: 0, serialized_bytes: 0, trimmed: false },
    };
    if (responseMode === "expanded") {
      return session;
    }

    return enforceCompactSessionBudget({
      ...session,
      context_resolution: compactContextResolution(resolution),
      active_project: compactProject(activeProject),
      initiative_context: compactInitiativeContext(initiativeContext),
      strategy_context: compactStrategyContext(strategyContext.strategy_context),
      current_context: currentContext,
      grouped_memory: compactSearchMemory(groupedMemory),
      entities: compactEntities(entities),
      tasks: compactTasks(tasks),
      source_events: compactSourceEvents(sourceEvents),
      facts: compactFacts(facts),
      environment_tool_guidance: compactEnvironmentToolGuidance(environmentToolGuidance),
      tool_plan: compactToolPlan(assistantActionPlan.tool_plan),
      operating_brief: compactOperatingBrief(operatingBrief),
      recommended_live_mcp_checks: compactLiveCheckRecommendations(session.recommended_live_mcp_checks),
    });
  }

  async planRequest(input: {
    projectOrTopic?: string;
    userIntent: string;
    environment?: string;
    activeSources?: string[];
    availableTools?: string[];
    timezone?: string;
    now?: string;
    businessHours?: {
      start?: string;
      end?: string;
      business_days?: number[];
    };
    includeMemory?: boolean;
    includeAssets?: boolean;
    includeActiveTasks?: boolean;
    taskProfile?: TaskProfile;
    responseMode?: AssistantSessionResponseMode;
  }) {
    const resolution = await this.resolveContext({
      projectOrTopic: input.projectOrTopic,
      userIntent: input.userIntent,
    });
    const project = resolution.active_project.slug;
    const taskProfile = input.taskProfile ?? inferTaskProfile(input.userIntent);
    const responseMode = input.responseMode ?? "compact";
    const requiredContextPack = buildRequiredContextPack({
      project,
      taskProfile,
      userIntent: input.userIntent,
    });
    const actionPlan = this.planAssistantActionInternal({
      userIntent: input.userIntent,
      activeSources: input.activeSources,
      availableTools: input.availableTools,
      timezone: input.timezone,
      now: input.now,
      businessHours: input.businessHours,
      projectTimezone: resolution.active_project.profile.timezone,
    });
    const [strategy, memory, activeTasks, sourceEvents, projectStatus] = await Promise.all([
      this.initiatives.getStrategyContext({ projectOrTopic: project, userIntent: input.userIntent }),
      input.includeMemory === false
        ? Promise.resolve(null)
        : this.retrieval.searchMemory({ project, query: input.userIntent, limit: 8, scope: "project", taskProfile }),
      input.includeActiveTasks === false
        ? Promise.resolve([])
        : this.entityRepo.listTasks({ project, dueBefore: daysFromNowIso(14), limit: 12 }),
      this.entityRepo.listSourceEvents({ project, limit: 10 }),
      this.projectStatusInternal({ project }),
    ]);
    const relevantAssets = input.includeAssets === false ? [] : strategy.strategy_context.assets;
    const alignment = await this.buildAlignmentAssessmentLocal({
      userIntent: input.userIntent,
      proposedWork: {
        type: "other",
        summary: input.userIntent,
        project_slug: project,
      },
      strategyContext: strategy.strategy_context,
      save: false,
    });
    const retrievalMode = memory ? classifyRetrievalMode(memory) : "not_requested";
    const currentTruth = memory && "current_truth" in memory ? memory.current_truth : null;
    const contextCompleteness = await this.retrieval.assessContextCompletenessSafely(project);
    const contextWarnings = buildContextWarnings({
      projectStatus,
      groupedMemory: memory,
      retrievalMode,
      entities: [],
      initiatives: strategy.strategy_context.initiatives,
      activeSources: input.activeSources,
    }).concat(project === "light-lane" ? contextCompleteness.warnings : []);
    const contextHealth = {
      retrieval_mode: retrievalMode,
      warnings: contextWarnings,
      project_health: projectStatus.health,
      context_completeness: contextCompleteness,
    };
    const writeBackPolicy = selectiveWriteBackPolicy(input.activeSources);
    const environmentToolGuidance = planEnvironmentToolUse({
      environment: input.environment,
      userIntent: input.userIntent,
      projectOrTopic: input.projectOrTopic ?? project,
      availableTools: input.availableTools,
      activeSources: input.activeSources,
      includeInstructions: true,
    });
    const operatingBrief = buildOperatingBrief({
      userIntent: input.userIntent,
      contextResolution: resolution,
      relatedProjects: [],
      operationalContext: actionPlan.operational_context,
      requestClassification: actionPlan.request_classification,
      actionability: actionPlan.actionability,
      toolPlan: actionPlan.tool_plan,
      strategyContext: {
        ...strategy.strategy_context,
        assets: relevantAssets,
      },
      alignmentAssessment: alignment,
      groupedMemory: memory,
      contextHealth,
      tasks: activeTasks,
      sourceEvents,
      writeBackPolicy,
      availableTools: input.availableTools,
      environmentToolGuidance,
    });
    const requestPlan = buildRequestPlan({
      userIntent: input.userIntent,
      operatingBrief,
      recommendedScope: alignment.scopeGuidance,
    });
    const response = {
      response_mode: responseMode,
      task_profile: taskProfile,
      required_context_pack: requiredContextPack,
      context_completeness: contextCompleteness,
      repo_coverage: contextCompleteness.repo_coverage,
      memory_quality_gates: contextCompleteness.memory_quality_gates,
      context_resolution: resolution,
      operational_context: actionPlan.operational_context,
      request_classification: actionPlan.request_classification,
      actionability: actionPlan.actionability,
      tool_plan: actionPlan.tool_plan,
      strategy_context: strategy.strategy_context,
      grouped_memory: memory,
      current_truth: currentTruth,
      active_tasks: activeTasks,
      relevant_assets: relevantAssets,
      alignment_assessment: alignment,
      environment_tool_guidance: environmentToolGuidance,
      operating_brief: operatingBrief,
      request_plan: requestPlan,
      recommended_scope: alignment.scopeGuidance,
      recommended_next_steps: buildRecommendedNextSteps({
        alignment,
        toolPlan: actionPlan.tool_plan,
        actionability: actionPlan.actionability,
      }),
      write_back_policy: writeBackPolicy,
      retrieval_guidance: retrievalGuidance(),
      payload_budget: responseMode === "expanded"
        ? { max_bytes: null, serialized_bytes: null, trimmed: false }
        : { max_bytes: 0, serialized_bytes: 0, trimmed: false },
    };
    if (responseMode === "expanded") {
      return response;
    }

    const compactStrategy = compactStrategyContext(strategy.strategy_context);
    return enforceCompactSessionBudget({
      ...response,
      context_resolution: compactContextResolution(resolution),
      strategy_context: compactStrategy,
      grouped_memory: memory ? compactSearchMemory(memory) : null,
      active_tasks: compactTasks(activeTasks),
      relevant_assets: compactStrategy.assets,
      environment_tool_guidance: compactEnvironmentToolGuidance(environmentToolGuidance),
      tool_plan: compactToolPlan(actionPlan.tool_plan),
      operating_brief: compactOperatingBrief(operatingBrief, "active_tasks"),
    });
  }

  async dailyBriefing(input: { project?: string; date?: string } = {}) {
    const project = input.project ? normalizeProject(input.project) : undefined;
    const dueBefore = input.date ?? daysFromNowIso(1);
    const [projects, initiatives, tasks, events] = await Promise.all([
      project ? [await this.projectRepo.getProject(project)] : this.projectRepo.listProjects(),
      this.initiativeRepo.listInitiatives({ project, status: "active", limit: 20 }),
      this.entityRepo.listTasks({ project, dueBefore, limit: 50 }),
      this.entityRepo.listSourceEvents({ project, limit: 20 }),
    ]);
    return {
      date: input.date ?? new Date().toISOString(),
      projects: projects.filter(Boolean),
      active_initiatives: initiatives,
      due_or_upcoming_tasks: tasks,
      recent_source_events: events,
      suggested_focus: buildSuggestedFocus(tasks, initiatives, events),
    };
  }

  async contextHealthCheck(input: { project?: string; query?: string } = {}) {
    const project = normalizeProject(input.project);
    const status = await this.projectStatusInternal({ project });
    const diagnostics = input.query
      ? await this.retrieval.retrievalDiagnostics({ project, query: input.query })
      : null;
    const initiatives = await this.initiativeRepo.listInitiatives({ project, status: "active", limit: 10 });
    const tasks = await this.entityRepo.listTasks({ project, dueBefore: daysFromNowIso(7), limit: 20 });
    const contextCompleteness = await this.retrieval.assessContextCompletenessSafely({
      project,
      repoFullNames: status.github_repos?.map((repo) => repo.repoFullName) ?? [],
    });
    const warnings = buildContextWarnings({
      projectStatus: status,
      groupedMemory: diagnostics,
      retrievalMode: diagnostics ? classifyRetrievalMode(diagnostics) : "not_checked",
      entities: await this.entityRepo.searchEntities({ project, limit: 5 }),
      initiatives,
      activeSources: [],
    }).concat(project === "light-lane" ? contextCompleteness.warnings : []);
    return {
      project,
      status,
      initiatives,
      upcoming_tasks: tasks,
      retrieval: diagnostics,
      context_completeness: contextCompleteness,
      repo_coverage: contextCompleteness.repo_coverage,
      memory_quality_gates: contextCompleteness.memory_quality_gates,
      warnings,
    };
  }
}
