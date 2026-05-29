import YAML from "yaml";
import type { ContextTask, DurableFact, MemoryEntity, MemoryInitiative, SourceEvent } from "~/domain/memory";
import { slugify } from "~/domain/memory";

type StateValues = Record<string, { value: unknown; updated_at?: string | null }>;

export function buildEntityVaultMarkdown(entity: MemoryEntity, states: StateValues): string {
  const subfolder = entity.type === "person" ? "people" : "companies";
  const frontmatter = {
    id: entity.id,
    title: entity.name,
    project: entity.project,
    memory_type: "current_context",
    status: "active",
    revision: 1,
    canonical: true,
    memory_layer: "knowledge",
    entity_type: entity.type,
    entity_slug: entity.slug,
    entity_subfolder: subfolder,
    tags: ["entity", entity.type, `project/${entity.project}`],
    created_at: entity.createdAt,
    updated_at: entity.updatedAt,
    author_client: "context-os",
    source_urls: [],
  };

  const stateRows = Object.entries(states)
    .map(([key, s]) => `| ${key} | ${formatStateValue(s.value)} | ${s.updated_at?.slice(0, 10) ?? "—"} |`)
    .join("\n");

  const stateTable = stateRows
    ? `## Current State\n\n| State Key | Value | Last Updated |\n|-----------|-------|-------------|\n${stateRows}`
    : `## Current State\n\n_No state records yet._`;

  const summary = entity.summary ? `\n${entity.summary}\n` : "";

  const body = [
    `# ${entity.name}`,
    "",
    `**Type:** ${entity.type}${entity.source ? ` | **Source:** ${entity.source}` : ""}`,
    "",
    summary,
    stateTable,
    "",
    "## Related Sessions",
    "",
    "_Sessions that mention this entity will appear here after reindex._",
  ].join("\n");

  return `---\n${YAML.stringify(frontmatter).trimEnd()}\n---\n\n${body.trim()}\n`;
}

export function buildFactVaultMarkdown(fact: DurableFact): string {
  const frontmatter = {
    id: fact.id,
    title: fact.title,
    project: fact.project,
    memory_type: "decision",
    status: fact.status === "active" ? "active" : "historical",
    revision: 1,
    canonical: true,
    memory_layer: "knowledge",
    fact_key: fact.factKey ?? null,
    confidence: fact.confidence ?? null,
    tags: ["fact", `project/${fact.project}`],
    created_at: fact.createdAt,
    updated_at: fact.updatedAt,
    author_client: "context-os",
    source_urls: fact.sourceUrl ? [fact.sourceUrl] : [],
  };

  const body = [
    `# ${fact.title}`,
    "",
    fact.body,
    "",
    fact.source ? `**Source:** ${fact.source}` : "",
    fact.confidence != null ? `**Confidence:** ${fact.confidence}` : "",
  ]
    .filter((line) => line !== "")
    .join("\n");

  return `---\n${YAML.stringify(frontmatter).trimEnd()}\n---\n\n${body.trim()}\n`;
}

export function buildTaskVaultMarkdown(task: ContextTask): string {
  const frontmatter = {
    id: task.id,
    title: task.title,
    project: task.project,
    memory_type: "current_context",
    status: task.status === "open" || task.status === "in_progress" ? "active" : "historical",
    revision: 1,
    canonical: false,
    memory_layer: "operational",
    task_status: task.status,
    task_priority: task.priority,
    task_due: task.dueAt ?? null,
    task_owner: task.owner ?? null,
    tags: ["task", task.priority ?? "normal", `project/${task.project}`],
    created_at: task.createdAt,
    updated_at: task.updatedAt,
    author_client: "context-os",
    source_urls: task.sourceUrl ? [task.sourceUrl] : [],
  };

  const meta = [
    `**Status:** ${task.status}`,
    `**Priority:** ${task.priority ?? "normal"}`,
    task.dueAt ? `**Due:** ${task.dueAt.slice(0, 10)}` : null,
    task.owner ? `**Owner:** ${task.owner}` : null,
  ]
    .filter(Boolean)
    .join(" | ");

  const body = [
    `# ${task.title}`,
    "",
    meta,
    "",
    task.description ?? "",
  ]
    .filter((line) => line !== "")
    .join("\n");

  return `---\n${YAML.stringify(frontmatter).trimEnd()}\n---\n\n${body.trim()}\n`;
}

export function buildEventVaultMarkdown(event: SourceEvent): string {
  const frontmatter = {
    id: event.id,
    title: event.title,
    project: event.project,
    memory_type: "historical_note",
    status: "historical",
    revision: 1,
    canonical: false,
    memory_layer: "operational",
    event_type: event.eventType,
    occurred_at: event.occurredAt ?? null,
    source: event.source,
    sensitivity: event.sensitivity,
    tags: ["event", slugify(event.eventType), `project/${event.project}`],
    created_at: event.createdAt,
    updated_at: event.updatedAt,
    author_client: "context-os",
    source_urls: event.externalUrl ? [event.externalUrl] : [],
  };

  const meta = [
    `**Type:** ${event.eventType}`,
    `**Source:** ${event.source}`,
    event.occurredAt ? `**Date:** ${event.occurredAt.slice(0, 10)}` : null,
  ]
    .filter(Boolean)
    .join(" | ");

  const body = [`# ${event.title}`, "", meta, "", event.summary].join("\n");

  return `---\n${YAML.stringify(frontmatter).trimEnd()}\n---\n\n${body.trim()}\n`;
}

export function buildInitiativeVaultMarkdown(
  initiative: Pick<MemoryInitiative, "id" | "slug" | "title" | "summary" | "status" | "createdAt" | "updatedAt">,
  entityNames: string[],
): string {
  const frontmatter = {
    id: initiative.id,
    title: initiative.title,
    project: "shared",
    memory_type: "current_context",
    status: "active",
    revision: 1,
    canonical: true,
    memory_layer: "situation",
    initiative_slug: initiative.slug,
    tags: ["initiative", initiative.slug],
    created_at: initiative.createdAt,
    updated_at: initiative.updatedAt,
    author_client: "context-os",
    source_urls: [],
  };

  const entityLinks = entityNames
    .map((name) => `- [[${name}]]`)
    .join("\n");

  const body = [
    `# ${initiative.title}`,
    "",
    initiative.summary ?? "",
    "",
    "## Key Entities",
    "",
    entityLinks || "_No entities yet._",
  ].join("\n");

  return `---\n${YAML.stringify(frontmatter).trimEnd()}\n---\n\n${body.trim()}\n`;
}

export function vaultSlugForTask(title: string, id: string): string {
  return `${slugify(title)}-${id.slice(0, 8)}`;
}

function formatStateValue(value: unknown): string {
  if (typeof value === "string") {
    return value.length > 120 ? `${value.slice(0, 117)}…` : value;
  }
  return JSON.stringify(value);
}
