// src/persistence/d1/EntityRepository.ts
// Entity-related persistence methods extracted from MemoryRepository.

import type {
  ContextTask,
  DurableFact,
  EntityAlias,
  EntityState,
  MemoryEntity,
  MemoryLink,
  SourceEvent,
} from "~/domain/memory";
import type {
  EntityAliasRow,
  EntityRow,
  EntityStateRow,
  FactRow,
  MemoryLinkRow,
  SourceEventRow,
  TaskRow,
} from "~/persistence/d1/types";

export class EntityRepository {
  constructor(private readonly db: D1Database) {}

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

  async listTasks(
    input: {
      project?: string;
      initiativeId?: string;
      entityId?: string;
      includeDone?: boolean;
      dueBefore?: string;
      limit?: number;
    } = {},
  ) {
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

  async listFacts(
    input: { project?: string; initiativeId?: string; entityId?: string; limit?: number } = {},
  ) {
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

  async listLinks(
    input: {
      project?: string;
      fromType?: string;
      fromId?: string;
      toType?: string;
      toId?: string;
    } = {},
  ) {
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

  async getEntityBySlug(project: string, slug: string): Promise<MemoryEntity | null> {
    return mapEntity(
      await this.db
        .prepare("SELECT * FROM memory_entities WHERE project = ? AND slug = ?")
        .bind(project, slug)
        .first<EntityRow>(),
    );
  }

  async updateEntityStateActionability(input: {
    project: string;
    entityId: string;
    stateKey: string;
    actionability: string;
    resolveAfter: string | null;
    updatedAt: string;
  }): Promise<void> {
    await this.db
      .prepare(
        `UPDATE entity_states
         SET actionability = ?, resolve_after = ?, updated_at = ?
         WHERE project = ? AND entity_id = ? AND state_key = ? AND status = 'active'`,
      )
      .bind(
        input.actionability,
        input.resolveAfter,
        input.updatedAt,
        input.project,
        input.entityId,
        input.stateKey,
      )
      .run();
  }

  async listEntitiesForWikiLinks(
    project: string,
  ): Promise<Array<{ name: string; slug: string; type: string }>> {
    const rows = await this.db
      .prepare(
        "SELECT name, slug, type FROM memory_entities WHERE project = ? ORDER BY name ASC",
      )
      .bind(project)
      .all<{ name: string; slug: string; type: string }>();
    return rows.results;
  }
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
