import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { MemoryService } from "~/domain/service";
import type { DocumentService } from "~/service/DocumentService";
import { textResult } from "~/tools/schemas";

export function registerAdminTools(
  server: McpServer,
  docSvc: DocumentService,
  legacySvc: MemoryService,
) {
  server.registerTool(
    "reindex_document",
    {
      description: "Enqueue a single document for reindexing into Vectorize and D1.",
      inputSchema: z.object({
        document_id: z.string().optional(),
        path: z.string().optional(),
        workdrive_file_id: z.string().optional(),
      }),
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    async ({ document_id, path, workdrive_file_id }) =>
      textResult(await docSvc.reindexDocument({ documentId: document_id, path, workdriveFileId: workdrive_file_id })),
  );

  server.registerTool(
    "admin_reindex_document",
    {
      description: "Admin alias for reindex_document. Enqueue a single document for reindexing into Vectorize and D1.",
      inputSchema: z.object({
        document_id: z.string().optional(),
        path: z.string().optional(),
        workdrive_file_id: z.string().optional(),
      }),
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    async ({ document_id, path, workdrive_file_id }) =>
      textResult(await docSvc.reindexDocument({ documentId: document_id, path, workdriveFileId: workdrive_file_id })),
  );

  server.registerTool(
    "reindex_all",
    {
      description: "Enqueue a full crawl and reconciliation run across the configured WorkDrive memory roots.",
      inputSchema: z.object({}),
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    async () => textResult(await docSvc.reindexAll()),
  );

  server.registerTool(
    "admin_reindex_all",
    {
      description: "Admin alias for reindex_all. Enqueue a full crawl and reconciliation run across configured WorkDrive memory roots.",
      inputSchema: z.object({}),
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    async () => textResult(await docSvc.reindexAll()),
  );

  server.registerTool(
    "admin_reconcile_workdrive",
    {
      description: "Run WorkDrive reconciliation now: crawl configured roots, enqueue missing/stale Markdown, and report scan counts. Admin-only.",
      inputSchema: z.object({}),
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    async () => textResult(await docSvc.reconcileWorkDrive()),
  );

  server.registerTool(
    "admin_status",
    {
      description: "Return operational status: project counts, queued/failed jobs, last sync, and configured connectivity checks without exposing secrets.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async () => textResult(await docSvc.adminStatus()),
  );

  server.registerTool(
    "backfill_memory_layers",
    {
      description: "Assign memory_layer to all existing documents that do not yet have one, based on their memory_type and canonical flag. Run with dry_run=true first to preview. Apply with dry_run=false.",
      inputSchema: z.object({
        dry_run: z.boolean().optional().describe("Default true. Set to false to actually apply the backfill."),
      }),
    },
    async (input) => {
      const result = await docSvc.backfillMemoryLayers({ dryRun: input.dry_run !== false });
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  // Legacy migration tools — still backed by MemoryService until Task 19 cleanup

  server.registerTool(
    "analyze_context_truth_migration",
    {
      description: "Dry-run analysis for Context Truth Engine migration. Counts existing docs/entities/facts and proposes non-destructive alias/state review actions.",
      inputSchema: z.object({ project: z.string().optional() }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ project }) => textResult(await legacySvc.analyzeContextTruthMigration({ project })),
  );

  server.registerTool(
    "run_context_truth_migration",
    {
      description: "Run the non-destructive Context Truth Engine migration. Defaults to dry-run unless apply=true and dry_run=false.",
      inputSchema: z.object({
        project: z.string().optional(),
        dry_run: z.boolean().optional(),
        apply: z.boolean().optional(),
      }),
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    async ({ project, dry_run, apply }) =>
      textResult(await legacySvc.runContextTruthMigration({ project, dryRun: dry_run, apply })),
  );

  server.registerTool(
    "import_ai_brain_vault",
    {
      description: "Import an approved AI Brain/Obsidian vault payload as structured memory. The deployed server accepts client-supplied files and defaults to dry-run.",
      inputSchema: z.object({
        project: z.string().optional(),
        vault_name: z.string().optional(),
        files: z.array(z.object({ path: z.string().min(1), markdown: z.string() })),
        manifest: z.record(z.string(), z.unknown()).optional(),
        retrieval_map: z.record(z.string(), z.unknown()).optional(),
        dry_run: z.boolean().optional(),
        apply: z.boolean().optional(),
        preserve_wikilinks: z.boolean().optional(),
        apply_links: z.boolean().optional(),
        current_context_priorities: z.array(z.string()).optional(),
        author_client: z.string().optional(),
      }),
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    async ({ project, vault_name, files, manifest, retrieval_map, dry_run, apply, preserve_wikilinks, apply_links, current_context_priorities, author_client }) =>
      textResult(await legacySvc.importAiBrainVault({
        project, vaultName: vault_name, files, manifest, retrievalMap: retrieval_map,
        dryRun: dry_run, apply, preserveWikilinks: preserve_wikilinks,
        applyLinks: apply_links, currentContextPriorities: current_context_priorities,
        authorClient: author_client,
      })),
  );

  const lightLaneKnownDealUpdateSchema = z.object({
    entity_name: z.string().min(1),
    source: z.string().min(1),
    confidence: z.number().min(0).max(1).optional(),
    summary: z.string().optional(),
    states: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
  });
  const lightLaneRecoverySchema = z.object({
    ai_brain_files: z.array(z.object({ path: z.string().min(1), markdown: z.string() })).optional(),
    ai_brain_analysis: z.record(z.string(), z.unknown()).optional(),
    associated_repos: z.array(z.string()).optional(),
    known_deal_updates: z.array(lightLaneKnownDealUpdateSchema).optional(),
  });

  server.registerTool(
    "analyze_light_lane_memory_recovery",
    {
      description: "Read-only Light Lane memory recovery analysis. Plans AI Brain import, canonical project current-context docs, stale shared deal routing, shared archive actions, and repo coverage without writing.",
      inputSchema: lightLaneRecoverySchema,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ ai_brain_files, ai_brain_analysis, associated_repos, known_deal_updates }) =>
      textResult(await legacySvc.analyzeLightLaneMemoryRecovery({
        aiBrainFiles: ai_brain_files,
        aiBrainAnalysis: ai_brain_analysis,
        associatedRepos: associated_repos,
        knownDealUpdates: known_deal_updates?.map((u) => ({
          entityName: u.entity_name, source: u.source,
          confidence: u.confidence, summary: u.summary, states: u.states,
        })),
      })),
  );

  server.registerTool(
    "run_light_lane_memory_recovery",
    {
      description: "Run Light Lane memory recovery. Defaults to dry-run; apply=true and dry_run=false imports the AI Brain, writes canonical Light Lane current context, upserts stale deal entity states, archives shared originals, and associates/indexes visible Light Lane repos.",
      inputSchema: lightLaneRecoverySchema.extend({
        dry_run: z.boolean().optional(),
        apply: z.boolean().optional(),
        apply_phases: z.array(z.enum(["ai_brain", "current_context", "entity_state", "archive", "repo_associate", "repo_index"])).optional(),
        author_client: z.string().optional(),
      }),
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    async ({ ai_brain_files, ai_brain_analysis, associated_repos, known_deal_updates, dry_run, apply, apply_phases, author_client }) =>
      textResult(await legacySvc.runLightLaneMemoryRecovery({
        aiBrainFiles: ai_brain_files,
        aiBrainAnalysis: ai_brain_analysis,
        associatedRepos: associated_repos,
        knownDealUpdates: known_deal_updates?.map((u) => ({
          entityName: u.entity_name, source: u.source,
          confidence: u.confidence, summary: u.summary, states: u.states,
        })),
        dryRun: dry_run, apply, applyPhases: apply_phases, authorClient: author_client,
      })),
  );

  server.registerTool(
    "analyze_memory_migration",
    {
      description: "Read-only analysis of duplicate projects, stale/placeholder context, supersession/link gaps, and vector indexing gaps. Never writes.",
      inputSchema: z.object({
        project: z.string().optional(),
        include_markdown_links: z.boolean().optional(),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ project, include_markdown_links }) =>
      textResult(await legacySvc.analyzeMemoryMigration({ project, includeMarkdownLinks: include_markdown_links })),
  );

  server.registerTool(
    "run_memory_migration",
    {
      description: "Run non-destructive memory migration. Defaults to dry-run; apply=true only writes metadata-safe aliases, canonical markers, links, and audit/source events.",
      inputSchema: z.object({
        dry_run: z.boolean().optional(),
        apply: z.boolean().optional(),
        project: z.string().optional(),
      }),
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    async ({ dry_run, apply, project }) =>
      textResult(await legacySvc.runMemoryMigration({ dryRun: dry_run, apply, project })),
  );

  server.registerTool(
    "get_migration_audit",
    {
      description: "List migration audit events written by ContextOS migration/reconciliation tools.",
      inputSchema: z.object({
        migration_slug: z.string().optional(),
        limit: z.number().int().positive().optional(),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ migration_slug, limit }) =>
      textResult(await legacySvc.getMigrationAudit({ migrationSlug: migration_slug, limit })),
  );

  server.registerTool(
    "analyze_workdrive_canonicalization",
    {
      description: "Read-only WorkDrive/Obsidian-visible canonicalization analysis. Produces a manifest for archive-copy, redirect, D1 marker, graph link, and reindex actions without writing.",
      inputSchema: z.object({
        canonical_project: z.string().optional(),
        duplicate_project: z.string().optional(),
        include_shared_duplicates: z.boolean().optional(),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ canonical_project, duplicate_project, include_shared_duplicates }) =>
      textResult(await legacySvc.analyzeWorkdriveCanonicalization({
        canonicalProject: canonical_project, duplicateProject: duplicate_project,
        includeSharedDuplicates: include_shared_duplicates,
      })),
  );

  server.registerTool(
    "run_workdrive_canonicalization",
    {
      description: "Run second-phase non-destructive WorkDrive-visible canonicalization. Defaults to dry-run; apply=true archive-copies Markdown, writes redirect files, marks duplicate docs archived, refreshes vector metadata inactive, and audits everything.",
      inputSchema: z.object({
        canonical_project: z.string().optional(),
        duplicate_project: z.string().optional(),
        dry_run: z.boolean().optional(),
        apply: z.boolean().optional(),
        include_shared_duplicates: z.boolean().optional(),
      }),
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    async ({ canonical_project, duplicate_project, dry_run, apply, include_shared_duplicates }) =>
      textResult(await legacySvc.runWorkdriveCanonicalization({
        canonicalProject: canonical_project, duplicateProject: duplicate_project,
        dryRun: dry_run, apply, includeSharedDuplicates: include_shared_duplicates,
      })),
  );

  server.registerTool(
    "get_workdrive_canonicalization_manifest",
    {
      description: "List recorded WorkDrive-visible canonicalization manifests and apply results.",
      inputSchema: z.object({
        migration_slug: z.string().optional(),
        canonical_project: z.string().optional(),
        duplicate_project: z.string().optional(),
        limit: z.number().int().positive().optional(),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ migration_slug, canonical_project, duplicate_project, limit }) =>
      textResult(await legacySvc.getWorkdriveCanonicalizationManifest({
        migrationSlug: migration_slug, canonicalProject: canonical_project,
        duplicateProject: duplicate_project, limit,
      })),
  );
}
