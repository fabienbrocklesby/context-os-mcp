import type {
  ContextTask,
  DurableFact,
  MemoryProject,
  ResolvedMemoryDocument,
  SourceEvent,
} from "~/domain/memory";

export const COMPACT_SESSION_MAX_BYTES = 64 * 1024;

export type AssistantSessionResponseMode = "compact" | "expanded";

const MAX_MANIFEST_DOCUMENTS = 72;
const MAX_MEMORY_EXCERPTS = 12;
const MAX_TASKS = 12;
const MAX_FACTS = 12;
const MAX_EVENTS = 10;

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
    items: documents.slice(0, MAX_MANIFEST_DOCUMENTS).map((document) => ({
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

export function compactOperatingBrief(brief: unknown) {
  const payload = asRecord(brief);
  const taskPayload = asRecord(payload.current_tasks_milestones);
  const freshness = asRecord(payload.source_freshness);
  const strategic = asRecord(payload.strategic_alignment);
  return {
    ...payload,
    context_resolution: compactContextResolution(asRecord(payload.context_resolution)),
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
      open_tasks: compactUnknownTasks(asArray(taskPayload.open_tasks)),
      due_or_blocked_tasks: compactUnknownTasks(asArray(taskPayload.due_or_blocked_tasks)),
      high_priority_tasks: compactUnknownTasks(asArray(taskPayload.high_priority_tasks)),
      milestones: compactUnknownStrategic(asArray(taskPayload.milestones)),
      overdue_markers: taskPayload.overdue_markers,
    },
    source_freshness: {
      ...freshness,
      diagnostics: compactDiagnostics(freshness.diagnostics),
      last_known_source_event: compactOneSourceEvent(freshness.last_known_source_event),
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
  return new TextEncoder().encode(JSON.stringify(payload)).byteLength;
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
