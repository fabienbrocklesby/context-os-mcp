import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { DocumentService } from "~/service/DocumentService";
import { textResult } from "~/tools/schemas";

export function registerAdminTools(
  server: McpServer,
  docSvc: DocumentService,
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
}
