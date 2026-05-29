import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { ProjectService } from "~/service/ProjectService";
import {
  businessHoursSchema,
  capabilityAvailabilitySchema,
  invocationStyleSchema,
  savePolicySchema,
  sensitivitySchema,
  textResult,
} from "~/tools/schemas";

export function registerProjectTools(server: McpServer, svc: ProjectService) {
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
      annotations: { idempotentHint: true },
    },
    async ({ project, display_name, description, aliases, profile }) =>
      textResult(await svc.ensureProject({ project, displayName: display_name, description, aliases, profile })),
  );

  server.registerTool(
    "list_projects",
    {
      description: "List memory projects known to D1.",
      inputSchema: z.object({
        include_merged: z.boolean().optional(),
        include_archived: z.boolean().optional(),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ include_merged, include_archived }) =>
      textResult(await svc.listProjects({ includeMerged: include_merged, includeArchived: include_archived })),
  );

  server.registerTool(
    "get_project",
    {
      description: "Get project metadata, folder checks, associated GitHub repos, and basic memory stats.",
      inputSchema: z.object({ project: z.string().min(1) }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ project }) => textResult(await svc.getProject({ project })),
  );

  server.registerTool(
    "update_project_profile",
    {
      description: "Update project display metadata, status, aliases, and structured profile JSON.",
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
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    async ({ project, display_name, description, status, aliases, profile, parent_initiative, related_projects, canonical_project, merged_into_project }) =>
      textResult(await svc.updateProjectProfile({
        project, displayName: display_name, description, status, aliases, profile,
        parentInitiative: parent_initiative, relatedProjects: related_projects,
        canonicalProject: canonical_project, mergedIntoProject: merged_into_project,
      })),
  );

  server.registerTool(
    "project_status",
    {
      description: "Report project health from D1 metadata, WorkDrive folder checks, failed jobs, and associated repos.",
      inputSchema: z.object({ project: z.string().min(1) }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ project }) => textResult(await svc.projectStatus({ project })),
  );

  server.registerTool(
    "get_operational_context",
    {
      description: "Return validated time/date/weekday/timezone context, weekend/business-day classification, business-hour status, and public-holiday placeholder state.",
      inputSchema: z.object({
        timezone: z.string().optional(),
        now: z.string().optional(),
        business_hours: businessHoursSchema.optional(),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ timezone, now, business_hours }) =>
      textResult(svc.getOperationalContext({ timezone, now, businessHours: business_hours })),
  );

  server.registerTool(
    "plan_assistant_action",
    {
      description: "Build a deterministic Assistant Context OS action plan with time actionability, request classification, required tools, confirmation guardrails, and write-back recommendations.",
      inputSchema: z.object({
        user_intent: z.string().min(1),
        active_sources: z.array(z.string()).optional(),
        available_tools: z.array(z.string()).optional(),
        timezone: z.string().optional(),
        now: z.string().optional(),
        business_hours: businessHoursSchema.optional(),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ user_intent, active_sources, available_tools, timezone, now, business_hours }) =>
      textResult(svc.planAssistantAction({
        userIntent: user_intent, activeSources: active_sources,
        availableTools: available_tools, timezone, now, businessHours: business_hours,
      })),
  );

  server.registerTool(
    "plan_environment_tool_use",
    {
      description: "Plan environment-aware live checks and tool use for the current AI client without requiring every connector to be built into ContextOS.",
      inputSchema: z.object({
        environment: z.string().optional(),
        user_intent: z.string().min(1),
        project_or_topic: z.string().optional(),
        available_tools: z.array(z.string()).optional(),
        active_sources: z.array(z.string()).optional(),
        proposed_action: z.string().optional(),
        include_instructions: z.boolean().optional(),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ environment, user_intent, project_or_topic, available_tools, active_sources, proposed_action, include_instructions }) =>
      textResult(svc.planEnvironmentToolUse({
        environment, userIntent: user_intent, projectOrTopic: project_or_topic,
        availableTools: available_tools, activeSources: active_sources,
        proposedAction: proposed_action, includeInstructions: include_instructions,
      })),
  );

  server.registerTool(
    "plan_light_lane_live_state_refresh",
    {
      description: "Plan safe read-only Zoho live-state checks and structured write-back for Light Lane current-state work.",
      inputSchema: z.object({
        project: z.string().optional(),
        user_intent: z.string().optional(),
        available_tools: z.array(z.string()).optional(),
        force: z.boolean().optional(),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ project, user_intent, available_tools, force }) =>
      textResult(svc.planLightLaneLiveStateRefresh({
        project, userIntent: user_intent, availableTools: available_tools, force,
      })),
  );

  server.registerTool(
    "plan_zoho_external_write",
    {
      description: "Plan a delegated Zoho write action. ContextOS never mutates Zoho; it points the assistant to a separate write-capable Zoho MCP with confirmation and write-back rules.",
      inputSchema: z.object({
        project: z.string().optional(),
        requested_action: z.string().min(1),
        write_capable_connector_name: z.string().optional(),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ project, requested_action, write_capable_connector_name }) =>
      textResult(svc.planZohoExternalWrite({
        project, requestedAction: requested_action, writeCapableConnectorName: write_capable_connector_name,
      })),
  );

  server.registerTool(
    "list_client_environments",
    {
      description: "List known AI client environments such as Claude, ChatGPT, Codex, generic MCP, and local CLI.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async () => textResult(await svc.listClientEnvironments()),
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
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    async ({ slug, display_name, description, default_tool_style, notes }) =>
      textResult(await svc.upsertClientEnvironment({
        slug, displayName: display_name, description, defaultToolStyle: default_tool_style, notes,
      })),
  );

  server.registerTool(
    "list_tool_capabilities",
    {
      description: "List ContextOS tool capability manifests and policies.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async () => textResult(await svc.listToolCapabilities()),
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
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    async ({ slug, display_name, source_kind, action_kind, source_of_truth, volatile, sensitivity, requires_confirmation, destructive, save_policy, instructions_markdown, input_hints_json, output_hints_json }) =>
      textResult(await svc.upsertToolCapability({
        slug, displayName: display_name, sourceKind: source_kind, actionKind: action_kind,
        sourceOfTruth: source_of_truth, volatile, sensitivity, requiresConfirmation: requires_confirmation,
        destructive, savePolicy: save_policy, instructionsMarkdown: instructions_markdown,
        inputHints: input_hints_json, outputHints: output_hints_json,
      })),
  );

  server.registerTool(
    "list_environment_capabilities",
    {
      description: "List capability availability/invocation manifests for an AI client environment.",
      inputSchema: z.object({ environment: z.string().optional() }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ environment }) => textResult(await svc.listEnvironmentCapabilities({ environment })),
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
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    async ({ environment_slug, capability_slug, availability, invocation_style, tool_name, usage_instructions_markdown, limitations_markdown, priority }) =>
      textResult(await svc.upsertEnvironmentCapability({
        environmentSlug: environment_slug, capabilitySlug: capability_slug, availability,
        invocationStyle: invocation_style, toolName: tool_name,
        usageInstructionsMarkdown: usage_instructions_markdown,
        limitationsMarkdown: limitations_markdown, priority,
      })),
  );
}
