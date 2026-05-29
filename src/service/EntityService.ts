// src/service/EntityService.ts
// Entity-related service methods extracted from MemoryService.

import {
  normalizeProject,
  slugify,
  type ContextTask,
  type EntityAlias,
  type EntityState,
  type EntityType,
  type MemoryPrincipal,
  type SourceEvent,
} from "~/domain/memory";
import type { EntityRepository } from "~/persistence/d1/EntityRepository";
import type { ProjectRepository } from "~/persistence/d1/ProjectRepository";

export class EntityService {
  constructor(
    private readonly env: Env,
    private readonly principal: MemoryPrincipal,
    private readonly entityRepo: EntityRepository,
    private readonly projectRepo: ProjectRepository,
  ) {}

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private async ensureProject(input: { project: string }) {
    const { project } = input;
    const existing = await this.projectRepo.getProject(project);
    if (existing) {
      return existing;
    }
    return this.projectRepo.upsertProject({
      slug: project,
      displayName: titleFromSlug(project),
      description: null,
      status: "active",
      ownerLogin: this.principal.login,
      shared: project === "shared",
    });
  }

  // ---------------------------------------------------------------------------
  // Public methods
  // ---------------------------------------------------------------------------

  async upsertTask(input: {
    id?: string;
    project?: string;
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
    const project = normalizeProject(input.project);
    await this.ensureProject({ project });
    return {
      task: await this.entityRepo.upsertTask({
        ...input,
        project,
      }),
    };
  }

  async saveSourceEvent(input: {
    project?: string;
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
    const project = normalizeProject(input.project);
    await this.ensureProject({ project });
    const policy = connectorPolicyFor(input.source);
    const savePolicy = input.savePolicy ?? policy.save_policy;
    if (savePolicy === "live_only") {
      return {
        saved: false,
        reason: "Connector policy is live_only; no durable source event was written.",
        policy,
      };
    }
    return {
      saved: true,
      policy,
      source_event: await this.entityRepo.saveSourceEvent({
        ...input,
        project,
        savePolicy,
      }),
    };
  }

  async extractDurableFacts(input: {
    project?: string;
    text: string;
    title?: string;
    source?: string;
    sourceUrl?: string;
    confidence?: number;
    initiativeId?: string | null;
    entityId?: string | null;
    save?: boolean;
  }) {
    const project = normalizeProject(input.project);
    const extracted = extractFactCandidates(input.text).map((body, index) => ({
      title: input.title ?? `Extracted fact ${index + 1}`,
      body,
      factKey: slugify(`${input.source ?? "manual"}-${body}`).slice(0, 140),
      source: input.source,
      sourceUrl: input.sourceUrl,
      confidence: input.confidence ?? 0.65,
      initiativeId: input.initiativeId,
      entityId: input.entityId,
    }));
    if (!input.save) {
      return { project, facts: extracted, saved: [] };
    }
    await this.ensureProject({ project });
    const saved = [];
    for (const fact of extracted) {
      saved.push(
        await this.entityRepo.upsertFact({
          ...fact,
          project,
        }),
      );
    }
    return { project, facts: extracted, saved };
  }

  async upsertEntityState(input: {
    project?: string;
    entityId?: string;
    entityType?: EntityType;
    entityName?: string;
    entitySlug?: string;
    entitySummary?: string | null;
    aliases?: string[];
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
  }) {
    const project = normalizeProject(input.project);
    await this.ensureProject({ project });
    let entity = input.entityId ? await this.entityRepo.getEntity(input.entityId) : null;
    if (!entity) {
      if (!input.entityName) {
        throw new Error("entity_name is required when entity_id is not provided.");
      }
      entity = await this.entityRepo.upsertEntity({
        project,
        type: input.entityType ?? "other",
        slug: input.entitySlug ? slugify(input.entitySlug) : slugify(input.entityName),
        name: input.entityName,
        summary: input.entitySummary,
        source: input.source,
        sourceId: input.sourceId,
        confidence: input.confidence,
      });
    }
    if (!entity) {
      throw new Error("Unable to resolve or create entity for state write.");
    }
    const aliases = await this.entityRepo.upsertEntityAliases({
      project,
      entityId: entity.id,
      aliases: [entity.name, ...(input.aliases ?? [])],
      source: input.source ?? "manual",
      confidence: input.confidence ?? entity.confidence,
    });
    const state = await this.entityRepo.upsertEntityState({
      project,
      entityId: entity.id,
      stateKey: normalizeStateKey(input.stateKey),
      value: input.value,
      confidence: input.confidence,
      source: input.source,
      sourceId: input.sourceId,
      sourceEventId: input.sourceEventId,
      validFrom: input.validFrom,
      validUntil: input.validUntil,
      observedAt: input.observedAt,
      status: input.status,
    });
    return { project, entity, aliases, state };
  }

  async setEntityActionability(input: {
    project: string;
    entitySlug: string;
    stateKey: string;
    actionability: "active" | "ready" | "waiting" | "blocked" | "unknown";
    resolveAfter?: string;
    reason?: string;
  }) {
    const project = normalizeProject(input.project);
    const entity = await this.entityRepo.getEntityBySlug(project, input.entitySlug);
    if (!entity) {
      throw new Error(`Entity not found: ${input.entitySlug} in project ${project}`);
    }

    await this.entityRepo.updateEntityStateActionability({
      project,
      entityId: entity.id,
      stateKey: input.stateKey,
      actionability: input.actionability,
      resolveAfter: input.resolveAfter ?? null,
      updatedAt: new Date().toISOString(),
    });

    return {
      entity_slug: input.entitySlug,
      state_key: input.stateKey,
      actionability: input.actionability,
      resolve_after: input.resolveAfter ?? null,
      reason: input.reason ?? null,
    };
  }

  async getEntityCurrentState(input: {
    project?: string;
    entityId?: string;
    query?: string;
    includeSuperseded?: boolean;
  }) {
    const project = normalizeProject(input.project);
    const entities = input.entityId
      ? [await this.entityRepo.getEntity(input.entityId)].filter(isPresent)
      : await this.resolveCurrentTruthEntities(project, input.query ?? "");
    const states = await this.entityRepo.listEntityStatesForEntities({
      project,
      entityIds: entities.map((entity) => entity.id),
      includeSuperseded: input.includeSuperseded,
    });
    const primary = entities[0] ?? null;
    return {
      project,
      entity: primary,
      entities: entities.map((entity) => ({
        entity,
        states: statesByKey(states.filter((state) => state.entityId === entity.id)),
      })),
      states: primary ? statesByKey(states.filter((state) => state.entityId === primary.id)) : {},
    };
  }

  async resolveCurrentTruth(input: {
    project?: string;
    query: string;
    includeSuperseded?: boolean;
    limit?: number;
  }) {
    const project = normalizeProject(input.project);
    const currentStateRequired = isCurrentStateQuery(input.query);
    const aliasMatches = await this.entityRepo.searchEntityAliases({
      project,
      query: input.query,
      limit: input.limit ?? 12,
    });
    const entities = dedupeEntities([
      ...aliasMatches.map((alias) => alias.entity).filter(isPresent),
      ...(aliasMatches.length
        ? []
        : await this.entityRepo.searchEntities({ project, query: input.query, limit: input.limit ?? 12 })),
    ]);
    const states = await this.entityRepo.listEntityStatesForEntities({
      project,
      entityIds: entities.map((entity) => entity.id),
      includeSuperseded: input.includeSuperseded,
    });
    const entityPayloads = entities.map((entity) => {
      const entityStates = states.filter((state) => state.entityId === entity.id);
      return {
        entity,
        matched_aliases: aliasMatches.filter((alias) => alias.entityId === entity.id),
        evidence_grade: entityStates.some((state) => state.status === "active")
          ? "current_structured"
          : "unknown",
        states: statesByKey(entityStates),
      };
    });
    const warnings = buildCurrentTruthWarnings({
      query: input.query,
      currentStateRequired,
      entities,
      states,
    });
    return {
      project,
      query: input.query,
      guardrails: {
        current_state_required: currentStateRequired,
        exact_entity_match: aliasMatches.length > 0,
        semantic_memory_may_be_stale: currentStateRequired,
      },
      matched_aliases: aliasMatches,
      entities: entityPayloads,
      warnings,
      required_live_checks:
        currentStateRequired && (warnings.length > 0 || entityPayloads.length === 0)
          ? currentTruthLiveChecks(input.query)
          : [],
    };
  }

  async linkMemory(input: {
    project?: string;
    fromType: string;
    fromId: string;
    toType: string;
    toId: string;
    relation: string;
    weight?: number;
    metadata?: Record<string, unknown>;
  }) {
    const project = normalizeProject(input.project);
    return {
      links: await this.entityRepo.linkMemory({
        ...input,
        project,
      }),
    };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async resolveCurrentTruthEntities(project: string, query: string) {
    const aliases = await this.entityRepo.searchEntityAliases({ project, query, limit: 12 });
    if (aliases.length > 0) {
      return dedupeEntities(
        aliases
          .map((alias) => alias.entity)
          .filter((entity): entity is NonNullable<EntityAlias["entity"]> => Boolean(entity)),
      );
    }
    return this.entityRepo.searchEntities({ project, query, limit: 12 });
  }
}

// ---------------------------------------------------------------------------
// Module-level helpers (copied from service.ts)
// ---------------------------------------------------------------------------

function normalizeStateKey(value: string) {
  return slugify(value).replace(/-/g, "_");
}

function dedupeEntities<T extends { id: string }>(entities: T[]) {
  const seen = new Set<string>();
  return entities.filter((entity) => {
    if (seen.has(entity.id)) {
      return false;
    }
    seen.add(entity.id);
    return true;
  });
}

function isPresent<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

function statesByKey(states: EntityState[]) {
  return Object.fromEntries(
    states.map((state) => [
      state.stateKey,
      {
        id: state.id,
        value: state.value,
        status: state.status,
        confidence: state.confidence,
        source: state.source,
        source_id: state.sourceId,
        source_event_id: state.sourceEventId,
        observed_at: state.observedAt,
        valid_from: state.validFrom,
        valid_until: state.validUntil,
        updated_at: state.updatedAt,
      },
    ]),
  );
}

function isCurrentStateQuery(query: string) {
  const normalized = query.toLowerCase();
  return [
    "current",
    "latest",
    "today",
    "now",
    "quick",
    "money",
    "deal",
    "opportunity",
    "pipeline",
    "status",
    "stage",
    "blocker",
    "next action",
    "replying",
    "responding",
    "close",
    "priority",
    "left",
    "joined",
  ].some((keyword) => normalized.includes(keyword));
}

function buildCurrentTruthWarnings(input: {
  query: string;
  currentStateRequired: boolean;
  entities: Array<{ id: string; name: string }>;
  states: EntityState[];
}) {
  if (!input.currentStateRequired) {
    return [];
  }
  if (input.entities.length === 0) {
    return [
      "No exact entity alias or structured entity matched this current-state query; check live sources before making recommendations.",
    ];
  }
  const statesByEntity = new Map<string, EntityState[]>();
  for (const state of input.states) {
    statesByEntity.set(state.entityId, [...(statesByEntity.get(state.entityId) ?? []), state]);
  }
  return input.entities
    .filter(
      (entity) =>
        (statesByEntity.get(entity.id) ?? []).filter((state) => state.status === "active").length === 0,
    )
    .map(
      (entity) =>
        `No active current-state records were found for ${entity.name}; treat semantic memory as historical until live sources are checked.`,
    );
}

function currentTruthLiveChecks(query: string) {
  const reason = `Current-state query needs live verification before recommendations: ${query}`;
  return [
    {
      source_kind: "zoho_crm",
      timing: "before_recommendation",
      required: true,
      reason,
    },
    {
      source_kind: "zoho_mail",
      timing: "before_recommendation",
      required: true,
      reason,
    },
  ];
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

function connectorPolicyFor(source: string) {
  const key = source.toLowerCase().replace(/[-\s]+/g, "_");
  const policies: Record<
    string,
    {
      save_policy: "durable_summary" | "live_only" | "requires_approval";
      durable: string[];
      requires_approval: string[];
      live_only: string[];
    }
  > = {
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
  return (
    policies[key] ?? {
      save_policy: "requires_approval" as const,
      durable: ["durable summary with source link"],
      requires_approval: ["raw source content"],
      live_only: ["unknown connector payloads"],
    }
  );
}

function extractFactCandidates(text: string) {
  const candidates = text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length >= 20)
    .filter((line) =>
      /\b(decision|decided|must|should|deadline|due|blocked|goal|customer|account|deal|owner|priority|constraint|launched|changed|agreed)\b/i.test(
        line,
      ),
    )
    .slice(0, 8);
  return candidates.length ? candidates : [truncate(text.trim(), 500)].filter(Boolean);
}

function truncate(text: string, maxLength: number) {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 1)}…`;
}
