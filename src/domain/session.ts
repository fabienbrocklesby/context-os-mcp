import type {
  ContextTask,
  DurableFact,
  MemoryProject,
  ResolvedMemoryDocument,
  SourceEvent,
} from "~/domain/memory";

export const COMPACT_SESSION_MAX_BYTES = 64 * 1024;

export type AssistantSessionResponseMode = "compact" | "expanded";

export const MAX_MANIFEST_DOCUMENTS = 16;

/**
 * Curate the current-context manifest: situation first, then real context/current
 * documents, then non-entity knowledge, with entity-stub docs pushed last. Entity
 * stubs flood the manifest and are reachable via search, so they should not dominate
 * the always-loaded pack.
 */
export function selectCurrentContextManifest(
  documents: ResolvedMemoryDocument[],
  max: number = MAX_MANIFEST_DOCUMENTS,
): ResolvedMemoryDocument[] {
  const rank = (doc: ResolvedMemoryDocument): number => {
    if (doc.memoryLayer === "situation") return 0;
    if (doc.path.includes("/context/current/")) return 1;
    if (doc.path.includes("/knowledge/entities/")) return 4;
    if (doc.memoryLayer === "knowledge") return 2;
    return 3;
  };
  return [...documents]
    .map((doc, index) => ({ doc, index, rank: rank(doc) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .slice(0, max)
    .map((entry) => entry.doc);
}
const MAX_MEMORY_EXCERPTS = 12;
const MAX_TASKS = 12;
const MAX_FACTS = 12;
const MAX_EVENTS = 5;

export function compactProject(project: MemoryProject) {
  return {
    slug: project.slug,
    displayName: project.displayName,
    description: project.description,
    status: project.status,
    shared: project.shared,
    canonicalStatus: project.canonicalStatus ?? null,
  };
}

export function compactContextResolution(resolution: Record<string, unknown>) {
  const activeProject = asRecord(resolution.active_project);
  const candidates = asArray(resolution.candidates).map((candidate) => {
    const item = asRecord(candidate);
    const project = asRecord(item.project);
    return {
      project: pickProjectSummary(project),
      score: item.score,
      reasons: item.reasons,
    };
  });
  return {
    active_project: pickProjectSummary(activeProject),
    candidates: candidates.slice(0, 5),
    candidate_count: candidates.length,
    related_project_hints: resolution.related_project_hints,
    project_switching: resolution.project_switching,
  };
}

export function compactCurrentContextDocuments(documents: ResolvedMemoryDocument[]) {
  return {
    mode: "manifest",
    document_count: documents.length,
    items: selectCurrentContextManifest(documents).map((document) => ({
      id: document.id,
      title: document.title,
      path: document.path,
      project: document.project,
      memory_type: document.memoryType,
      status: document.status,
      canonical: document.canonical,
      active: document.active,
      revision: document.revision,
      tags: document.tags,
    })),
    omitted_item_count: Math.max(0, documents.length - MAX_MANIFEST_DOCUMENTS),
    full_content_included: false,
  };
}

export function compactSearchMemory(memory: unknown) {
  const payload = asRecord(memory);
  const results = asArray(payload.results);
  const diagnostics = asRecord(payload.diagnostics);
  return {
    results: results.slice(0, MAX_MEMORY_EXCERPTS).map((result) => compactSearchResult(asRecord(result))),
    result_count: results.length,
    omitted_result_count: Math.max(0, results.length - MAX_MEMORY_EXCERPTS),
    retrieval_summary: {
      vector_hits: diagnostics.vector_hits ?? null,
      ranked_vector_hits: diagnostics.ranked_vector_hits ?? null,
      keyword_hits: diagnostics.keyword_hits ?? null,
      keyword_fallback_used: diagnostics.keyword_fallback_used ?? false,
      keyword_fallback_due_to_empty_semantic:
        diagnostics.keyword_fallback_due_to_empty_semantic ?? false,
      scope: diagnostics.scope ?? "project",
      searched_projects: diagnostics.searched_projects ?? undefined,
    },
  };
}

export function compactTasks(tasks: ContextTask[]) {
  return tasks.slice(0, MAX_TASKS).map((task) => ({
    id: task.id,
    project: task.project,
    title: task.title,
    description: truncate(task.description, 240),
    status: task.status,
    priority: task.priority,
    dueAt: task.dueAt,
    owner: task.owner,
    source: task.source,
  }));
}

export function compactFacts(facts: DurableFact[]) {
  return facts.slice(0, MAX_FACTS).map((fact) => ({
    id: fact.id,
    project: fact.project,
    title: fact.title,
    body: truncate(fact.body, 240),
    status: fact.status,
    source: fact.source,
    confidence: fact.confidence,
  }));
}

export function compactSourceEvents(events: SourceEvent[]) {
  return events.slice(0, MAX_EVENTS).map((event) => ({
    id: event.id,
    project: event.project,
    source: event.source,
    eventType: event.eventType,
    occurredAt: event.occurredAt,
    title: event.title,
    summary: truncate(event.summary, 300),
    sensitivity: event.sensitivity,
    savePolicy: event.savePolicy,
  }));
}

export function compactInitiativeContext(contexts: unknown[]) {
  return contexts.slice(0, 10).map((context) => {
    const item = asRecord(context);
    const initiative = asRecord(item.initiative);
    return {
      initiative: compactStrategicRecord(initiative),
      projects: asArray(item.projects).slice(0, 8),
      open_tasks: compactUnknownTasks(asArray(item.open_tasks)),
      facts: compactUnknownFacts(asArray(item.facts)),
      source_events: compactUnknownEvents(asArray(item.source_events)),
    };
  });
}

export function compactStrategyContext(strategy: unknown) {
  const payload = asRecord(strategy);
  return {
    project: payload.project,
    visions: asArray(payload.visions).slice(0, 8).map((item) => compactStrategicRecord(asRecord(item))),
    pillars: asArray(payload.pillars).slice(0, 8).map((item) => compactStrategicRecord(asRecord(item))),
    outcomes: asArray(payload.outcomes).slice(0, 8).map((item) => compactStrategicRecord(asRecord(item))),
    initiatives: asArray(payload.initiatives).slice(0, 8).map((item) => compactStrategicRecord(asRecord(item))),
    milestones: asArray(payload.milestones).slice(0, 8).map((item) => compactStrategicRecord(asRecord(item))),
    assets: asArray(payload.assets).slice(0, 8).map((item) => compactAsset(asRecord(item))),
    branch_project: payload.branch_project,
    warnings: payload.warnings,
  };
}

export function compactOperatingBrief(
  brief: unknown,
  taskDetailLocation: "tasks" | "active_tasks" = "tasks",
) {
  const payload = asRecord(brief);
  const taskPayload = asRecord(payload.current_tasks_milestones);
  const freshness = asRecord(payload.source_freshness);
  const strategic = asRecord(payload.strategic_alignment);
  const environmentGuidance = asRecord(payload.environment_tool_guidance);
  return {
    ...payload,
    context_resolution: {
      detail_location: "context_resolution",
    },
    time_actionability: {
      detail_location: "operational_context",
    },
    strategic_alignment: {
      ...strategic,
      visions: compactUnknownStrategic(asArray(strategic.visions)),
      pillars: compactUnknownStrategic(asArray(strategic.pillars)),
      outcomes: compactUnknownStrategic(asArray(strategic.outcomes)),
      initiatives: compactUnknownStrategic(asArray(strategic.initiatives)),
      milestones: compactUnknownStrategic(asArray(strategic.milestones)),
    },
    relevant_assets: asArray(payload.relevant_assets).slice(0, 8).map((asset) => compactAsset(asRecord(asset))),
    current_tasks_milestones: {
      detail_location: taskDetailLocation,
      open_task_count: asArray(taskPayload.open_tasks).length,
      due_or_blocked_task_count: asArray(taskPayload.due_or_blocked_tasks).length,
      high_priority_task_count: asArray(taskPayload.high_priority_tasks).length,
      milestones: compactUnknownStrategic(asArray(taskPayload.milestones)),
      overdue_count: asArray(taskPayload.overdue_markers).length,
    },
    source_freshness: {
      ...freshness,
      diagnostics: compactDiagnostics(freshness.diagnostics),
      last_known_source_event: compactOneSourceEvent(freshness.last_known_source_event),
    },
    environment_tool_guidance: {
      detail_location: "environment_tool_guidance",
      write_back_policy: {
        detail_location: "write_back_policy",
        mode: asRecord(environmentGuidance.write_back_policy).mode,
      },
    },
    write_back_plan: {
      detail_location: "write_back_policy",
      recommendations: asArray(asRecord(payload.write_back_plan).recommendations).map((raw) => {
        const item = asRecord(raw);
        return { tool: item.tool, when: item.when, save_policy: item.save_policy };
      }),
    },
  };
}

export function compactEntities(entities: unknown[]) {
  return entities.slice(0, 8).map((entity) => {
    const item = asRecord(entity);
    return {
      id: item.id,
      project: item.project,
      type: item.type,
      slug: item.slug,
      name: item.name,
      summary: truncate(stringOrNull(item.summary), 240),
      confidence: item.confidence,
    };
  });
}

export function compactEnvironmentToolGuidance(guidance: unknown) {
  const payload = asRecord(guidance);
  return {
    environment: payload.environment,
    available_capabilities: asArray(payload.available_capabilities).map((raw) => {
      const item = asRecord(raw);
      return {
        capability: item.capability,
        source_kind: item.source_kind,
        tool_name: item.tool_name,
        save_policy: item.save_policy,
        source_of_truth: item.source_of_truth,
        volatile: item.volatile,
      };
    }),
    relevant_capabilities: asArray(payload.relevant_capabilities),
    unavailable_required_capabilities: asArray(payload.unavailable_required_capabilities),
    required_live_checks: asArray(payload.required_live_checks),
    live_checks_to_perform: asArray(payload.live_checks_to_perform),
    contextos_can_execute: payload.contextos_can_execute,
    client_must_execute: payload.client_must_execute,
    client_instructions: asArray(payload.client_instructions).map((item) =>
      truncate(stringOrNull(item), 180)),
    confirmation_required: payload.confirmation_required,
    unavailable_tool_warnings: payload.unavailable_tool_warnings,
    fallback_plan: asArray(payload.fallback_plan).map((item) => truncate(stringOrNull(item), 180)),
    write_back_policy: {
      detail_location: "write_back_policy",
      mode: asRecord(payload.write_back_policy).mode,
    },
  };
}

export function compactToolPlan(plan: unknown) {
  const payload = asRecord(plan);
  return {
    required_tools: asArray(payload.required_tools),
    optional_tools: asArray(payload.optional_tools),
    forbidden_without_confirmation: asArray(payload.forbidden_without_confirmation),
    write_back_recommendations: asArray(payload.write_back_recommendations).map((raw) => {
      const item = asRecord(raw);
      return { tool: item.tool, when: item.when };
    }),
    connector_policy_defaults: {
      detail_location: "write_back_policy",
    },
  };
}

export function compactWriteBackPolicy(policy: unknown) {
  const item = asRecord(policy);
  return {
    mode: item.mode,
    rules: item.rules,
  };
}

export function compactLiveCheckRecommendations(checks: unknown[]) {
  return checks.map((check) => truncate(stringOrNull(check), 180));
}

export function compactRepoCoverage(
  coverage: { complete?: boolean; missing?: string[] } | null | undefined,
): { complete: boolean; missing: string[] } {
  return {
    complete: Boolean(coverage?.complete),
    missing: coverage?.missing ?? [],
  };
}

export function retrievalGuidance() {
  return {
    message:
      "This session pack is intentionally compact. Retrieve only relevant source material before detailed claims or drafting.",
    tools: ["search_memory", "resolve_current_truth", "get_current_context", "fetch"],
    expanded_session_opt_in: { response_mode: "expanded" as const },
  };
}

type CompactPayloadBudget = {
  max_bytes: number;
  serialized_bytes: number;
  trimmed: boolean;
};

export function enforceCompactSessionBudget<T extends Record<string, unknown>>(session: T): T & {
  payload_budget: CompactPayloadBudget;
} {
  let result: Record<string, unknown> = {
    ...session,
    payload_budget: {
      max_bytes: COMPACT_SESSION_MAX_BYTES,
      serialized_bytes: 0,
      trimmed: false,
    },
  };
  const trimmers: Array<() => void> = [
    () => trimArray(result, "facts", 4),
    () => trimArray(result, "source_events", 3),
    () => trimArray(result, "tasks", 5),
    () => trimArray(result, "active_tasks", 5),
    () => trimNestedArray(result, "grouped_memory", "results", 5),
    () => trimNestedArray(result, "current_context", "items", 36),
    () => trimNestedArray(result, "grouped_memory", "results", 3),
    () => trimNestedArray(result, "current_context", "items", 16),
    () => trimArray(result, "initiative_context", 2),
  ];

  let size = updateSize(result, false);
  for (const trim of trimmers) {
    if (size <= COMPACT_SESSION_MAX_BYTES) {
      break;
    }
    trim();
    size = updateSize(result, true);
  }

  if (size > COMPACT_SESSION_MAX_BYTES) {
    result = essentialSessionPayload(result);
    size = updateSize(result, true);
  }

  return result as T & { payload_budget: CompactPayloadBudget };
}

function essentialSessionPayload(payload: Record<string, unknown>) {
  const result: Record<string, unknown> = {
    ...payload,
    tasks: Array.isArray(payload.tasks) ? [] : payload.tasks,
    active_tasks: Array.isArray(payload.active_tasks) ? [] : payload.active_tasks,
    facts: Array.isArray(payload.facts) ? [] : payload.facts,
    source_events: Array.isArray(payload.source_events) ? [] : payload.source_events,
    initiative_context: Array.isArray(payload.initiative_context) ? [] : payload.initiative_context,
    related_projects: Array.isArray(payload.related_projects) ? [] : payload.related_projects,
    relevant_assets: Array.isArray(payload.relevant_assets) ? [] : payload.relevant_assets,
    payload_budget: {
      max_bytes: COMPACT_SESSION_MAX_BYTES,
      serialized_bytes: 0,
      trimmed: true,
    },
  };
  if (payload.current_context) {
    result.current_context = {
      ...asRecord(payload.current_context),
      items: [],
      omitted_for_budget: true,
    };
  }
  if (payload.grouped_memory) {
    result.grouped_memory = {
      ...asRecord(payload.grouped_memory),
      results: [],
      omitted_for_budget: true,
    };
  }
  return result;
}

function compactSearchResult(result: Record<string, unknown>) {
  return {
    id: result.id,
    title: result.title,
    path: result.path,
    url: result.url,
    text: truncate(stringOrNull(result.text), 300),
    score: result.score,
    memory_type: result.memory_type,
    status: result.status,
    project: result.project,
    repo: result.repo,
    repo_path: result.repo_path,
    source: result.source,
    tags: result.tags,
    heading_path: result.heading_path,
    evidence_grade: result.evidence_grade,
    current_truth_warning: result.current_truth_warning,
  };
}

function compactUnknownTasks(tasks: unknown[]) {
  return tasks.slice(0, MAX_TASKS).map((task) => {
    const item = asRecord(task);
    return {
      id: item.id,
      project: item.project,
      title: item.title,
      description: truncate(stringOrNull(item.description), 160),
      status: item.status,
      priority: item.priority,
      dueAt: item.dueAt,
    };
  });
}

function compactUnknownFacts(facts: unknown[]) {
  return facts.slice(0, MAX_FACTS).map((fact) => {
    const item = asRecord(fact);
    return {
      id: item.id,
      title: item.title,
      body: truncate(stringOrNull(item.body), 160),
      confidence: item.confidence,
    };
  });
}

function compactUnknownEvents(events: unknown[]) {
  return events.slice(0, MAX_EVENTS).map((event) => compactOneSourceEvent(event));
}

function compactOneSourceEvent(event: unknown) {
  if (!event) {
    return null;
  }
  const item = asRecord(event);
  return {
    id: item.id,
    source: item.source,
    eventType: item.eventType,
    occurredAt: item.occurredAt,
    title: item.title,
    summary: truncate(stringOrNull(item.summary), 200),
  };
}

function compactUnknownStrategic(items: unknown[]) {
  return items.slice(0, 8).map((item) => compactStrategicRecord(asRecord(item)));
}

function compactStrategicRecord(item: Record<string, unknown>) {
  return {
    id: item.id,
    slug: item.slug,
    title: item.title,
    summary: truncate(stringOrNull(item.summary), 240),
    status: item.status,
    priority: item.priority,
    dueAt: item.dueAt ?? item.due_at,
  };
}

function compactAsset(item: Record<string, unknown>) {
  return {
    id: item.id,
    slug: item.slug,
    name: item.name,
    type: item.type,
    status: item.status,
    source: item.source,
    source_url: item.source_url,
    live_source_kind: item.live_source_kind,
    how_to_use: truncate(stringOrNull(item.how_to_use), 180),
    limitations: truncate(stringOrNull(item.limitations), 180),
  };
}

function compactDiagnostics(diagnostics: unknown) {
  const item = asRecord(diagnostics);
  return Object.keys(item).length
    ? {
        vector_hits: item.vector_hits ?? null,
        ranked_vector_hits: item.ranked_vector_hits ?? null,
        keyword_hits: item.keyword_hits ?? null,
        vector_error: item.vector_error ?? null,
        keyword_fallback_used: item.keyword_fallback_used ?? false,
        keyword_fallback_due_to_empty_semantic:
          item.keyword_fallback_due_to_empty_semantic ?? false,
      }
    : null;
}

function pickProjectSummary(project: Record<string, unknown>) {
  return {
    slug: project.slug,
    displayName: project.displayName,
    description: truncate(stringOrNull(project.description), 240),
    status: project.status,
    shared: project.shared,
    canonicalStatus: project.canonicalStatus ?? null,
  };
}

function trimArray(payload: Record<string, unknown>, key: string, limit: number) {
  if (Array.isArray(payload[key])) {
    payload[key] = payload[key].slice(0, limit);
    markTrimmed(payload);
  }
}

function trimNestedArray(payload: Record<string, unknown>, key: string, arrayKey: string, limit: number) {
  const nested = asRecord(payload[key]);
  if (Array.isArray(nested[arrayKey])) {
    payload[key] = { ...nested, [arrayKey]: nested[arrayKey].slice(0, limit) };
    markTrimmed(payload);
  }
}

function markTrimmed(payload: Record<string, unknown>) {
  const budget = asRecord(payload.payload_budget);
  payload.payload_budget = { ...budget, trimmed: true };
}

function updateSize(payload: Record<string, unknown>, trimmed: boolean) {
  const budget = asRecord(payload.payload_budget);
  payload.payload_budget = { ...budget, trimmed: Boolean(budget.trimmed) || trimmed, serialized_bytes: 0 };
  let size = serializedBytes(payload);
  payload.payload_budget = { ...asRecord(payload.payload_budget), serialized_bytes: size };
  size = serializedBytes(payload);
  payload.payload_budget = { ...asRecord(payload.payload_budget), serialized_bytes: size };
  return serializedBytes(payload);
}

function serializedBytes(payload: unknown) {
  return new TextEncoder().encode(JSON.stringify(payload, null, 2)).byteLength;
}

function truncate(value: string | null, maxLength: number) {
  if (!value || value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 3)}...`;
}

function stringOrNull(value: unknown) {
  return typeof value === "string" ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
