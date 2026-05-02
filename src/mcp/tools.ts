import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { MemoryService } from "~/domain/service";
import type { MemoryPrincipal } from "~/domain/memory";

export function createMemoryMcpServer(env: Env, principal: MemoryPrincipal) {
  const service = new MemoryService(env, principal);
  const server = new McpServer({
    name: "memory-system-mcp",
    version: "0.1.0",
  });
  const businessHoursSchema = z.object({
    start: z.string().optional(),
    end: z.string().optional(),
    business_days: z.array(z.number().int().min(1).max(7)).optional(),
  });

  server.registerTool(
    "ensure_project",
    {
      description:
        "Create or repair a memory project and its canonical WorkDrive folder tree. Idempotent and safe to call at the start of a session.",
      inputSchema: z.object({
        project: z.string().optional(),
        display_name: z.string().optional(),
        description: z.string().optional(),
        aliases: z.array(z.string()).optional(),
        profile: z.record(z.string(), z.unknown()).optional(),
      }),
      annotations: {
        idempotentHint: true,
      },
    },
    async ({ project, display_name, description, aliases, profile }) =>
      textResult(
        await service.ensureProject({
          project,
          displayName: display_name,
          description,
          aliases,
          profile,
        }),
      ),
  );

  server.registerTool(
    "list_projects",
    {
      description: "List memory projects known to D1.",
      inputSchema: z.object({}),
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async () => textResult(await service.listProjects()),
  );

  server.registerTool(
    "get_project",
    {
      description:
        "Get project metadata, folder checks, associated GitHub repos, and basic memory stats.",
      inputSchema: z.object({
        project: z.string().min(1),
      }),
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async ({ project }) => textResult(await service.getProject({ project })),
  );

  server.registerTool(
    "update_project_profile",
    {
      description:
        "Update project display metadata, status, aliases, and structured profile JSON.",
      inputSchema: z.object({
        project: z.string().min(1),
        display_name: z.string().optional(),
        description: z.string().nullable().optional(),
        status: z.enum(["active", "paused", "archived"]).optional(),
        aliases: z.array(z.string()).optional(),
        profile: z.record(z.string(), z.unknown()).optional(),
        parent_initiative: z.string().nullable().optional(),
        related_projects: z.array(z.string()).optional(),
        canonical_project: z.string().nullable().optional(),
        merged_into_project: z.string().nullable().optional(),
      }),
      annotations: {
        destructiveHint: true,
        idempotentHint: true,
      },
    },
    async ({
      project,
      display_name,
      description,
      status,
      aliases,
      profile,
      parent_initiative,
      related_projects,
      canonical_project,
      merged_into_project,
    }) =>
      textResult(
        await service.updateProjectProfile({
          project,
          displayName: display_name,
          description,
          status,
          aliases,
          profile,
          parentInitiative: parent_initiative,
          relatedProjects: related_projects,
          canonicalProject: canonical_project,
          mergedIntoProject: merged_into_project,
        }),
      ),
  );

  server.registerTool(
    "prepare_assistant_session",
    {
      description:
        "Resolve active project/topic and return an assistant context plan with initiatives, related projects, grouped memory, entities, tasks, source freshness warnings, live MCP recommendations, and write-back policy.",
      inputSchema: z.object({
        project_or_topic: z.string().optional(),
        user_intent: z.string().optional(),
        active_sources: z.array(z.string()).optional(),
        available_tools: z.array(z.string()).optional(),
        timezone: z.string().optional(),
        now: z.string().optional(),
        business_hours: businessHoursSchema.optional(),
        authoritative: z.boolean().optional(),
      }),
      annotations: {
        idempotentHint: true,
      },
    },
    async ({
      project_or_topic,
      user_intent,
      active_sources,
      available_tools,
      timezone,
      now,
      business_hours,
      authoritative,
    }) =>
      textResult(
        await service.prepareAssistantSession({
          projectOrTopic: project_or_topic,
          userIntent: user_intent,
          activeSources: active_sources,
          availableTools: available_tools,
          timezone,
          now,
          businessHours: business_hours,
          authoritative,
        }),
      ),
  );

  server.registerTool(
    "get_operational_context",
    {
      description:
        "Return validated time/date/weekday/timezone context, weekend/business-day classification, business-hour status, and public-holiday placeholder state.",
      inputSchema: z.object({
        timezone: z.string().optional(),
        now: z.string().optional(),
        business_hours: businessHoursSchema.optional(),
      }),
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async ({ timezone, now, business_hours }) =>
      textResult(
        service.getOperationalContext({
          timezone,
          now,
          businessHours: business_hours,
        }),
      ),
  );

  server.registerTool(
    "plan_assistant_action",
    {
      description:
        "Build a deterministic Assistant Context OS action plan with time actionability, request classification, required tools, confirmation guardrails, and write-back recommendations.",
      inputSchema: z.object({
        user_intent: z.string().min(1),
        project_or_topic: z.string().optional(),
        active_sources: z.array(z.string()).optional(),
        available_tools: z.array(z.string()).optional(),
        timezone: z.string().optional(),
        now: z.string().optional(),
        business_hours: businessHoursSchema.optional(),
      }),
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async ({
      user_intent,
      active_sources,
      available_tools,
      timezone,
      now,
      business_hours,
    }) =>
      textResult(
        service.planAssistantAction({
          userIntent: user_intent,
          activeSources: active_sources,
          availableTools: available_tools,
          timezone,
          now,
          businessHours: business_hours,
        }),
      ),
  );

  server.registerTool(
    "resolve_context",
    {
      description:
        "Resolve a user topic or project hint into an active project, candidate projects, related project hints, and an explicit project-switching reason.",
      inputSchema: z.object({
        project_or_topic: z.string().optional(),
        user_intent: z.string().optional(),
      }),
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async ({ project_or_topic, user_intent }) =>
      textResult(
        await service.resolveContext({
          projectOrTopic: project_or_topic,
          userIntent: user_intent,
        }),
      ),
  );

  server.registerTool(
    "project_status",
    {
      description:
        "Report project health from D1 metadata, WorkDrive folder checks, failed jobs, and associated repos.",
      inputSchema: z.object({
        project: z.string().min(1),
      }),
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async ({ project }) => textResult(await service.projectStatus({ project })),
  );

  server.registerTool(
    "bootstrap_project_context",
    {
      description:
        "Ensure a project exists and create any missing canonical current-context documents: overview, architecture, active goals, constraints, setup/deployment, and repo map.",
      inputSchema: z.object({
        project: z.string().min(1),
        display_name: z.string().optional(),
        description: z.string().optional(),
        author_client: z.string().optional(),
      }),
      annotations: {
        destructiveHint: true,
        idempotentHint: true,
      },
    },
    async ({ project, display_name, description, author_client }) =>
      textResult(
        await service.bootstrapProjectContext({
          project,
          displayName: display_name,
          description,
          authorClient: author_client,
        }),
      ),
  );

  server.registerTool(
    "prepare_work_session",
    {
      description:
        "Best first call for AI clients. Ensures the project exists, returns current context, task-relevant memory, and associated GitHub repos.",
      inputSchema: z.object({
        project: z.string().min(1),
        topic: z.string().optional(),
        authoritative: z.boolean().optional(),
      }),
      annotations: {
        idempotentHint: true,
      },
    },
    async ({ project, topic, authoritative }) =>
      textResult(await service.prepareWorkSession({ project, topic, authoritative })),
  );

  server.registerTool(
    "github_list_repos",
    {
      description:
        "List repositories visible to the connected GitHub OAuth account. Use this to find the right owner/repo before fetching code.",
      inputSchema: z.object({
        query: z.string().optional(),
        owner: z.string().optional(),
        limit: z.number().int().min(1).max(100).optional(),
      }),
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async ({ query, owner, limit }) =>
      textResult(
        await service.listGithubRepos({
          query,
          owner,
          limit,
        }),
      ),
  );

  server.registerTool(
    "github_find_repos",
    {
      description:
        "Find repositories visible to the connected GitHub OAuth account by name, description, or owner. Alias of github_list_repos with a client-friendly name.",
      inputSchema: z.object({
        query: z.string().optional(),
        owner: z.string().optional(),
        limit: z.number().int().min(1).max(100).optional(),
      }),
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async ({ query, owner, limit }) =>
      textResult(
        await service.listGithubRepos({
          query,
          owner,
          limit,
        }),
      ),
  );

  server.registerTool(
    "github_associate_repo",
    {
      description:
        "Associate a visible GitHub repository with a memory project so future sessions know which live repo source belongs to the project.",
      inputSchema: z.object({
        project: z.string().min(1),
        repo: z.string().min(1).describe("Repository in owner/name form."),
      }),
      annotations: {
        destructiveHint: true,
        idempotentHint: true,
      },
    },
    async ({ project, repo }) =>
      textResult(await service.associateGithubRepo({ project, repo })),
  );

  server.registerTool(
    "github_project_repos",
    {
      description: "List GitHub repositories associated with a memory project.",
      inputSchema: z.object({
        project: z.string().min(1),
      }),
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async ({ project }) => textResult(await service.listProjectGithubRepos({ project })),
  );

  server.registerTool(
    "github_inspect_repo_structure",
    {
      description:
        "Inspect a GitHub repository root and key top-level directories without saving anything to memory.",
      inputSchema: z.object({
        repo: z.string().min(1),
        ref: z.string().optional(),
        max_entries: z.number().int().min(1).max(500).optional(),
      }),
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async ({ repo, ref, max_entries }) =>
      textResult(
        await service.inspectGithubRepoStructure({
          repo,
          ref,
          maxEntries: max_entries,
        }),
      ),
  );

  server.registerTool(
    "github_index_repo_overview",
    {
      description:
        "Controlled repo indexing. Saves only safe overview/config files and structure metadata into project repo-index memory; never blindly ingests huge repos.",
      inputSchema: z.object({
        project: z.string().min(1),
        repo: z.string().min(1),
        ref: z.string().optional(),
        globs: z.array(z.string()).optional(),
        max_files: z.number().int().min(1).max(50).optional(),
        max_bytes_per_file: z.number().int().min(1).max(200_000).optional(),
        author_client: z.string().optional(),
      }),
      annotations: {
        destructiveHint: true,
        idempotentHint: true,
      },
    },
    async ({ project, repo, ref, globs, max_files, max_bytes_per_file, author_client }) =>
      textResult(
        await service.indexGithubRepoOverview({
          project,
          repo,
          ref,
          globs,
          maxFiles: max_files,
          maxBytesPerFile: max_bytes_per_file,
          authorClient: author_client,
        }),
      ),
  );

  server.registerTool(
    "github_get_file",
    {
      description:
        "Fetch a file from a repository visible to the connected GitHub OAuth account. Read-only; does not save it to memory.",
      inputSchema: z.object({
        repo: z.string().min(1).describe("Repository in owner/name form."),
        path: z.string().min(1),
        ref: z.string().optional().describe("Branch, tag, or SHA."),
        max_bytes: z.number().int().min(1).max(1_000_000).optional(),
      }),
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async ({ repo, path, ref, max_bytes }) =>
      textResult(
        await service.getGithubFile({
          repo,
          path,
          ref,
          maxBytes: max_bytes,
        }),
      ),
  );

  server.registerTool(
    "github_search_code",
    {
      description:
        "Search code visible to the connected GitHub OAuth account. Use github_get_file to fetch result contents.",
      inputSchema: z.object({
        query: z.string().min(1),
        repos: z.array(z.string()).optional().describe("Repositories in owner/name form. Defaults to all visible repos unless GITHUB_ALLOWED_REPOS is set."),
        owner: z.string().optional().describe("Optional GitHub user or org owner to narrow broad searches."),
        limit: z.number().int().min(1).max(20).optional(),
      }),
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async ({ query, repos, owner, limit }) =>
      textResult(
        await service.searchGithubCode({
          query,
          repos,
          owner,
          limit,
        }),
      ),
  );

  server.registerTool(
    "github_save_file_memory",
    {
      description:
        "Fetch a GitHub file or line range and save it as a memory document so it can be indexed into Vectorize.",
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
      annotations: {
        destructiveHint: true,
        idempotentHint: false,
      },
    },
    async ({
      repo,
      path,
      ref,
      project,
      title,
      note,
      line_start,
      line_end,
      max_bytes,
      author_client,
    }) =>
      textResult(
        await service.saveGithubFileMemory({
          repo,
          path,
          ref,
          project,
          title,
          note,
          lineStart: line_start,
          lineEnd: line_end,
          maxBytes: max_bytes,
          authorClient: author_client,
        }),
      ),
  );

  server.registerTool(
    "search",
    {
      description:
        "Search memory documents for OpenAI MCP integrations. Returns JSON with a top-level results array.",
      inputSchema: z.object({
        query: z.string().min(1),
      }),
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async ({ query }) => {
      const result = await service.searchMemory({
        query,
        limit: 8,
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ results: result.results }),
          },
        ],
      };
    },
  );

  server.registerTool(
    "fetch",
    {
      description:
        "Fetch the full contents of a memory document for OpenAI MCP integrations. Returns a single JSON object.",
      inputSchema: z.object({
        id: z.string().min(1),
      }),
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async ({ id }) => {
      const result = await service.getDocument({
        documentId: id,
        authoritative: true,
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              id: result.document.id,
              title: result.document.title,
              text:
                result.authoritative_markdown ??
                result.snapshot?.rawMarkdown ??
                "",
              url: result.document.permalink ?? result.document.path,
              metadata: {
                path: result.document.path,
                project: result.document.project,
                memory_type: result.document.memoryType,
                status: result.document.status,
                revision: result.document.revision,
              },
            }),
          },
        ],
      };
    },
  );

  server.registerTool(
    "search_memory",
    {
      description:
        "Search chunked memory using semantic retrieval with metadata filtering, reranking, and optional authoritative WorkDrive hydration.",
      inputSchema: z.object({
        query: z.string().min(1),
        project: z.string().optional(),
        limit: z.number().int().min(1).max(20).optional(),
        include_superseded: z.boolean().optional(),
        authoritative: z.boolean().optional(),
        memory_types: z.array(z.enum([
          "current_context",
          "historical_note",
          "decision",
          "session_summary",
          "snippet",
          "repo_index",
        ])).optional(),
        repo: z.string().optional(),
        path: z.string().optional(),
        source: z.string().optional(),
        tags: z.array(z.string()).optional(),
        scope: z.enum(["project", "initiative", "entity", "all_related"]).optional(),
        initiative: z.string().optional(),
        entity_id: z.string().optional(),
      }),
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async ({
      query,
      project,
      limit,
      include_superseded,
      authoritative,
      memory_types,
      repo,
      path,
      source,
      tags,
      scope,
      initiative,
      entity_id,
    }) => textResult(
      await service.searchMemory({
        query,
        project,
        limit,
        includeSuperseded: include_superseded,
        authoritative,
        memoryTypes: memory_types,
        repo,
        path,
        source,
        tags,
        scope,
        initiative,
        entityId: entity_id,
      }),
    ),
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
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async ({
      document_id,
      path,
      workdrive_file_id,
      authoritative,
    }) => textResult(
      await service.getDocument({
        documentId: document_id,
        path,
        workdriveFileId: workdrive_file_id,
        authoritative,
      }),
    ),
  );

  server.registerTool(
    "list_initiatives",
    {
      description: "List structured initiatives, optionally narrowed by project or status.",
      inputSchema: z.object({
        status: z.string().optional(),
        project: z.string().optional(),
        limit: z.number().int().min(1).max(100).optional(),
      }),
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async ({ status, project, limit }) =>
      textResult(await service.listInitiatives({ status, project, limit })),
  );

  server.registerTool(
    "get_initiative_context",
    {
      description:
        "Get an initiative with linked projects, open tasks, durable facts, and recent source events.",
      inputSchema: z.object({
        initiative: z.string().min(1),
      }),
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async ({ initiative }) => textResult(await service.getInitiativeContext({ initiative })),
  );

  server.registerTool(
    "upsert_initiative",
    {
      description:
        "Create or update a large cross-project initiative and optionally link projects to it.",
      inputSchema: z.object({
        slug: z.string().optional(),
        title: z.string().min(1),
        summary: z.string().nullable().optional(),
        status: z.enum(["active", "paused", "completed", "archived"]).optional(),
        owner: z.string().nullable().optional(),
        horizon: z.string().nullable().optional(),
        priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
        starts_at: z.string().nullable().optional(),
        due_at: z.string().nullable().optional(),
        tags: z.array(z.string()).optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
        project_slugs: z.array(z.string()).optional(),
      }),
      annotations: {
        destructiveHint: true,
        idempotentHint: true,
      },
    },
    async ({
      slug,
      title,
      summary,
      status,
      owner,
      horizon,
      priority,
      starts_at,
      due_at,
      tags,
      metadata,
      project_slugs,
    }) =>
      textResult(
        await service.upsertInitiative({
          slug,
          title,
          summary,
          status,
          owner,
          horizon,
          priority,
          startsAt: starts_at,
          dueAt: due_at,
          tags,
          metadata,
          projectSlugs: project_slugs,
        }),
      ),
  );

  server.registerTool(
    "link_memory",
    {
      description:
        "Create or update a typed relationship between projects, initiatives, entities, documents, tasks, facts, or source events.",
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
      annotations: {
        destructiveHint: true,
        idempotentHint: true,
      },
    },
    async ({ project, from_type, from_id, to_type, to_id, relation, weight, metadata }) =>
      textResult(
        await service.linkMemory({
          project,
          fromType: from_type,
          fromId: from_id,
          toType: to_type,
          toId: to_id,
          relation,
          weight,
          metadata,
        }),
      ),
  );

  server.registerTool(
    "save_source_event",
    {
      description:
        "Save a selective durable summary of an external CRM/email/calendar/notes/GitHub/Shopify/WorkDrive event with source links and privacy policy.",
      inputSchema: z.object({
        project: z.string().optional(),
        source: z.string().min(1),
        source_id: z.string().nullable().optional(),
        event_type: z.string().min(1),
        occurred_at: z.string().nullable().optional(),
        title: z.string().min(1),
        summary: z.string().min(1),
        sensitivity: z.enum(["public", "internal", "confidential", "sensitive"]).optional(),
        save_policy: z.enum(["durable_summary", "live_only", "requires_approval"]).optional(),
        initiative_id: z.string().nullable().optional(),
        entity_id: z.string().nullable().optional(),
        external_url: z.string().nullable().optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      }),
      annotations: {
        destructiveHint: true,
        idempotentHint: true,
      },
    },
    async ({
      project,
      source,
      source_id,
      event_type,
      occurred_at,
      title,
      summary,
      sensitivity,
      save_policy,
      initiative_id,
      entity_id,
      external_url,
      metadata,
    }) =>
      textResult(
        await service.saveSourceEvent({
          project,
          source,
          sourceId: source_id,
          eventType: event_type,
          occurredAt: occurred_at,
          title,
          summary,
          sensitivity,
          savePolicy: save_policy,
          initiativeId: initiative_id,
          entityId: entity_id,
          externalUrl: external_url,
          metadata,
        }),
      ),
  );

  server.registerTool(
    "extract_durable_facts",
    {
      description:
        "Extract durable fact candidates from text and optionally save them as structured facts with source links.",
      inputSchema: z.object({
        project: z.string().optional(),
        text: z.string().min(1),
        title: z.string().optional(),
        source: z.string().optional(),
        source_url: z.string().optional(),
        confidence: z.number().min(0).max(1).optional(),
        initiative_id: z.string().nullable().optional(),
        entity_id: z.string().nullable().optional(),
        save: z.boolean().optional(),
      }),
      annotations: {
        destructiveHint: true,
        idempotentHint: false,
      },
    },
    async ({ project, text, title, source, source_url, confidence, initiative_id, entity_id, save }) =>
      textResult(
        await service.extractDurableFacts({
          project,
          text,
          title,
          source,
          sourceUrl: source_url,
          confidence,
          initiativeId: initiative_id,
          entityId: entity_id,
          save,
        }),
      ),
  );

  server.registerTool(
    "upsert_task",
    {
      description:
        "Create or update a durable task/reminder linked to a project, initiative, entity, and optional source.",
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
      annotations: {
        destructiveHint: true,
        idempotentHint: true,
      },
    },
    async ({
      id,
      project,
      title,
      description,
      status,
      priority,
      due_at,
      owner,
      initiative_id,
      entity_id,
      source,
      source_url,
      reminder_at,
      metadata,
    }) =>
      textResult(
        await service.upsertTask({
          id,
          project,
          title,
          description,
          status,
          priority,
          dueAt: due_at,
          owner,
          initiativeId: initiative_id,
          entityId: entity_id,
          source,
          sourceUrl: source_url,
          reminderAt: reminder_at,
          metadata,
        }),
      ),
  );

  server.registerTool(
    "daily_briefing",
    {
      description:
        "Return a proactive daily briefing for due tasks, active initiatives, recent source events, and suggested focus.",
      inputSchema: z.object({
        project: z.string().optional(),
        date: z.string().optional(),
      }),
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async ({ project, date }) => textResult(await service.dailyBriefing({ project, date })),
  );

  server.registerTool(
    "context_health_check",
    {
      description:
        "Check context completeness, retrieval mode, linked initiatives/entities/tasks, and likely freshness gaps for a project.",
      inputSchema: z.object({
        project: z.string().optional(),
        query: z.string().optional(),
      }),
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async ({ project, query }) =>
      textResult(await service.contextHealthCheck({ project, query })),
  );

  server.registerTool(
    "get_current_context",
    {
      description:
        "Get active current-context and decision documents for a project, optionally narrowed by a semantic query.",
      inputSchema: z.object({
        project: z.string().optional(),
        query: z.string().optional(),
        authoritative: z.boolean().optional(),
      }),
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async ({ project, query, authoritative }) =>
      textResult(await service.getCurrentContext({ project, query, authoritative })),
  );

  server.registerTool(
    "write_session_summary",
    {
      description:
        "Write a new session summary markdown file into the configured WorkDrive memory structure and enqueue reindexing.",
      inputSchema: z.object({
        project: z.string().optional(),
        title: z.string().min(1),
        markdown: z.string().min(1),
        tags: z.array(z.string()).optional(),
        author_client: z.string().optional(),
      }),
      annotations: {
        destructiveHint: true,
        idempotentHint: false,
      },
    },
    async ({ project, title, markdown, tags, author_client }) =>
      textResult(
        await service.writeSessionSummary({
          project,
          title,
          markdown,
          tags,
          authorClient: author_client,
        }),
      ),
  );

  server.registerTool(
    "save_snippet",
    {
      description:
        "Save a durable snippet or useful excerpt into project memory with source, repo/path, confidence, usefulness, and duplicate protection.",
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
      annotations: {
        destructiveHint: true,
        idempotentHint: true,
      },
    },
    async ({
      project,
      title,
      markdown,
      tags,
      source,
      source_urls,
      repo,
      path,
      confidence,
      usefulness,
      author_client,
    }) =>
      textResult(
        await service.saveSnippet({
          project,
          title,
          markdown,
          tags,
          source,
          sourceUrls: source_urls,
          repo,
          path,
          confidence,
          usefulness,
          authorClient: author_client,
        }),
      ),
  );

  server.registerTool(
    "finish_work_session",
    {
      description:
        "Best final call for AI clients. Writes a session summary and optional decisions, snippets, tasks, source events, and durable facts in one workflow.",
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
          sensitivity: z.enum(["public", "internal", "confidential", "sensitive"]).optional(),
          save_policy: z.enum(["durable_summary", "live_only", "requires_approval"]).optional(),
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
      annotations: {
        destructiveHint: true,
        idempotentHint: false,
      },
    },
    async ({
      project,
      title,
      summary_markdown,
      tags,
      decisions,
      snippets,
      tasks,
      source_events,
      facts,
      author_client,
    }) =>
      textResult(
        await service.finishWorkSession({
          project,
          title,
          summaryMarkdown: summary_markdown,
          tags,
          decisions: decisions?.map((decision) => ({
            title: decision.title,
            markdown: decision.markdown,
            tags: decision.tags,
            supersedesDocumentIds: decision.supersedes_document_ids,
          })),
          snippets: snippets?.map((snippet) => ({
            title: snippet.title,
            markdown: snippet.markdown,
            tags: snippet.tags,
            source: snippet.source,
            sourceUrls: snippet.source_urls,
            repo: snippet.repo,
            path: snippet.path,
          })),
          tasks: tasks?.map((task) => ({
            id: task.id,
            title: task.title,
            description: task.description,
            status: task.status,
            priority: task.priority,
            dueAt: task.due_at,
            owner: task.owner,
            initiativeId: task.initiative_id,
            entityId: task.entity_id,
            source: task.source,
            sourceUrl: task.source_url,
            reminderAt: task.reminder_at,
            metadata: task.metadata,
          })),
          sourceEvents: source_events?.map((event) => ({
            source: event.source,
            sourceId: event.source_id,
            eventType: event.event_type,
            occurredAt: event.occurred_at,
            title: event.title,
            summary: event.summary,
            sensitivity: event.sensitivity,
            savePolicy: event.save_policy,
            initiativeId: event.initiative_id,
            entityId: event.entity_id,
            externalUrl: event.external_url,
            metadata: event.metadata,
          })),
          facts: facts?.map((fact) => ({
            title: fact.title,
            body: fact.body,
            factKey: fact.fact_key,
            source: fact.source,
            sourceUrl: fact.source_url,
            confidence: fact.confidence,
            initiativeId: fact.initiative_id,
            entityId: fact.entity_id,
            documentId: fact.document_id,
            metadata: fact.metadata,
          })),
          authorClient: author_client,
        }),
      ),
  );

  server.registerTool(
    "update_context_document",
    {
      description:
        "Create or replace a canonical current-context markdown document. Uses optimistic concurrency via expected_revision and snapshots old content into history before replacing.",
      inputSchema: z.object({
        project: z.string().optional(),
        path: z.string().optional(),
        title: z.string().optional(),
        markdown: z.string().min(1),
        expected_revision: z.number().int().min(0).optional(),
        author_client: z.string().optional(),
      }),
      annotations: {
        destructiveHint: true,
        idempotentHint: false,
      },
    },
    async ({
      project,
      path,
      title,
      markdown,
      expected_revision,
      author_client,
    }) =>
      textResult(
        await service.updateContextDocument({
          project,
          path,
          title,
          markdown,
          expectedRevision: expected_revision,
          authorClient: author_client,
        }),
      ),
  );

  server.registerTool(
    "record_decision",
    {
      description:
        "Write a new decision record into WorkDrive and enqueue reindexing.",
      inputSchema: z.object({
        project: z.string().optional(),
        title: z.string().min(1),
        markdown: z.string().min(1),
        tags: z.array(z.string()).optional(),
        supersedes_document_ids: z.array(z.string()).optional(),
        author_client: z.string().optional(),
      }),
      annotations: {
        destructiveHint: true,
        idempotentHint: false,
      },
    },
    async ({
      project,
      title,
      markdown,
      tags,
      supersedes_document_ids,
      author_client,
    }) =>
      textResult(
        await service.recordDecision({
          project,
          title,
          markdown,
          tags,
          supersedesDocumentIds: supersedes_document_ids,
          authorClient: author_client,
        }),
      ),
  );

  server.registerTool(
    "reindex_document",
    {
      description:
        "Enqueue a single document for reindexing into Vectorize and D1.",
      inputSchema: z.object({
        document_id: z.string().optional(),
        path: z.string().optional(),
        workdrive_file_id: z.string().optional(),
      }),
      annotations: {
        destructiveHint: true,
        idempotentHint: true,
      },
    },
    async ({ document_id, path, workdrive_file_id }) =>
      textResult(
        await service.reindexDocument({
          documentId: document_id,
          path,
          workdriveFileId: workdrive_file_id,
        }),
      ),
  );

  server.registerTool(
    "admin_reindex_document",
    {
      description:
        "Admin alias for reindex_document. Enqueue a single document for reindexing into Vectorize and D1.",
      inputSchema: z.object({
        document_id: z.string().optional(),
        path: z.string().optional(),
        workdrive_file_id: z.string().optional(),
      }),
      annotations: {
        destructiveHint: true,
        idempotentHint: true,
      },
    },
    async ({ document_id, path, workdrive_file_id }) =>
      textResult(
        await service.reindexDocument({
          documentId: document_id,
          path,
          workdriveFileId: workdrive_file_id,
        }),
      ),
  );

  server.registerTool(
    "reindex_all",
    {
      description:
        "Enqueue a full crawl and reconciliation run across the configured WorkDrive memory roots.",
      inputSchema: z.object({}),
      annotations: {
        destructiveHint: true,
        idempotentHint: true,
      },
    },
    async () => textResult(await service.reindexAll()),
  );

  server.registerTool(
    "admin_reindex_all",
    {
      description:
        "Admin alias for reindex_all. Enqueue a full crawl and reconciliation run across configured WorkDrive memory roots.",
      inputSchema: z.object({}),
      annotations: {
        destructiveHint: true,
        idempotentHint: true,
      },
    },
    async () => textResult(await service.reindexAll()),
  );

  server.registerTool(
    "admin_reconcile_workdrive",
    {
      description:
        "Run WorkDrive reconciliation now: crawl configured roots, enqueue missing/stale Markdown, and report scan counts. Admin-only.",
      inputSchema: z.object({}),
      annotations: {
        destructiveHint: true,
        idempotentHint: true,
      },
    },
    async () => textResult(await service.reconcileWorkDrive()),
  );

  server.registerTool(
    "admin_status",
    {
      description:
        "Return operational status: project counts, queued/failed jobs, last sync, and configured connectivity checks without exposing secrets.",
      inputSchema: z.object({}),
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async () => textResult(await service.adminStatus()),
  );

  server.registerTool(
    "retrieval_diagnostics",
    {
      description:
        "Explain retrieval behavior for a query, including namespaces, filters, vector/keyword hit counts, top results, and ranking rules.",
      inputSchema: z.object({
        query: z.string().min(1),
        project: z.string().optional(),
        repo: z.string().optional(),
        path: z.string().optional(),
      }),
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async ({ query, project, repo, path }) =>
      textResult(await service.retrievalDiagnostics({ query, project, repo, path })),
  );

  return server;
}

function textResult(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}
