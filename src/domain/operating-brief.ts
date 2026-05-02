import type { ActionabilityAssessment } from "~/domain/actionability";
import type {
  AlignmentAssessment,
  BranchProject,
  ContextTask,
  SourceEvent,
} from "~/domain/memory";
import type { RequestClassification } from "~/domain/request-classification";
import type { TimeContext } from "~/domain/time-context";
import type { ToolPlan } from "~/domain/tool-policy";
import { connectorPolicyFor } from "~/domain/tool-policy";

type Timing = "before_answer" | "before_action" | "before_write";

type BriefToolCheck = {
  tool: string;
  source_kind: string;
  reason: string;
  timing: Timing;
  required: boolean;
  available: boolean;
  blocking: boolean;
  fallback: string;
};

type StrategyContextForBrief = {
  project: string;
  visions: unknown[];
  pillars: unknown[];
  outcomes: unknown[];
  initiatives: unknown[];
  milestones: Array<{
    id?: string;
    slug?: string;
    title?: string;
    status?: string;
    due_at?: string | null;
    success_metric?: string | null;
  }>;
  assets: Array<{
    id?: string;
    slug?: string;
    name?: string;
    type?: string;
    status?: string;
    sensitivity?: string;
    source?: string | null;
    source_url?: string | null;
    live_source_kind?: string | null;
    how_to_use?: string | null;
    limitations?: string | null;
  }>;
  branch_project: BranchProject | null;
  warnings: string[];
};

type SearchDiagnostics = {
  vector_hits?: number;
  ranked_vector_hits?: number;
  keyword_hits?: number;
  vector_error?: string | null;
  keyword_fallback_used?: boolean;
  keyword_fallback_due_to_empty_semantic?: boolean;
};

type MemorySearchForBrief = {
  diagnostics?: SearchDiagnostics | null;
} | null;

type ProjectHealthForBrief = {
  ok?: boolean;
  missing_folders?: unknown[];
  stats?: {
    document_count?: number;
    current_context_count?: number;
    active_decision_count?: number;
    chunk_count?: number;
    failed_job_count?: number;
  };
};

type ContextHealthForBrief = {
  retrieval_mode: string;
  warnings: string[];
  project_health?: ProjectHealthForBrief;
};

type WriteBackPolicyForBrief = {
  mode: string;
  rules: string[];
  connector_policies: Record<string, ReturnType<typeof connectorPolicyFor>>;
};

export type OperatingBriefInput = {
  userIntent?: string;
  contextResolution: unknown;
  relatedProjects?: unknown[];
  operationalContext: TimeContext;
  requestClassification: RequestClassification;
  actionability: ActionabilityAssessment;
  toolPlan: ToolPlan;
  strategyContext: StrategyContextForBrief;
  alignmentAssessment?: AlignmentAssessment | null;
  groupedMemory?: MemorySearchForBrief;
  contextHealth: ContextHealthForBrief;
  tasks: ContextTask[];
  sourceEvents: SourceEvent[];
  writeBackPolicy: WriteBackPolicyForBrief;
  availableTools?: string[];
};

export function buildOperatingBrief(input: OperatingBriefInput) {
  const requiredLiveChecks = buildRequiredLiveChecks(input);
  const missingChecks = requiredLiveChecks.filter((check) => check.blocking);
  const risks = buildRisks(input, missingChecks);
  const recommendedNextActions = buildBriefNextActions(input, requiredLiveChecks);

  return {
    context_resolution: {
      ...objectOrEmpty(input.contextResolution),
      related_projects: input.relatedProjects ?? [],
      branch_project: summarizeBranchProject(input.strategyContext.branch_project),
      ambiguity_warnings: contextAmbiguityWarnings(input.contextResolution),
    },
    time_actionability: {
      ...input.operationalContext,
      actionability_label: input.actionability.label,
      recommended_now: input.actionability.recommended_now,
      defer_until: input.actionability.defer_until ?? null,
      guardrails: input.actionability.guardrails,
    },
    strategic_alignment: {
      project: input.strategyContext.project,
      visions: input.strategyContext.visions,
      pillars: input.strategyContext.pillars,
      outcomes: input.strategyContext.outcomes,
      initiatives: input.strategyContext.initiatives,
      milestones: input.strategyContext.milestones,
      branch_project: summarizeBranchProject(input.strategyContext.branch_project),
      warnings: input.strategyContext.warnings,
      assessment: input.alignmentAssessment
        ? {
            label: input.alignmentAssessment.alignmentLabel,
            score: input.alignmentAssessment.score,
            confidence: input.alignmentAssessment.confidence,
            rationale: input.alignmentAssessment.rationale,
            evidence: input.alignmentAssessment.evidence,
            risks: input.alignmentAssessment.risks,
            missing_context: input.alignmentAssessment.missingContext,
            recommended_scope: input.alignmentAssessment.scopeGuidance,
          }
        : null,
    },
    relevant_assets: input.strategyContext.assets.map((asset) => ({
      id: asset.id,
      slug: asset.slug,
      name: asset.name,
      type: asset.type,
      status: asset.status,
      sensitivity: asset.sensitivity,
      source: asset.source,
      source_url: asset.source_url,
      live_source_kind: asset.live_source_kind,
      how_to_use: asset.how_to_use,
      limitations: asset.limitations,
      live_check_required: Boolean(asset.live_source_kind && asset.live_source_kind !== "manual"),
    })),
    current_tasks_milestones: {
      open_tasks: input.tasks.filter((task) => task.status !== "done" && task.status !== "cancelled"),
      due_or_blocked_tasks: input.tasks.filter((task) => task.dueAt || task.status === "blocked"),
      high_priority_tasks: input.tasks.filter((task) => task.priority === "high" || task.priority === "urgent"),
      milestones: input.strategyContext.milestones,
      overdue_markers: overdueMarkers(input),
    },
    source_freshness: {
      retrieval_mode: input.contextHealth.retrieval_mode,
      diagnostics: input.groupedMemory?.diagnostics ?? null,
      warnings: input.contextHealth.warnings,
      last_known_source_event: input.sourceEvents[0] ?? null,
      project_health: input.contextHealth.project_health ?? null,
      missing_current_context_sections: missingCurrentContextSections(input.contextHealth.project_health),
      repo_index_status: repoIndexStatus(input.contextHealth.project_health),
    },
    required_live_checks: requiredLiveChecks,
    risks,
    recommended_next_actions: recommendedNextActions,
    write_back_plan: buildWriteBackPlan(input),
  };
}

export function buildRequestPlan(input: {
  userIntent: string;
  operatingBrief: ReturnType<typeof buildOperatingBrief>;
  recommendedScope?: string | null;
}) {
  return {
    objective: input.userIntent,
    constraints: [
      ...input.operatingBrief.time_actionability.guardrails,
      ...input.operatingBrief.risks.map((risk) => risk.summary),
    ],
    tool_sequence: input.operatingBrief.required_live_checks
      .filter((check) => check.required)
      .map((check) => ({
        tool: check.tool,
        timing: check.timing,
        reason: check.reason,
        available: check.available,
        blocking: check.blocking,
        fallback: check.fallback,
      })),
    recommended_scope:
      input.recommendedScope ??
      input.operatingBrief.strategic_alignment.assessment?.recommended_scope ??
      null,
    next_actions: input.operatingBrief.recommended_next_actions,
    write_back_plan: input.operatingBrief.write_back_plan,
  };
}

function buildRequiredLiveChecks(input: OperatingBriefInput): BriefToolCheck[] {
  const checks = new Map<string, BriefToolCheck>();
  for (const tool of input.toolPlan.required_tools) {
    addCheck(checks, input.availableTools, {
      tool: tool.tool,
      source_kind: sourceKindForTool(tool.tool),
      reason: tool.reason,
      timing: tool.timing,
      required: true,
      fallback: fallbackForTool(tool.tool),
    });
  }

  if (input.requestClassification.categories.code_repo) {
    addCheck(checks, input.availableTools, {
      tool: "github_get_file",
      source_kind: "github",
      reason: "Fetch exact files after code search identifies relevant paths before making precise repo claims.",
      timing: "before_action",
      required: false,
      fallback: "State that exact file contents were not checked and rely only on visible/local context.",
    });
  }

  if (input.requestClassification.categories.planning_scheduling) {
    const calendarRequired = /\b(schedule|meeting|availability|calendar|book|call|today|tomorrow|week|reminder)\b/i.test(
      input.userIntent ?? "",
    );
    addCheck(checks, input.availableTools, {
      tool: "calendar",
      source_kind: "calendar",
      reason: "Check live availability before committing to dated plans, meetings, reminders, or week/day schedules.",
      timing: "before_answer",
      required: calendarRequired,
      fallback: "Make only tentative date recommendations and tell the user calendar availability was not checked.",
    });
  }

  for (const asset of input.strategyContext.assets) {
    if (!asset.live_source_kind || asset.live_source_kind === "manual") {
      continue;
    }
    addCheck(checks, input.availableTools, {
      tool: asset.live_source_kind,
      source_kind: asset.live_source_kind,
      reason: `Check live ${asset.live_source_kind} state before relying on asset ${asset.name ?? asset.slug ?? asset.id}.`,
      timing: "before_action",
      required: false,
      fallback: "Use the stored asset summary only and note that the live asset source was not checked.",
    });
  }

  return [...checks.values()];
}

function addCheck(
  checks: Map<string, BriefToolCheck>,
  availableTools: string[] | undefined,
  input: Omit<BriefToolCheck, "available" | "blocking">,
) {
  const available = isToolAvailable(input.tool, input.source_kind, availableTools);
  const blocking = input.required && !available;
  checks.set(input.tool, {
    ...input,
    available,
    blocking,
  });
}

function isToolAvailable(tool: string, sourceKind: string, availableTools?: string[]) {
  if (!availableTools?.length) {
    return true;
  }
  const normalized = new Set(availableTools.map(normalizeToolName));
  if (normalized.has(normalizeToolName(tool)) || normalized.has(normalizeToolName(sourceKind))) {
    return true;
  }
  if (sourceKind === "memory" && normalized.has("memory")) {
    return true;
  }
  if (sourceKind === "github" && normalized.has("github")) {
    return true;
  }
  if (sourceKind === "calendar") {
    return normalized.has("zoho_calendar") || normalized.has("google_calendar") || normalized.has("outlook_calendar");
  }
  if (sourceKind === "zoho_crm") {
    return normalized.has("crm") || normalized.has("zoho");
  }
  if (sourceKind === "zoho_mail") {
    return normalized.has("email") || normalized.has("mail") || normalized.has("zoho");
  }
  return false;
}

function normalizeToolName(tool: string) {
  return tool.toLowerCase().replace(/[-.\s]+/g, "_");
}

function sourceKindForTool(tool: string) {
  const normalized = normalizeToolName(tool);
  if (normalized.startsWith("github")) {
    return "github";
  }
  if (normalized.includes("calendar")) {
    return "calendar";
  }
  if (normalized === "crm") {
    return "zoho_crm";
  }
  if (normalized === "email" || normalized === "mail") {
    return "zoho_mail";
  }
  if (normalized.includes("shopify")) {
    return "shopify";
  }
  if (normalized.includes("workdrive")) {
    return "workdrive";
  }
  if (
    normalized.includes("memory") ||
    normalized === "prepare_assistant_session" ||
    normalized === "search_memory" ||
    normalized === "get_operational_context"
  ) {
    return "memory";
  }
  return normalized;
}

function fallbackForTool(tool: string) {
  const sourceKind = sourceKindForTool(tool);
  if (sourceKind === "github") {
    return "Do not make live repo claims; proceed only from visible/local files and say GitHub was unavailable.";
  }
  if (sourceKind === "calendar") {
    return "Make only tentative scheduling recommendations and say calendar availability was unavailable.";
  }
  if (sourceKind === "memory") {
    return "Proceed only from visible context and say durable memory context was unavailable.";
  }
  return `Proceed only from visible context and say live ${sourceKind} state was unavailable.`;
}

function buildRisks(input: OperatingBriefInput, missingChecks: BriefToolCheck[]) {
  const risks = new Map<string, { type: string; summary: string; severity: "low" | "medium" | "high" }>();
  for (const warning of input.contextHealth.warnings) {
    risks.set(`context:${warning}`, { type: "source_freshness", summary: warning, severity: "medium" });
  }
  for (const warning of input.strategyContext.warnings) {
    risks.set(`strategy:${warning}`, { type: "strategy", summary: warning, severity: "medium" });
  }
  for (const reason of input.actionability.reasons) {
    if (input.actionability.label !== "actionable_now") {
      risks.set(`action:${reason}`, { type: "actionability", summary: reason, severity: "medium" });
    }
  }
  for (const check of missingChecks) {
    risks.set(`tool:${check.tool}`, {
      type: "missing_tool",
      summary: `${check.tool} is required but unavailable.`,
      severity: "high",
    });
  }
  for (const item of input.toolPlan.forbidden_without_confirmation) {
    risks.set(`confirm:${item.action}`, {
      type: "confirmation_required",
      summary: `${item.action}: ${item.reason}`,
      severity: "high",
    });
  }
  for (const risk of input.alignmentAssessment?.risks ?? []) {
    risks.set(`alignment:${risk}`, { type: "strategic_alignment", summary: risk, severity: "medium" });
  }
  if (input.strategyContext.branch_project?.riskToParent) {
    risks.set("branch_project:risk_to_parent", {
      type: "branch_project",
      summary: input.strategyContext.branch_project.riskToParent,
      severity: input.strategyContext.branch_project.riskLevel === "critical" ? "high" : "medium",
    });
  }
  return [...risks.values()];
}

function buildBriefNextActions(input: OperatingBriefInput, checks: BriefToolCheck[]) {
  return {
    before_answer: checks
      .filter((check) => check.timing === "before_answer")
      .map((check) => actionForCheck(check)),
    before_action: checks
      .filter((check) => check.timing === "before_action")
      .map((check) => actionForCheck(check)),
    before_write: checks
      .filter((check) => check.timing === "before_write")
      .map((check) => actionForCheck(check)),
    safe_now: input.actionability.recommended_now,
    defer_until: input.actionability.defer_until ?? null,
    needs_user_confirmation: input.toolPlan.forbidden_without_confirmation.map((item) => ({
      action: item.action,
      reason: item.reason,
    })),
  };
}

function actionForCheck(check: BriefToolCheck) {
  return {
    tool: check.tool,
    action: check.available
      ? `Use ${check.tool}: ${check.reason}`
      : `Warn that ${check.tool} is unavailable. ${check.fallback}`,
    required: check.required,
    available: check.available,
  };
}

function buildWriteBackPlan(input: OperatingBriefInput) {
  const recommendations = new Map<string, {
    tool: string;
    when: string;
    content_types: string[];
    save_policy: "durable_summary" | "live_only" | "requires_approval";
  }>();
  for (const recommendation of input.toolPlan.write_back_recommendations) {
    recommendations.set(recommendation.tool, {
      ...recommendation,
      save_policy: savePolicyForWriteTool(recommendation.tool),
    });
  }
  for (const item of [
    {
      tool: "finish_work_session",
      when: "After meaningful work.",
      content_types: ["summary", "commands/results", "decisions", "remaining risks"],
    },
    {
      tool: "record_decision",
      when: "When architecture, product, deployment, or workflow decisions are made.",
      content_types: ["decision title", "rationale", "implications", "source context"],
    },
    {
      tool: "upsert_task",
      when: "When the user asks to persist a task, reminder, or follow-up.",
      content_types: ["task title", "status", "priority", "due/reminder date", "source link"],
    },
    {
      tool: "save_source_event",
      when: "When a live source changes durable project context.",
      content_types: ["durable summary", "source id", "source URL", "sensitivity"],
    },
    {
      tool: "extract_durable_facts",
      when: "When user-approved text contains durable facts.",
      content_types: ["fact candidates", "source", "confidence"],
    },
    {
      tool: "save_snippet",
      when: "When a small code or document excerpt should be reusable durable context.",
      content_types: ["snippet", "source", "repo/path", "usefulness"],
    },
    {
      tool: "link_memory",
      when: "When projects, initiatives, assets, tasks, facts, documents, or events should be related.",
      content_types: ["from item", "to item", "relation", "weight"],
    },
  ] as const) {
    if (!recommendations.has(item.tool)) {
      recommendations.set(item.tool, {
        ...item,
        content_types: [...item.content_types],
        save_policy: savePolicyForWriteTool(item.tool),
      });
    }
  }
  return {
    recommendations: [...recommendations.values()],
    connector_policies: input.writeBackPolicy.connector_policies,
    forbidden_content: [
      "secrets or credentials",
      "raw private email bodies",
      "full private calendar details",
      "raw CRM or Shopify payloads",
      "large raw diffs",
      "private document bodies without explicit approval",
      "sensitive personal data without explicit approval",
    ],
    policy_rules: input.writeBackPolicy.rules,
  };
}

function savePolicyForWriteTool(tool: string) {
  if (tool === "save_source_event" || tool === "finish_work_session" || tool === "record_decision") {
    return "durable_summary" as const;
  }
  if (tool === "save_snippet") {
    return "requires_approval" as const;
  }
  return "durable_summary" as const;
}

function missingCurrentContextSections(projectHealth?: ProjectHealthForBrief) {
  if ((projectHealth?.stats?.current_context_count ?? 0) > 0) {
    return [];
  }
  return ["current_context"];
}

function repoIndexStatus(projectHealth?: ProjectHealthForBrief) {
  const stats = projectHealth?.stats;
  if (!stats) {
    return "unknown";
  }
  if ((stats.chunk_count ?? 0) === 0 && (stats.document_count ?? 0) > 0) {
    return "documents_without_chunks";
  }
  if ((stats.chunk_count ?? 0) > 0) {
    return "indexed";
  }
  return "empty";
}

function overdueMarkers(input: OperatingBriefInput) {
  const today = input.operationalContext.local_date;
  const markers: string[] = [];
  for (const task of input.tasks) {
    if (task.dueAt && task.dueAt.slice(0, 10) < today && task.status !== "done" && task.status !== "cancelled") {
      markers.push(`Task overdue: ${task.title}`);
    }
  }
  for (const milestone of input.strategyContext.milestones) {
    if (milestone.due_at && milestone.due_at.slice(0, 10) < today && milestone.status !== "completed") {
      markers.push(`Milestone overdue: ${milestone.title ?? milestone.slug ?? milestone.id}`);
    }
  }
  return markers;
}

function summarizeBranchProject(branchProject: BranchProject | null) {
  if (!branchProject) {
    return null;
  }
  return {
    id: branchProject.id,
    project_slug: branchProject.projectSlug,
    parent_initiative_id: branchProject.parentInitiativeId,
    parent_project_slug: branchProject.parentProjectSlug,
    status: branchProject.status,
    timebox_starts_at: branchProject.timeboxStartsAt,
    timebox_ends_at: branchProject.timeboxEndsAt,
    hypothesis: branchProject.hypothesis,
    success_metric: branchProject.successMetric,
    merge_back_condition: branchProject.mergeBackCondition,
    kill_condition: branchProject.killCondition,
    risk_to_parent: branchProject.riskToParent,
    risk_level: branchProject.riskLevel,
  };
}

function contextAmbiguityWarnings(contextResolution: unknown) {
  const resolution = objectOrEmpty(contextResolution);
  const candidates = Array.isArray(resolution.candidates) ? resolution.candidates : [];
  if (candidates.length <= 1) {
    return [];
  }
  const [first, second] = candidates as Array<{ score?: number }>;
  if (Number(first?.score ?? 0) - Number(second?.score ?? 0) <= 5) {
    return ["Project resolution has close candidates; confirm scope before writing durable memory."];
  }
  return [];
}

function objectOrEmpty(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}
