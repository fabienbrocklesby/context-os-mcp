import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { MemoryService } from "~/domain/service";
import type { MemoryPrincipal } from "~/domain/memory";

export function createMemoryMcpServer(env: Env, principal: MemoryPrincipal) {
  const service = new MemoryService(env, principal);
  const server = new McpServer({
    name: "context-os-memory",
    version: "0.1.0",
  });
  const businessHoursSchema = z.object({
    start: z.string().optional(),
    end: z.string().optional(),
    business_days: z.array(z.number().int().min(1).max(7)).optional(),
  });
  const taskProfileSchema = z.enum(["sales_proposal", "code_repo", "daily_priority", "general"]);
  const strategyNodeTypeSchema = z.enum(["vision", "north_star", "strategic_pillar", "outcome"]);
  const strategyStatusSchema = z.enum(["active", "paused", "completed", "archived"]);
  const prioritySchema = z.enum(["low", "normal", "high", "urgent"]);
  const assetTypeSchema = z.enum([
    "document",
    "repo",
    "dataset",
    "system",
    "credential_reference",
    "process",
    "contact_group",
    "budget",
    "tool",
    "other",
  ]);
  const assetStatusSchema = z.enum(["active", "planned", "deprecated", "unavailable", "archived"]);
  const liveSourceKindSchema = z.enum([
    "github",
    "workdrive",
    "zoho_crm",
    "zoho_mail",
    "calendar",
    "shopify",
    "manual",
    "other",
  ]);
  const entityTypeToolSchema = z.enum([
    "person",
    "company",
    "account",
    "store",
    "repo",
    "product",
    "supplier",
    "deal",
    "project",
    "other",
  ]);
  const entityStateStatusToolSchema = z.enum(["active", "superseded", "archived"]);
  const sensitivitySchema = z.enum(["public", "internal", "confidential", "sensitive"]);
  const savePolicySchema = z.enum(["durable_summary", "live_only", "requires_approval"]);
  const capabilityAvailabilitySchema = z.enum(["available", "unavailable", "unknown", "user_configured"]);
  const invocationStyleSchema = z.enum([
    "mcp_tool",
    "connector",
    "chatgpt_app",
    "terminal_command",
    "local_file",
    "api_call",
    "manual_instruction",
    "other",
  ]);
  const milestoneStatusSchema = z.enum([
    "planned",
    "active",
    "blocked",
    "completed",
    "missed",
    "cancelled",
    "archived",
  ]);
  const proposedWorkSchema = z.object({
    title: z.string().optional(),
    summary: z.string().optional(),
    type: z.enum(["task", "project", "branch_project", "milestone", "initiative", "research", "other"]).optional(),
    project_slug: z.string().optional(),
    initiative_id: z.string().optional(),
    milestone_id: z.string().optional(),
    asset_ids: z.array(z.string()).optional(),
    expected_outcome: z.string().optional(),
    estimated_effort: z.enum(["small", "medium", "large", "unknown"]).optional(),
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
      inputSchema: z.object({
        include_merged: z.boolean().optional(),
        include_archived: z.boolean().optional(),
      }),
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async ({ include_merged, include_archived }) =>
      textResult(await service.listProjects({ includeMerged: include_merged, includeArchived: include_archived })),
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
        "Resolve active project/topic and return a compact Assistant Context OS operating brief by default, with actionability, required live checks, relevant excerpts, risks, and write-back plan. Use response_mode=expanded only for deliberate full-material retrieval or legacy diagnostics.",
      inputSchema: z.object({
        project_or_topic: z.string().optional(),
        user_intent: z.string().optional(),
        environment: z.string().optional(),
        active_sources: z.array(z.string()).optional(),
        available_tools: z.array(z.string()).optional(),
        timezone: z.string().optional(),
        now: z.string().optional(),
        business_hours: businessHoursSchema.optional(),
        authoritative: z.boolean().optional(),
        task_profile: taskProfileSchema.optional(),
        response_mode: z.enum(["compact", "expanded"]).optional(),
      }),
      annotations: {
        idempotentHint: true,
      },
    },
    async ({
      project_or_topic,
      user_intent,
      environment,
      active_sources,
      available_tools,
      timezone,
      now,
      business_hours,
      authoritative,
      task_profile,
      response_mode,
    }) =>
      textResult(
        await service.prepareAssistantSession({
          projectOrTopic: project_or_topic,
          userIntent: user_intent,
          environment,
          activeSources: active_sources,
          availableTools: available_tools,
          timezone,
          now,
          businessHours: business_hours,
          authoritative,
          taskProfile: task_profile,
          responseMode: response_mode,
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
    "list_client_environments",
    {
      description: "List known AI client environments such as Claude, ChatGPT, Codex, generic MCP, and local CLI.",
      inputSchema: z.object({}),
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async () => textResult(await service.listClientEnvironments()),
  );

  server.registerTool(
    "upsert_client_environment",
    {
      description: "Create or update an AI client environment manifest.",
      inputSchema: z.object({
        slug: z.string().min(1),
        display_name: z.string().min(1),
        description: z.string().nullable().optional(),
        default_tool_style: z.string().nullable().optional(),
        notes: z.string().nullable().optional(),
      }),
      annotations: {
        destructiveHint: true,
        idempotentHint: true,
      },
    },
    async ({ slug, display_name, description, default_tool_style, notes }) =>
      textResult(
        await service.upsertClientEnvironment({
          slug,
          displayName: display_name,
          description,
          defaultToolStyle: default_tool_style,
          notes,
        }),
      ),
  );

  server.registerTool(
    "list_tool_capabilities",
    {
      description: "List ContextOS tool capability manifests and policies.",
      inputSchema: z.object({}),
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async () => textResult(await service.listToolCapabilities()),
  );

  server.registerTool(
    "upsert_tool_capability",
    {
      description: "Create or update a ContextOS tool capability manifest.",
      inputSchema: z.object({
        slug: z.string().min(1),
        display_name: z.string().min(1),
        source_kind: z.string().min(1),
        action_kind: z.string().min(1),
        source_of_truth: z.boolean().optional(),
        volatile: z.boolean().optional(),
        sensitivity: sensitivitySchema.optional(),
        requires_confirmation: z.boolean().optional(),
        destructive: z.boolean().optional(),
        save_policy: savePolicySchema.optional(),
        instructions_markdown: z.string().nullable().optional(),
        input_hints_json: z.record(z.string(), z.unknown()).optional(),
        output_hints_json: z.record(z.string(), z.unknown()).optional(),
      }),
      annotations: {
        destructiveHint: true,
        idempotentHint: true,
      },
    },
    async ({
      slug,
      display_name,
      source_kind,
      action_kind,
      source_of_truth,
      volatile,
      sensitivity,
      requires_confirmation,
      destructive,
      save_policy,
      instructions_markdown,
      input_hints_json,
      output_hints_json,
    }) =>
      textResult(
        await service.upsertToolCapability({
          slug,
          displayName: display_name,
          sourceKind: source_kind,
          actionKind: action_kind,
          sourceOfTruth: source_of_truth,
          volatile,
          sensitivity,
          requiresConfirmation: requires_confirmation,
          destructive,
          savePolicy: save_policy,
          instructionsMarkdown: instructions_markdown,
          inputHints: input_hints_json,
          outputHints: output_hints_json,
        }),
      ),
  );

  server.registerTool(
    "list_environment_capabilities",
    {
      description: "List capability availability/invocation manifests for an AI client environment.",
      inputSchema: z.object({
        environment: z.string().optional(),
      }),
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async ({ environment }) => textResult(await service.listEnvironmentCapabilities({ environment })),
  );

  server.registerTool(
    "upsert_environment_capability",
    {
      description: "Create or update a capability binding for a client environment.",
      inputSchema: z.object({
        environment_slug: z.string().min(1),
        capability_slug: z.string().min(1),
        availability: capabilityAvailabilitySchema.optional(),
        invocation_style: invocationStyleSchema.optional(),
        tool_name: z.string().nullable().optional(),
        usage_instructions_markdown: z.string().nullable().optional(),
        limitations_markdown: z.string().nullable().optional(),
        priority: z.number().int().optional(),
      }),
      annotations: {
        destructiveHint: true,
        idempotentHint: true,
      },
    },
    async ({
      environment_slug,
      capability_slug,
      availability,
      invocation_style,
      tool_name,
      usage_instructions_markdown,
      limitations_markdown,
      priority,
    }) =>
      textResult(
        await service.upsertEnvironmentCapability({
          environmentSlug: environment_slug,
          capabilitySlug: capability_slug,
          availability,
          invocationStyle: invocation_style,
          toolName: tool_name,
          usageInstructionsMarkdown: usage_instructions_markdown,
          limitationsMarkdown: limitations_markdown,
          priority,
        }),
      ),
  );

  server.registerTool(
    "plan_environment_tool_use",
    {
      description:
        "Plan environment-aware live checks and tool use for the current AI client without requiring every connector to be built into ContextOS.",
      inputSchema: z.object({
        environment: z.string().optional(),
        user_intent: z.string().min(1),
        project_or_topic: z.string().optional(),
        available_tools: z.array(z.string()).optional(),
        active_sources: z.array(z.string()).optional(),
        proposed_action: z.string().optional(),
        include_instructions: z.boolean().optional(),
      }),
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async ({
      environment,
      user_intent,
      project_or_topic,
      available_tools,
      active_sources,
      proposed_action,
      include_instructions,
    }) =>
      textResult(
        service.planEnvironmentToolUse({
          environment,
          userIntent: user_intent,
          projectOrTopic: project_or_topic,
          availableTools: available_tools,
          activeSources: active_sources,
          proposedAction: proposed_action,
          includeInstructions: include_instructions,
        }),
      ),
  );

  server.registerTool(
    "plan_light_lane_live_state_refresh",
    {
      description:
        "Plan safe read-only Zoho live-state checks and structured write-back for Light Lane current-state work.",
      inputSchema: z.object({
        project: z.string().optional(),
        user_intent: z.string().optional(),
        available_tools: z.array(z.string()).optional(),
        force: z.boolean().optional(),
      }),
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async ({ project, user_intent, available_tools, force }) =>
      textResult(
        service.planLightLaneLiveStateRefresh({
          project,
          userIntent: user_intent,
          availableTools: available_tools,
          force,
        }),
      ),
  );

  server.registerTool(
    "plan_zoho_external_write",
    {
      description:
        "Plan a delegated Zoho write action. ContextOS never mutates Zoho; it points the assistant to a separate write-capable Zoho MCP with confirmation and write-back rules.",
      inputSchema: z.object({
        project: z.string().optional(),
        requested_action: z.string().min(1),
        write_capable_connector_name: z.string().optional(),
      }),
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async ({ project, requested_action, write_capable_connector_name }) =>
      textResult(
        service.planZohoExternalWrite({
          project,
          requestedAction: requested_action,
          writeCapableConnectorName: write_capable_connector_name,
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
        task_profile: taskProfileSchema.optional(),
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
      task_profile,
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
        taskProfile: task_profile,
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
    "upsert_vision",
    {
      description:
        "Create or update a strategic vision, north star, pillar, or measurable outcome.",
      inputSchema: z.object({
        project: z.string().optional(),
        id: z.string().optional(),
        slug: z.string().optional(),
        type: strategyNodeTypeSchema,
        title: z.string().min(1),
        summary: z.string().nullable().optional(),
        status: strategyStatusSchema.optional(),
        parent_id: z.string().nullable().optional(),
        horizon: z.string().nullable().optional(),
        priority: prioritySchema.optional(),
        metric: z.object({
          name: z.string().optional(),
          target_value: z.string().optional(),
          current_value: z.string().optional(),
          unit: z.string().optional(),
          direction: z.enum(["increase", "decrease", "maintain", "binary", "qualitative"]).optional(),
        }).optional(),
        starts_at: z.string().nullable().optional(),
        due_at: z.string().nullable().optional(),
        review_cadence: z.string().nullable().optional(),
        tags: z.array(z.string()).optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      }),
      annotations: {
        destructiveHint: true,
        idempotentHint: true,
      },
    },
    async ({
      project,
      id,
      slug,
      type,
      title,
      summary,
      status,
      parent_id,
      horizon,
      priority,
      metric,
      starts_at,
      due_at,
      review_cadence,
      tags,
      metadata,
    }) =>
      textResult(
        await service.upsertVision({
          project,
          id,
          slug,
          type,
          title,
          summary,
          status,
          parentId: parent_id,
          horizon,
          priority,
          metric,
          startsAt: starts_at,
          dueAt: due_at,
          reviewCadence: review_cadence,
          tags,
          metadata,
        }),
      ),
  );

  server.registerTool(
    "list_visions",
    {
      description:
        "List strategic visions, north stars, pillars, and outcomes, optionally scoped by parent or status.",
      inputSchema: z.object({
        project: z.string().optional(),
        type: strategyNodeTypeSchema.optional(),
        status: strategyStatusSchema.optional(),
        parent_id: z.string().optional(),
        include_children: z.boolean().optional(),
        limit: z.number().int().min(1).max(100).optional(),
      }),
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async ({ project, type, status, parent_id, include_children, limit }) =>
      textResult(
        await service.listVisions({
          project,
          type,
          status,
          parentId: parent_id,
          includeChildren: include_children,
          limit,
        }),
      ),
  );

  server.registerTool(
    "get_strategy_context",
    {
      description:
        "Return compact strategic context for a project: visions, pillars, outcomes, initiatives, milestones, assets, branch protocol, and warnings.",
      inputSchema: z.object({
        project_or_topic: z.string().optional(),
        user_intent: z.string().optional(),
        include: z.array(z.enum(["visions", "pillars", "outcomes", "initiatives", "milestones", "assets", "branch_projects"])).optional(),
        horizon: z.string().optional(),
        limit: z.number().int().min(1).max(100).optional(),
      }),
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async ({ project_or_topic, user_intent, include, horizon, limit }) =>
      textResult(
        await service.getStrategyContext({
          projectOrTopic: project_or_topic,
          userIntent: user_intent,
          include,
          horizon,
          limit,
        }),
      ),
  );

  server.registerTool(
    "upsert_asset",
    {
      description:
        "Create or update a reusable strategic asset/resource with live source pointers and usage guidance.",
      inputSchema: z.object({
        project: z.string().optional(),
        id: z.string().optional(),
        slug: z.string().optional(),
        name: z.string().min(1),
        type: assetTypeSchema,
        summary: z.string().nullable().optional(),
        status: assetStatusSchema.optional(),
        owner: z.string().nullable().optional(),
        source: z.string().nullable().optional(),
        source_id: z.string().nullable().optional(),
        source_url: z.string().nullable().optional(),
        live_source_kind: liveSourceKindSchema.optional(),
        sensitivity: sensitivitySchema.optional(),
        how_to_use: z.string().nullable().optional(),
        limitations: z.string().nullable().optional(),
        tags: z.array(z.string()).optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      }),
      annotations: {
        destructiveHint: true,
        idempotentHint: true,
      },
    },
    async ({
      project,
      id,
      slug,
      name,
      type,
      summary,
      status,
      owner,
      source,
      source_id,
      source_url,
      live_source_kind,
      sensitivity,
      how_to_use,
      limitations,
      tags,
      metadata,
    }) =>
      textResult(
        await service.upsertAsset({
          project,
          id,
          slug,
          name,
          type,
          summary,
          status,
          owner,
          source,
          sourceId: source_id,
          sourceUrl: source_url,
          liveSourceKind: live_source_kind,
          sensitivity,
          howToUse: how_to_use,
          limitations,
          tags,
          metadata,
        }),
      ),
  );

  server.registerTool(
    "list_assets",
    {
      description:
        "List strategic assets/resources, optionally filtered by project, query, type, or status.",
      inputSchema: z.object({
        project: z.string().optional(),
        query: z.string().optional(),
        type: z.string().optional(),
        status: z.string().optional(),
        include_archived: z.boolean().optional(),
        limit: z.number().int().min(1).max(100).optional(),
      }),
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async ({ project, query, type, status, include_archived, limit }) =>
      textResult(
        await service.listAssets({
          project,
          query,
          type,
          status,
          includeArchived: include_archived,
          limit,
        }),
      ),
  );

  server.registerTool(
    "link_asset",
    {
      description:
        "Link an asset to a strategy node, initiative, project, milestone, task, branch project, entity, document, or fact.",
      inputSchema: z.object({
        project: z.string().optional(),
        asset_id: z.string().min(1),
        to_type: z.enum(["strategy_node", "initiative", "project", "milestone", "task", "branch_project", "entity", "document", "fact"]),
        to_id: z.string().min(1),
        relation: z.enum(["supports", "required_for", "used_by", "source_for", "blocks", "documents", "measures"]),
        weight: z.number().min(0).max(10).optional(),
        guidance: z.string().optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      }),
      annotations: {
        destructiveHint: true,
        idempotentHint: true,
      },
    },
    async ({ project, asset_id, to_type, to_id, relation, weight, guidance, metadata }) =>
      textResult(
        await service.linkAsset({
          project,
          assetId: asset_id,
          toType: to_type,
          toId: to_id,
          relation,
          weight,
          guidance,
          metadata,
        }),
      ),
  );

  server.registerTool(
    "upsert_milestone",
    {
      description:
        "Create or update a strategic milestone linked to an initiative, project, and/or outcome.",
      inputSchema: z.object({
        project: z.string().optional(),
        id: z.string().optional(),
        slug: z.string().optional(),
        title: z.string().min(1),
        summary: z.string().nullable().optional(),
        status: milestoneStatusSchema.optional(),
        initiative_id: z.string().nullable().optional(),
        project_slug: z.string().nullable().optional(),
        outcome_id: z.string().nullable().optional(),
        owner: z.string().nullable().optional(),
        due_at: z.string().nullable().optional(),
        completed_at: z.string().nullable().optional(),
        success_metric: z.string().nullable().optional(),
        evidence: z.string().nullable().optional(),
        tags: z.array(z.string()).optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      }),
      annotations: {
        destructiveHint: true,
        idempotentHint: true,
      },
    },
    async ({
      project,
      id,
      slug,
      title,
      summary,
      status,
      initiative_id,
      project_slug,
      outcome_id,
      owner,
      due_at,
      completed_at,
      success_metric,
      evidence,
      tags,
      metadata,
    }) =>
      textResult(
        await service.upsertMilestone({
          project,
          id,
          slug,
          title,
          summary,
          status,
          initiativeId: initiative_id,
          projectSlug: project_slug,
          outcomeId: outcome_id,
          owner,
          dueAt: due_at,
          completedAt: completed_at,
          successMetric: success_metric,
          evidence,
          tags,
          metadata,
        }),
      ),
  );

  server.registerTool(
    "create_branch_project",
    {
      description:
        "Create or update a governed short-term branch project/experiment with required hypothesis, timebox, success, merge-back, kill, and risk fields.",
      inputSchema: z.object({
        project: z.string().min(1),
        display_name: z.string().optional(),
        description: z.string().optional(),
        parent_initiative_id: z.string().min(1),
        parent_project_slug: z.string().nullable().optional(),
        branch_reason: z.string().min(1),
        hypothesis: z.string().min(1),
        timebox_starts_at: z.string().min(1),
        timebox_ends_at: z.string().min(1),
        success_metric: z.string().min(1),
        risk_to_parent: z.string().min(1),
        risk_level: z.enum(["low", "medium", "high", "critical"]),
        merge_back_condition: z.string().min(1),
        kill_condition: z.string().min(1),
        assets: z.array(z.string()).optional(),
        tags: z.array(z.string()).optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
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
      parent_initiative_id,
      parent_project_slug,
      branch_reason,
      hypothesis,
      timebox_starts_at,
      timebox_ends_at,
      success_metric,
      risk_to_parent,
      risk_level,
      merge_back_condition,
      kill_condition,
      assets,
      tags,
      metadata,
    }) =>
      textResult(
        await service.createBranchProject({
          project,
          displayName: display_name,
          description,
          parentInitiativeId: parent_initiative_id,
          parentProjectSlug: parent_project_slug,
          branchReason: branch_reason,
          hypothesis,
          timeboxStartsAt: timebox_starts_at,
          timeboxEndsAt: timebox_ends_at,
          successMetric: success_metric,
          riskToParent: risk_to_parent,
          riskLevel: risk_level,
          mergeBackCondition: merge_back_condition,
          killCondition: kill_condition,
          assets,
          tags,
          metadata,
        }),
      ),
  );

  server.registerTool(
    "check_alignment",
    {
      description:
        "Classify whether proposed work directly advances, supports, risks distraction, conflicts with, or needs more context against active strategy.",
      inputSchema: z.object({
        project_or_topic: z.string().optional(),
        user_intent: z.string().min(1),
        proposed_work: proposedWorkSchema.optional(),
        save: z.boolean().optional(),
      }),
      annotations: {
        destructiveHint: true,
        idempotentHint: false,
      },
    },
    async ({ project_or_topic, user_intent, proposed_work, save }) =>
      textResult(
        await service.checkAlignment({
          projectOrTopic: project_or_topic,
          userIntent: user_intent,
          proposedWork: proposed_work,
          save,
        }),
      ),
  );

  server.registerTool(
    "plan_request",
    {
      description:
        "Main planning tool for 'How do I achieve X?' or 'What should I do next?'. Returns a compact planning pack by default with memory, strategy, actionability, required live checks, and a request plan. Use response_mode=expanded only for deliberate detailed retrieval or legacy diagnostics.",
      inputSchema: z.object({
        project_or_topic: z.string().optional(),
        user_intent: z.string().min(1),
        environment: z.string().optional(),
        active_sources: z.array(z.string()).optional(),
        available_tools: z.array(z.string()).optional(),
        timezone: z.string().optional(),
        now: z.string().optional(),
        business_hours: businessHoursSchema.optional(),
        include_memory: z.boolean().optional(),
        include_assets: z.boolean().optional(),
        include_active_tasks: z.boolean().optional(),
        task_profile: taskProfileSchema.optional(),
        response_mode: z.enum(["compact", "expanded"]).optional(),
      }),
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async ({
      project_or_topic,
      user_intent,
      environment,
      active_sources,
      available_tools,
      timezone,
      now,
      business_hours,
      include_memory,
      include_assets,
      include_active_tasks,
      task_profile,
      response_mode,
    }) =>
      textResult(
        await service.planRequest({
          projectOrTopic: project_or_topic,
          userIntent: user_intent,
          environment,
          activeSources: active_sources,
          availableTools: available_tools,
          timezone,
          now,
          businessHours: business_hours,
          includeMemory: include_memory,
          includeAssets: include_assets,
          includeActiveTasks: include_active_tasks,
          taskProfile: task_profile,
          responseMode: response_mode,
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
    "upsert_entity_state",
    {
      description:
        "Create or update a structured current-state record for an entity. Supersedes the prior active value for the same entity/state key without deleting history.",
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
      annotations: {
        destructiveHint: true,
        idempotentHint: true,
      },
    },
    async ({
      project,
      entity_id,
      entity_type,
      entity_name,
      entity_slug,
      entity_summary,
      aliases,
      state_key,
      value,
      confidence,
      source,
      source_id,
      source_event_id,
      valid_from,
      valid_until,
      observed_at,
      status,
    }) =>
      textResult(
        await service.upsertEntityState({
          project,
          entityId: entity_id,
          entityType: entity_type,
          entityName: entity_name,
          entitySlug: entity_slug,
          entitySummary: entity_summary,
          aliases,
          stateKey: state_key,
          value,
          confidence,
          source,
          sourceId: source_id,
          sourceEventId: source_event_id,
          validFrom: valid_from,
          validUntil: valid_until,
          observedAt: observed_at,
          status,
        }),
      ),
  );

  server.registerTool(
    "get_entity_current_state",
    {
      description:
        "Fetch active structured current-state values for an entity by id or query, optionally including superseded history.",
      inputSchema: z.object({
        project: z.string().optional(),
        entity_id: z.string().optional(),
        query: z.string().optional(),
        include_superseded: z.boolean().optional(),
      }),
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async ({ project, entity_id, query, include_superseded }) =>
      textResult(
        await service.getEntityCurrentState({
          project,
          entityId: entity_id,
          query,
          includeSuperseded: include_superseded,
        }),
      ),
  );

  server.registerTool(
    "resolve_current_truth",
    {
      description:
        "Resolve exact entity aliases, active entity states, stale-memory guardrails, and required live checks for a current-state query.",
      inputSchema: z.object({
        project: z.string().optional(),
        query: z.string().min(1),
        include_superseded: z.boolean().optional(),
        limit: z.number().int().min(1).max(50).optional(),
      }),
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async ({ project, query, include_superseded, limit }) =>
      textResult(
        await service.resolveCurrentTruth({
          project,
          query,
          includeSuperseded: include_superseded,
          limit,
        }),
      ),
  );

  server.registerTool(
    "analyze_context_truth_migration",
    {
      description:
        "Dry-run analysis for Context Truth Engine migration. Counts existing docs/entities/facts and proposes non-destructive alias/state review actions.",
      inputSchema: z.object({
        project: z.string().optional(),
      }),
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async ({ project }) => textResult(await service.analyzeContextTruthMigration({ project })),
  );

  server.registerTool(
    "run_context_truth_migration",
    {
      description:
        "Run the non-destructive Context Truth Engine migration. Defaults to dry-run unless apply=true and dry_run=false.",
      inputSchema: z.object({
        project: z.string().optional(),
        dry_run: z.boolean().optional(),
        apply: z.boolean().optional(),
      }),
      annotations: {
        destructiveHint: true,
        idempotentHint: true,
      },
    },
    async ({ project, dry_run, apply }) =>
      textResult(await service.runContextTruthMigration({ project, dryRun: dry_run, apply })),
  );

  server.registerTool(
    "import_ai_brain_vault",
    {
      description:
        "Import an approved AI Brain/Obsidian vault payload as structured memory. The deployed server accepts client-supplied files and defaults to dry-run.",
      inputSchema: z.object({
        project: z.string().optional(),
        vault_name: z.string().optional(),
        files: z.array(z.object({
          path: z.string().min(1),
          markdown: z.string(),
        })),
        manifest: z.record(z.string(), z.unknown()).optional(),
        retrieval_map: z.record(z.string(), z.unknown()).optional(),
        dry_run: z.boolean().optional(),
        apply: z.boolean().optional(),
        preserve_wikilinks: z.boolean().optional(),
        apply_links: z.boolean().optional(),
        current_context_priorities: z.array(z.string()).optional(),
        author_client: z.string().optional(),
      }),
      annotations: {
        destructiveHint: true,
        idempotentHint: true,
      },
    },
    async ({
      project,
      vault_name,
      files,
      manifest,
      retrieval_map,
      dry_run,
      apply,
      preserve_wikilinks,
      apply_links,
      current_context_priorities,
      author_client,
    }) =>
      textResult(
        await service.importAiBrainVault({
          project,
          vaultName: vault_name,
          files,
          manifest,
          retrievalMap: retrieval_map,
          dryRun: dry_run,
          apply,
          preserveWikilinks: preserve_wikilinks,
          applyLinks: apply_links,
          currentContextPriorities: current_context_priorities,
          authorClient: author_client,
        }),
      ),
  );

  const lightLaneKnownDealUpdateSchema = z.object({
    entity_name: z.string().min(1),
    source: z.string().min(1),
    confidence: z.number().min(0).max(1).optional(),
    summary: z.string().optional(),
    states: z.record(
      z.string(),
      z.union([z.string(), z.number(), z.boolean(), z.null()]),
    ),
  });

  const lightLaneRecoverySchema = z.object({
    ai_brain_files: z.array(z.object({
      path: z.string().min(1),
      markdown: z.string(),
    })).optional(),
    ai_brain_analysis: z.record(z.string(), z.unknown()).optional(),
    associated_repos: z.array(z.string()).optional(),
    known_deal_updates: z.array(lightLaneKnownDealUpdateSchema).optional(),
  });

  server.registerTool(
    "analyze_light_lane_memory_recovery",
    {
      description:
        "Read-only Light Lane memory recovery analysis. Plans AI Brain import, canonical project current-context docs, stale shared deal routing, shared archive actions, and repo coverage without writing.",
      inputSchema: lightLaneRecoverySchema,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async ({ ai_brain_files, ai_brain_analysis, associated_repos, known_deal_updates }) =>
      textResult(
        await service.analyzeLightLaneMemoryRecovery({
          aiBrainFiles: ai_brain_files,
          aiBrainAnalysis: ai_brain_analysis,
          associatedRepos: associated_repos,
          knownDealUpdates: known_deal_updates?.map((update) => ({
            entityName: update.entity_name,
            source: update.source,
            confidence: update.confidence,
            summary: update.summary,
            states: update.states,
          })),
        }),
      ),
  );

  server.registerTool(
    "run_light_lane_memory_recovery",
    {
      description:
        "Run Light Lane memory recovery. Defaults to dry-run; apply=true and dry_run=false imports the AI Brain, writes canonical Light Lane current context, upserts stale deal entity states, archives shared originals, and associates/indexes visible Light Lane repos.",
      inputSchema: lightLaneRecoverySchema.extend({
        dry_run: z.boolean().optional(),
        apply: z.boolean().optional(),
        apply_phases: z.array(z.enum([
          "ai_brain",
          "current_context",
          "entity_state",
          "archive",
          "repo_associate",
          "repo_index",
        ])).optional(),
        author_client: z.string().optional(),
      }),
      annotations: {
        destructiveHint: true,
        idempotentHint: true,
      },
    },
    async ({
      ai_brain_files,
      ai_brain_analysis,
      associated_repos,
      known_deal_updates,
      dry_run,
      apply,
      apply_phases,
      author_client,
    }) =>
      textResult(
        await service.runLightLaneMemoryRecovery({
          aiBrainFiles: ai_brain_files,
          aiBrainAnalysis: ai_brain_analysis,
          associatedRepos: associated_repos,
          knownDealUpdates: known_deal_updates?.map((update) => ({
            entityName: update.entity_name,
            source: update.source,
            confidence: update.confidence,
            summary: update.summary,
            states: update.states,
          })),
          dryRun: dry_run,
          apply,
          applyPhases: apply_phases,
          authorClient: author_client,
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
    "archive_memory_document",
    {
      description:
        "Admin-only: overwrite an existing WorkDrive Markdown memory document with an archived marker, reindex it inactive, and preserve the original content inside the archived file.",
      inputSchema: z.object({
        document_id: z.string().optional(),
        path: z.string().optional(),
        workdrive_file_id: z.string().optional(),
        archived_to_path: z.string().optional(),
        reason: z.string().min(1),
        author_client: z.string().optional(),
      }),
      annotations: {
        destructiveHint: true,
        idempotentHint: false,
      },
    },
    async ({
      document_id,
      path,
      workdrive_file_id,
      archived_to_path,
      reason,
      author_client,
    }) =>
      textResult(
        await service.archiveMemoryDocument({
          documentId: document_id,
          path,
          workdriveFileId: workdrive_file_id,
          archivedToPath: archived_to_path,
          reason,
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
    "analyze_memory_migration",
    {
      description:
        "Read-only analysis of duplicate projects, stale/placeholder context, supersession/link gaps, and vector indexing gaps. Never writes.",
      inputSchema: z.object({
        project: z.string().optional(),
        include_markdown_links: z.boolean().optional(),
      }),
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async ({ project, include_markdown_links }) =>
      textResult(await service.analyzeMemoryMigration({ project, includeMarkdownLinks: include_markdown_links })),
  );

  server.registerTool(
    "run_memory_migration",
    {
      description:
        "Run non-destructive memory migration. Defaults to dry-run; apply=true only writes metadata-safe aliases, canonical markers, links, and audit/source events.",
      inputSchema: z.object({
        dry_run: z.boolean().optional(),
        apply: z.boolean().optional(),
        project: z.string().optional(),
      }),
      annotations: {
        destructiveHint: true,
        idempotentHint: true,
      },
    },
    async ({ dry_run, apply, project }) =>
      textResult(await service.runMemoryMigration({ dryRun: dry_run, apply, project })),
  );

  server.registerTool(
    "get_migration_audit",
    {
      description: "List migration audit events written by ContextOS migration/reconciliation tools.",
      inputSchema: z.object({
        migration_slug: z.string().optional(),
        limit: z.number().int().positive().optional(),
      }),
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async ({ migration_slug, limit }) =>
      textResult(await service.getMigrationAudit({ migrationSlug: migration_slug, limit })),
  );

  server.registerTool(
    "analyze_workdrive_canonicalization",
    {
      description:
        "Read-only WorkDrive/Obsidian-visible canonicalization analysis. Produces a manifest for archive-copy, redirect, D1 marker, graph link, and reindex actions without writing.",
      inputSchema: z.object({
        canonical_project: z.string().optional(),
        duplicate_project: z.string().optional(),
        include_shared_duplicates: z.boolean().optional(),
      }),
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async ({ canonical_project, duplicate_project, include_shared_duplicates }) =>
      textResult(
        await service.analyzeWorkdriveCanonicalization({
          canonicalProject: canonical_project,
          duplicateProject: duplicate_project,
          includeSharedDuplicates: include_shared_duplicates,
        }),
      ),
  );

  server.registerTool(
    "run_workdrive_canonicalization",
    {
      description:
        "Run second-phase non-destructive WorkDrive-visible canonicalization. Defaults to dry-run; apply=true archive-copies Markdown, writes redirect files, marks duplicate docs archived, refreshes vector metadata inactive, and audits everything.",
      inputSchema: z.object({
        canonical_project: z.string().optional(),
        duplicate_project: z.string().optional(),
        dry_run: z.boolean().optional(),
        apply: z.boolean().optional(),
        include_shared_duplicates: z.boolean().optional(),
      }),
      annotations: {
        destructiveHint: true,
        idempotentHint: true,
      },
    },
    async ({ canonical_project, duplicate_project, dry_run, apply, include_shared_duplicates }) =>
      textResult(
        await service.runWorkdriveCanonicalization({
          canonicalProject: canonical_project,
          duplicateProject: duplicate_project,
          dryRun: dry_run,
          apply,
          includeSharedDuplicates: include_shared_duplicates,
        }),
      ),
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
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async ({ migration_slug, canonical_project, duplicate_project, limit }) =>
      textResult(
        await service.getWorkdriveCanonicalizationManifest({
          migrationSlug: migration_slug,
          canonicalProject: canonical_project,
          duplicateProject: duplicate_project,
          limit,
        }),
      ),
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

  server.registerTool(
    "upsert_situation",
    {
      description:
        "Create or update the cross-initiative situational awareness document. Include your current financial position, location, top priorities this week, and key constraints. The AI reads this first on every session to enable intelligent cross-initiative advice.",
      inputSchema: z.object({
        financial_position: z
          .string()
          .optional()
          .describe("Current financial position, e.g. 'Cash tight, need $X by end of month'"),
        location: z.string().optional().describe("Where you are and where you're going"),
        top_priorities: z
          .array(z.string())
          .optional()
          .describe("Your top 3-5 priorities this week across all initiatives"),
        key_constraints: z
          .array(z.string())
          .optional()
          .describe("Constraints limiting your options right now"),
        active_initiatives: z
          .array(z.string())
          .optional()
          .describe("Which initiatives are actively in play right now"),
        notes: z.string().optional().describe("Any other situational context worth capturing"),
      }),
    },
    async (input) => {
      const result = await service.setSituationDocument(input);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.registerTool(
    "set_entity_actionability",
    {
      description:
        "Set the actionability of an entity state without replacing the full state. Use this when a deal is blocked, waiting, or ready — so planning queries surface only what you can actually act on.",
      inputSchema: z.object({
        project: z.string().describe("Project slug the entity belongs to"),
        entity_slug: z.string().describe("Slug of the entity to update"),
        state_key: z
          .string()
          .describe("The state key to update, e.g. 'deal_stage', 'project_status'"),
        actionability: z
          .enum(["active", "ready", "waiting", "blocked", "unknown"])
          .describe(
            "active: being worked now; ready: can act on it; waiting: waiting on external input; blocked: hard blocker exists; unknown: not assessed",
          ),
        resolve_after: z
          .string()
          .optional()
          .describe(
            "ISO date after which to re-evaluate (e.g. 2026-12-01 for a deal blocked until December)",
          ),
        reason: z
          .string()
          .optional()
          .describe("Why this actionability state — recorded for your own reference"),
      }),
    },
    async (input) => {
      const result = await service.setEntityActionability({
        project: input.project,
        entitySlug: input.entity_slug,
        stateKey: input.state_key,
        actionability: input.actionability,
        resolveAfter: input.resolve_after,
        reason: input.reason,
      });
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  return server;
}

function textResult(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(value),
      },
    ],
  };
}
