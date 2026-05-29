import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { DocumentService } from "~/service/DocumentService";
import type { ProjectService } from "~/service/ProjectService";
import { textResult } from "~/tools/schemas";

export function registerGithubTools(server: McpServer, svc: ProjectService, docSvc: DocumentService) {
  server.registerTool(
    "github_list_repos",
    {
      description: "List repositories visible to the connected GitHub OAuth account. Use this to find the right owner/repo before fetching code.",
      inputSchema: z.object({
        query: z.string().optional(),
        owner: z.string().optional(),
        limit: z.number().int().min(1).max(100).optional(),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ query, owner, limit }) => textResult(await svc.listGithubRepos({ query, owner, limit })),
  );

  server.registerTool(
    "github_find_repos",
    {
      description: "Find repositories visible to the connected GitHub OAuth account by name, description, or owner. Alias of github_list_repos with a client-friendly name.",
      inputSchema: z.object({
        query: z.string().optional(),
        owner: z.string().optional(),
        limit: z.number().int().min(1).max(100).optional(),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ query, owner, limit }) => textResult(await svc.listGithubRepos({ query, owner, limit })),
  );

  server.registerTool(
    "github_associate_repo",
    {
      description: "Associate a visible GitHub repository with a memory project so future sessions know which live repo source belongs to the project.",
      inputSchema: z.object({
        project: z.string().min(1),
        repo: z.string().min(1).describe("Repository in owner/name form."),
      }),
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    async ({ project, repo }) => textResult(await svc.associateGithubRepo({ project, repo })),
  );

  server.registerTool(
    "github_project_repos",
    {
      description: "List GitHub repositories associated with a memory project.",
      inputSchema: z.object({ project: z.string().min(1) }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ project }) => textResult(await svc.listProjectGithubRepos({ project })),
  );

  server.registerTool(
    "github_inspect_repo_structure",
    {
      description: "Inspect a GitHub repository root and key top-level directories without saving anything to memory.",
      inputSchema: z.object({
        repo: z.string().min(1),
        ref: z.string().optional(),
        max_entries: z.number().int().min(1).max(500).optional(),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ repo, ref, max_entries }) =>
      textResult(await svc.inspectGithubRepoStructure({ repo, ref, maxEntries: max_entries })),
  );

  server.registerTool(
    "github_index_repo_overview",
    {
      description: "Controlled repo indexing. Saves only safe overview/config files and structure metadata into project repo-index memory; never blindly ingests huge repos.",
      inputSchema: z.object({
        project: z.string().min(1),
        repo: z.string().min(1),
        ref: z.string().optional(),
        globs: z.array(z.string()).optional(),
        max_files: z.number().int().min(1).max(50).optional(),
        max_bytes_per_file: z.number().int().min(1).max(200_000).optional(),
        author_client: z.string().optional(),
      }),
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    async ({ project, repo, ref, globs, max_files, max_bytes_per_file, author_client }) =>
      textResult(await svc.indexGithubRepoOverview({
        project, repo, ref, globs, maxFiles: max_files,
        maxBytesPerFile: max_bytes_per_file, authorClient: author_client,
      })),
  );

  server.registerTool(
    "github_get_file",
    {
      description: "Fetch a file from a repository visible to the connected GitHub OAuth account. Read-only; does not save it to memory.",
      inputSchema: z.object({
        repo: z.string().min(1).describe("Repository in owner/name form."),
        path: z.string().min(1),
        ref: z.string().optional().describe("Branch, tag, or SHA."),
        max_bytes: z.number().int().min(1).max(1_000_000).optional(),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ repo, path, ref, max_bytes }) =>
      textResult(await svc.getGithubFile({ repo, path, ref, maxBytes: max_bytes })),
  );

  server.registerTool(
    "github_search_code",
    {
      description: "Search code visible to the connected GitHub OAuth account. Use github_get_file to fetch result contents.",
      inputSchema: z.object({
        query: z.string().min(1),
        repos: z.array(z.string()).optional().describe("Repositories in owner/name form. Defaults to all visible repos unless GITHUB_ALLOWED_REPOS is set."),
        owner: z.string().optional().describe("Optional GitHub user or org owner to narrow broad searches."),
        limit: z.number().int().min(1).max(20).optional(),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ query, repos, owner, limit }) =>
      textResult(await svc.searchGithubCode({ query, repos, owner, limit })),
  );

  server.registerTool(
    "github_save_file_memory",
    {
      description: "Fetch a GitHub file or line range and save it as a memory document so it can be indexed into Vectorize.",
      inputSchema: z.object({
        repo: z.string().min(1).describe("Repository in owner/name form."),
        path: z.string().min(1),
        ref: z.string().optional().describe("Branch, tag, or SHA."),
        project: z.string().optional().describe("Memory project. Defaults to shared."),
        title: z.string().optional(),
        note: z.string().optional(),
        line_start: z.number().int().min(1).optional(),
        line_end: z.number().int().min(1).optional(),
        max_bytes: z.number().int().min(1).max(1_000_000).optional(),
        author_client: z.string().optional(),
      }),
      annotations: { destructiveHint: true, idempotentHint: false },
    },
    async ({ repo, path, ref, project, title, note, line_start, line_end, max_bytes, author_client }) =>
      textResult(await docSvc.saveGithubFileMemory({
        repo, path, ref, project, title, note,
        lineStart: line_start, lineEnd: line_end,
        maxBytes: max_bytes, authorClient: author_client,
      })),
  );
}
