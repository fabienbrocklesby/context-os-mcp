import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { DocumentService } from "~/service/DocumentService";
import type { RetrievalService } from "~/service/RetrievalService";
import { taskProfileSchema, textResult } from "~/tools/schemas";

export function registerRetrievalTools(
  server: McpServer,
  svc: RetrievalService,
  docSvc: DocumentService,
) {
  server.registerTool(
    "search",
    {
      description: "Search memory documents for OpenAI MCP integrations. Returns JSON with a top-level results array.",
      inputSchema: z.object({ query: z.string().min(1) }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ query }) => {
      const result = await svc.searchMemory({ query, limit: 8 });
      return { content: [{ type: "text" as const, text: JSON.stringify({ results: result.results }) }] };
    },
  );

  server.registerTool(
    "fetch",
    {
      description: "Fetch the full contents of a memory document for OpenAI MCP integrations. Returns a single JSON object.",
      inputSchema: z.object({ id: z.string().min(1) }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ id }) => {
      const result = await docSvc.getDocument({ documentId: id, authoritative: true });
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            id: result.document.id,
            title: result.document.title,
            text: result.authoritative_markdown ?? result.snapshot?.rawMarkdown ?? "",
            url: result.document.permalink ?? result.document.path,
            metadata: {
              path: result.document.path,
              project: result.document.project,
              memory_type: result.document.memoryType,
              status: result.document.status,
              revision: result.document.revision,
            },
          }),
        }],
      };
    },
  );

  server.registerTool(
    "search_memory",
    {
      description: "Search chunked memory using semantic retrieval with metadata filtering, reranking, and optional authoritative WorkDrive hydration.",
      inputSchema: z.object({
        query: z.string().min(1),
        project: z.string().optional(),
        limit: z.number().int().min(1).max(20).optional(),
        include_superseded: z.boolean().optional(),
        authoritative: z.boolean().optional(),
        memory_types: z.array(z.enum([
          "current_context", "historical_note", "decision",
          "session_summary", "snippet", "repo_index",
        ])).optional(),
        repo: z.string().optional(),
        path: z.string().optional(),
        source: z.string().optional(),
        tags: z.array(z.string()).optional(),
        scope: z.enum(["project", "initiative", "entity", "all_related"]).optional(),
        initiative: z.string().optional(),
        entity_id: z.string().optional(),
        task_profile: taskProfileSchema.optional(),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ query, project, limit, include_superseded, authoritative, memory_types, repo, path, source, tags, scope, initiative, entity_id, task_profile }) =>
      textResult(await svc.searchMemory({
        query, project, limit, includeSuperseded: include_superseded, authoritative,
        memoryTypes: memory_types, repo, path, source, tags, scope, initiative,
        entityId: entity_id, taskProfile: task_profile,
      })),
  );

  server.registerTool(
    "get_document",
    {
      description: "Get a document by canonical id, path, or WorkDrive file id.",
      inputSchema: z.object({
        document_id: z.string().optional(),
        path: z.string().optional(),
        workdrive_file_id: z.string().optional(),
        authoritative: z.boolean().optional(),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ document_id, path, workdrive_file_id, authoritative }) =>
      textResult(await docSvc.getDocument({
        documentId: document_id, path, workdriveFileId: workdrive_file_id, authoritative,
      })),
  );

  server.registerTool(
    "get_current_context",
    {
      description: "Get active current-context and decision documents for a project, optionally narrowed by a semantic query.",
      inputSchema: z.object({
        project: z.string().optional(),
        query: z.string().optional(),
        authoritative: z.boolean().optional(),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ project, query, authoritative }) =>
      textResult(await docSvc.getCurrentContext({ project, query, authoritative })),
  );

  server.registerTool(
    "retrieval_diagnostics",
    {
      description: "Explain retrieval behavior for a query, including namespaces, filters, vector/keyword hit counts, top results, and ranking rules.",
      inputSchema: z.object({
        query: z.string().min(1),
        project: z.string().optional(),
        repo: z.string().optional(),
        path: z.string().optional(),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ query, project, repo, path }) =>
      textResult(await svc.retrievalDiagnostics({ query, project, repo, path })),
  );
}
