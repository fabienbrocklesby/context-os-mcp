import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { DocumentService } from "~/service/DocumentService";
import type { EntityService } from "~/service/EntityService";
import { entityStateStatusToolSchema, entityTypeToolSchema, savePolicySchema, sensitivitySchema, textResult } from "~/tools/schemas";

export function registerMemoryTools(
  server: McpServer,
  entitySvc: EntityService,
  docSvc: DocumentService,
) {
  server.registerTool(
    "write_session_summary",
    {
      description: "Write a new session summary markdown file into the configured WorkDrive memory structure and enqueue reindexing.",
      inputSchema: z.object({
        project: z.string().optional(),
        title: z.string().min(1),
        markdown: z.string().min(1),
        tags: z.array(z.string()).optional(),
        author_client: z.string().optional(),
      }),
      annotations: { destructiveHint: true, idempotentHint: false },
    },
    async ({ project, title, markdown, tags, author_client }) =>
      textResult(await docSvc.writeSessionSummary({ project, title, markdown, tags, authorClient: author_client })),
  );

  server.registerTool(
    "save_snippet",
    {
      description: "Save a durable snippet or useful excerpt into project memory with source, repo/path, confidence, usefulness, and duplicate protection.",
      inputSchema: z.object({
        project: z.string().optional(),
        title: z.string().min(1),
        markdown: z.string().min(1),
        tags: z.array(z.string()).optional(),
        source: z.string().optional(),
        source_urls: z.array(z.string()).optional(),
        repo: z.string().optional(),
        path: z.string().optional(),
        confidence: z.number().min(0).max(1).optional(),
        usefulness: z.number().min(0).max(1).optional(),
        author_client: z.string().optional(),
      }),
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    async ({ project, title, markdown, tags, source, source_urls, repo, path, confidence, usefulness, author_client }) =>
      textResult(await docSvc.saveSnippet({
        project, title, markdown, tags, source, sourceUrls: source_urls,
        repo, path, confidence, usefulness, authorClient: author_client,
      })),
  );

  server.registerTool(
    "finish_work_session",
    {
      description: "Best final call for AI clients. Writes a session summary and optional decisions, snippets, tasks, source events, and durable facts in one workflow.",
      inputSchema: z.object({
        project: z.string().min(1),
        title: z.string().min(1),
        summary_markdown: z.string().min(1),
        tags: z.array(z.string()).optional(),
        decisions: z.array(z.object({
          title: z.string().min(1),
          markdown: z.string().min(1),
          tags: z.array(z.string()).optional(),
          supersedes_document_ids: z.array(z.string()).optional(),
        })).optional(),
        snippets: z.array(z.object({
          title: z.string().min(1),
          markdown: z.string().min(1),
          tags: z.array(z.string()).optional(),
          source: z.string().optional(),
          source_urls: z.array(z.string()).optional(),
          repo: z.string().optional(),
          path: z.string().optional(),
        })).optional(),
        tasks: z.array(z.object({
          id: z.string().optional(),
          title: z.string().min(1),
          description: z.string().nullable().optional(),
          status: z.enum(["open", "in_progress", "blocked", "done", "cancelled"]).optional(),
          priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
          due_at: z.string().nullable().optional(),
          owner: z.string().nullable().optional(),
          initiative_id: z.string().nullable().optional(),
          entity_id: z.string().nullable().optional(),
          source: z.string().nullable().optional(),
          source_url: z.string().nullable().optional(),
          reminder_at: z.string().nullable().optional(),
          metadata: z.record(z.string(), z.unknown()).optional(),
        })).optional(),
        source_events: z.array(z.object({
          source: z.string().min(1),
          source_id: z.string().nullable().optional(),
          event_type: z.string().min(1),
          occurred_at: z.string().nullable().optional(),
          title: z.string().min(1),
          summary: z.string().min(1),
          sensitivity: sensitivitySchema.optional(),
          save_policy: savePolicySchema.optional(),
          initiative_id: z.string().nullable().optional(),
          entity_id: z.string().nullable().optional(),
          external_url: z.string().nullable().optional(),
          metadata: z.record(z.string(), z.unknown()).optional(),
        })).optional(),
        facts: z.array(z.object({
          title: z.string().min(1),
          body: z.string().min(1),
          fact_key: z.string().nullable().optional(),
          source: z.string().nullable().optional(),
          source_url: z.string().nullable().optional(),
          confidence: z.number().min(0).max(1).nullable().optional(),
          initiative_id: z.string().nullable().optional(),
          entity_id: z.string().nullable().optional(),
          document_id: z.string().nullable().optional(),
          metadata: z.record(z.string(), z.unknown()).optional(),
        })).optional(),
        author_client: z.string().optional(),
      }),
      annotations: { destructiveHint: true, idempotentHint: false },
    },
    async ({ project, title, summary_markdown, tags, decisions, snippets, tasks, source_events, facts, author_client }) =>
      textResult(await docSvc.finishWorkSession({
        project, title, summaryMarkdown: summary_markdown, tags,
        decisions: decisions?.map((d) => ({
          title: d.title, markdown: d.markdown, tags: d.tags,
          supersedesDocumentIds: d.supersedes_document_ids,
        })),
        snippets: snippets?.map((s) => ({
          title: s.title, markdown: s.markdown, tags: s.tags,
          source: s.source, sourceUrls: s.source_urls, repo: s.repo, path: s.path,
        })),
        tasks: tasks?.map((t) => ({
          id: t.id, title: t.title, description: t.description, status: t.status,
          priority: t.priority, dueAt: t.due_at, owner: t.owner,
          initiativeId: t.initiative_id, entityId: t.entity_id,
          source: t.source, sourceUrl: t.source_url, reminderAt: t.reminder_at, metadata: t.metadata,
        })),
        sourceEvents: source_events?.map((e) => ({
          source: e.source, sourceId: e.source_id, eventType: e.event_type,
          occurredAt: e.occurred_at, title: e.title, summary: e.summary,
          sensitivity: e.sensitivity, savePolicy: e.save_policy,
          initiativeId: e.initiative_id, entityId: e.entity_id,
          externalUrl: e.external_url, metadata: e.metadata,
        })),
        facts: facts?.map((f) => ({
          title: f.title, body: f.body, factKey: f.fact_key, source: f.source,
          sourceUrl: f.source_url, confidence: f.confidence,
          initiativeId: f.initiative_id, entityId: f.entity_id,
          documentId: f.document_id, metadata: f.metadata,
        })),
        authorClient: author_client,
      })),
  );

  server.registerTool(
    "update_context_document",
    {
      description: "Create or replace a canonical current-context markdown document. Uses optimistic concurrency via expected_revision and snapshots old content into history before replacing.",
      inputSchema: z.object({
        project: z.string().optional(),
        path: z.string().optional(),
        title: z.string().optional(),
        markdown: z.string().min(1),
        expected_revision: z.number().int().min(0).optional(),
        author_client: z.string().optional(),
      }),
      annotations: { destructiveHint: true, idempotentHint: false },
    },
    async ({ project, path, title, markdown, expected_revision, author_client }) =>
      textResult(await docSvc.updateContextDocument({
        project, path, title, markdown, expectedRevision: expected_revision, authorClient: author_client,
      })),
  );

  server.registerTool(
    "archive_memory_document",
    {
      description: "Admin-only: overwrite an existing WorkDrive Markdown memory document with an archived marker, reindex it inactive, and preserve the original content inside the archived file.",
      inputSchema: z.object({
        document_id: z.string().optional(),
        path: z.string().optional(),
        workdrive_file_id: z.string().optional(),
        archived_to_path: z.string().optional(),
        reason: z.string().min(1),
        author_client: z.string().optional(),
      }),
      annotations: { destructiveHint: true, idempotentHint: false },
    },
    async ({ document_id, path, workdrive_file_id, archived_to_path, reason, author_client }) =>
      textResult(await docSvc.archiveMemoryDocument({
        documentId: document_id, path, workdriveFileId: workdrive_file_id,
        archivedToPath: archived_to_path, reason, authorClient: author_client,
      })),
  );

  server.registerTool(
    "record_decision",
    {
      description: "Write a new decision record into WorkDrive and enqueue reindexing.",
      inputSchema: z.object({
        project: z.string().optional(),
        title: z.string().min(1),
        markdown: z.string().min(1),
        tags: z.array(z.string()).optional(),
        supersedes_document_ids: z.array(z.string()).optional(),
        canonical_key: z.string().optional().describe("Stable topic key (slug). Writing a decision with this key supersedes any prior active document carrying the same key, so current truth replaces stale truth automatically."),
        author_client: z.string().optional(),
      }),
      annotations: { destructiveHint: true, idempotentHint: false },
    },
    async ({ project, title, markdown, tags, supersedes_document_ids, canonical_key, author_client }) =>
      textResult(await docSvc.recordDecision({
        project, title, markdown, tags,
        supersedesDocumentIds: supersedes_document_ids, canonicalKey: canonical_key,
        authorClient: author_client,
      })),
  );

  server.registerTool(
    "upsert_situation",
    {
      description: "Create or update a situational awareness document. Omit project for the cross-initiative shared situation; pass a project slug to author that project's own situation document (read first on every session for that project). Include current financial position, location, top priorities, and key constraints, or supply body_markdown for a free-form situation.",
      inputSchema: z.object({
        project: z.string().optional().describe("Project slug to scope this situation document to. Omit for the cross-initiative shared situation."),
        body_markdown: z.string().optional().describe("Free-form markdown body. When provided, it becomes the situation body verbatim instead of the structured sections."),
        financial_position: z.string().optional().describe("Current financial position, e.g. 'Cash tight, need $X by end of month'"),
        location: z.string().optional().describe("Where you are and where you're going"),
        top_priorities: z.array(z.string()).optional().describe("Your top 3-5 priorities this week across all initiatives"),
        key_constraints: z.array(z.string()).optional().describe("Constraints limiting your options right now"),
        active_initiatives: z.array(z.string()).optional().describe("Which initiatives are actively in play right now"),
        notes: z.string().optional().describe("Any other situational context worth capturing"),
      }),
    },
    async (input) => {
      const result = await docSvc.setSituationDocument(input);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  // Entity state tools

  server.registerTool(
    "upsert_entity_state",
    {
      description: "Create or update a structured current-state record for an entity. Supersedes the prior active value for the same entity/state key without deleting history.",
      inputSchema: z.object({
        project: z.string().optional(),
        entity_id: z.string().optional(),
        entity_type: entityTypeToolSchema.optional(),
        entity_name: z.string().optional(),
        entity_slug: z.string().optional(),
        entity_summary: z.string().nullable().optional(),
        aliases: z.array(z.string()).optional(),
        state_key: z.string().min(1),
        value: z.unknown(),
        confidence: z.number().min(0).max(1).nullable().optional(),
        source: z.string().nullable().optional(),
        source_id: z.string().nullable().optional(),
        source_event_id: z.string().nullable().optional(),
        valid_from: z.string().nullable().optional(),
        valid_until: z.string().nullable().optional(),
        observed_at: z.string().nullable().optional(),
        status: entityStateStatusToolSchema.optional(),
      }),
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    async ({ project, entity_id, entity_type, entity_name, entity_slug, entity_summary, aliases, state_key, value, confidence, source, source_id, source_event_id, valid_from, valid_until, observed_at, status }) =>
      textResult(await entitySvc.upsertEntityState({
        project, entityId: entity_id, entityType: entity_type, entityName: entity_name,
        entitySlug: entity_slug, entitySummary: entity_summary, aliases, stateKey: state_key,
        value, confidence, source, sourceId: source_id, sourceEventId: source_event_id,
        validFrom: valid_from, validUntil: valid_until, observedAt: observed_at, status,
      })),
  );

  server.registerTool(
    "get_entity_current_state",
    {
      description: "Fetch active structured current-state values for an entity by id or query, optionally including superseded history.",
      inputSchema: z.object({
        project: z.string().optional(),
        entity_id: z.string().optional(),
        query: z.string().optional(),
        include_superseded: z.boolean().optional(),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ project, entity_id, query, include_superseded }) =>
      textResult(await entitySvc.getEntityCurrentState({
        project, entityId: entity_id, query, includeSuperseded: include_superseded,
      })),
  );

  server.registerTool(
    "resolve_current_truth",
    {
      description: "Resolve exact entity aliases, active entity states, stale-memory guardrails, and required live checks for a current-state query.",
      inputSchema: z.object({
        project: z.string().optional(),
        query: z.string().min(1),
        include_superseded: z.boolean().optional(),
        limit: z.number().int().min(1).max(50).optional(),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ project, query, include_superseded, limit }) =>
      textResult(await entitySvc.resolveCurrentTruth({
        project, query, includeSuperseded: include_superseded, limit,
      })),
  );

  server.registerTool(
    "set_entity_actionability",
    {
      description: "Set the actionability of an entity state without replacing the full state. Use this when a deal is blocked, waiting, or ready — so planning queries surface only what you can actually act on.",
      inputSchema: z.object({
        project: z.string().describe("Project slug the entity belongs to"),
        entity_slug: z.string().describe("Slug of the entity to update"),
        state_key: z.string().describe("The state key to update, e.g. 'deal_stage', 'project_status'"),
        actionability: z.enum(["active", "ready", "waiting", "blocked", "unknown"]).describe(
          "active: being worked now; ready: can act on it; waiting: waiting on external input; blocked: hard blocker exists; unknown: not assessed",
        ),
        resolve_after: z.string().optional().describe("ISO date after which to re-evaluate"),
        reason: z.string().optional().describe("Why this actionability state"),
      }),
    },
    async ({ project, entity_slug, state_key, actionability, resolve_after, reason }) => {
      const result = await entitySvc.setEntityActionability({
        project, entitySlug: entity_slug, stateKey: state_key,
        actionability, resolveAfter: resolve_after, reason,
      });
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.registerTool(
    "link_memory",
    {
      description: "Create or update a typed relationship between projects, initiatives, entities, documents, tasks, facts, or source events.",
      inputSchema: z.object({
        project: z.string().optional(),
        from_type: z.string().min(1),
        from_id: z.string().min(1),
        to_type: z.string().min(1),
        to_id: z.string().min(1),
        relation: z.string().min(1),
        weight: z.number().min(0).max(10).optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      }),
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    async ({ project, from_type, from_id, to_type, to_id, relation, weight, metadata }) =>
      textResult(await entitySvc.linkMemory({
        project, fromType: from_type, fromId: from_id, toType: to_type,
        toId: to_id, relation, weight, metadata,
      })),
  );

  server.registerTool(
    "save_source_event",
    {
      description: "Save a selective durable summary of an external CRM/email/calendar/notes/GitHub/Shopify/WorkDrive event with source links and privacy policy.",
      inputSchema: z.object({
        project: z.string().optional(),
        source: z.string().min(1),
        source_id: z.string().nullable().optional(),
        event_type: z.string().min(1),
        occurred_at: z.string().nullable().optional(),
        title: z.string().min(1),
        summary: z.string().min(1),
        sensitivity: sensitivitySchema.optional(),
        save_policy: savePolicySchema.optional(),
        initiative_id: z.string().nullable().optional(),
        entity_id: z.string().nullable().optional(),
        external_url: z.string().nullable().optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      }),
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    async ({ project, source, source_id, event_type, occurred_at, title, summary, sensitivity, save_policy, initiative_id, entity_id, external_url, metadata }) =>
      textResult(await entitySvc.saveSourceEvent({
        project, source, sourceId: source_id, eventType: event_type, occurredAt: occurred_at,
        title, summary, sensitivity, savePolicy: save_policy,
        initiativeId: initiative_id, entityId: entity_id, externalUrl: external_url, metadata,
      })),
  );

  server.registerTool(
    "extract_durable_facts",
    {
      description: "Extract durable fact candidates from text and optionally save them as structured facts with source links.",
      inputSchema: z.object({
        project: z.string().optional(),
        text: z.string().min(1),
        title: z.string().optional(),
        fact_key: z.string().optional().describe("Stable topic key. Reusing a key for the same project upserts that fact in place (UNIQUE(project, fact_key)), so a new value replaces the prior one instead of accumulating duplicates."),
        source: z.string().optional(),
        source_url: z.string().optional(),
        confidence: z.number().min(0).max(1).optional(),
        initiative_id: z.string().nullable().optional(),
        entity_id: z.string().nullable().optional(),
        save: z.boolean().optional(),
      }),
      annotations: { destructiveHint: true, idempotentHint: false },
    },
    async ({ project, text, title, fact_key, source, source_url, confidence, initiative_id, entity_id, save }) =>
      textResult(await entitySvc.extractDurableFacts({
        project, text, title, factKey: fact_key, source, sourceUrl: source_url, confidence,
        initiativeId: initiative_id, entityId: entity_id, save,
      })),
  );

  server.registerTool(
    "upsert_task",
    {
      description: "Create or update a durable task/reminder linked to a project, initiative, entity, and optional source.",
      inputSchema: z.object({
        id: z.string().optional(),
        project: z.string().optional(),
        title: z.string().min(1),
        description: z.string().nullable().optional(),
        status: z.enum(["open", "in_progress", "blocked", "done", "cancelled"]).optional(),
        priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
        due_at: z.string().nullable().optional(),
        owner: z.string().nullable().optional(),
        initiative_id: z.string().nullable().optional(),
        entity_id: z.string().nullable().optional(),
        source: z.string().nullable().optional(),
        source_url: z.string().nullable().optional(),
        reminder_at: z.string().nullable().optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      }),
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    async ({ id, project, title, description, status, priority, due_at, owner, initiative_id, entity_id, source, source_url, reminder_at, metadata }) =>
      textResult(await entitySvc.upsertTask({
        id, project, title, description, status, priority, dueAt: due_at, owner,
        initiativeId: initiative_id, entityId: entity_id, source,
        sourceUrl: source_url, reminderAt: reminder_at, metadata,
      })),
  );
}
