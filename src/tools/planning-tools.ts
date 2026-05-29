import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { DocumentService } from "~/service/DocumentService";
import type { PlanningService } from "~/service/PlanningService";
import { businessHoursSchema, taskProfileSchema, textResult } from "~/tools/schemas";

export function registerPlanningTools(
  server: McpServer,
  svc: PlanningService,
  docSvc: DocumentService,
) {
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
      annotations: { idempotentHint: true },
    },
    async ({ project_or_topic, user_intent, environment, active_sources, available_tools, timezone, now, business_hours, authoritative, task_profile, response_mode }) =>
      textResult(await svc.prepareAssistantSession({
        projectOrTopic: project_or_topic, userIntent: user_intent, environment,
        activeSources: active_sources, availableTools: available_tools,
        timezone, now, businessHours: business_hours, authoritative,
        taskProfile: task_profile, responseMode: response_mode,
      })),
  );

  server.registerTool(
    "prepare_work_session",
    {
      description: "Best first call for AI clients. Ensures the project exists, returns current context, task-relevant memory, and associated GitHub repos.",
      inputSchema: z.object({
        project: z.string().min(1),
        topic: z.string().optional(),
        authoritative: z.boolean().optional(),
      }),
      annotations: { idempotentHint: true },
    },
    async ({ project, topic, authoritative }) =>
      textResult(await svc.prepareWorkSession({ project, topic, authoritative })),
  );

  server.registerTool(
    "resolve_context",
    {
      description: "Resolve a user topic or project hint into an active project, candidate projects, related project hints, and an explicit project-switching reason.",
      inputSchema: z.object({
        project_or_topic: z.string().optional(),
        user_intent: z.string().optional(),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ project_or_topic, user_intent }) =>
      textResult(await svc.resolveContext({ projectOrTopic: project_or_topic, userIntent: user_intent })),
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
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ project_or_topic, user_intent, environment, active_sources, available_tools, timezone, now, business_hours, include_memory, include_assets, include_active_tasks, task_profile, response_mode }) =>
      textResult(await svc.planRequest({
        projectOrTopic: project_or_topic, userIntent: user_intent, environment,
        activeSources: active_sources, availableTools: available_tools,
        timezone, now, businessHours: business_hours,
        includeMemory: include_memory, includeAssets: include_assets,
        includeActiveTasks: include_active_tasks,
        taskProfile: task_profile, responseMode: response_mode,
      })),
  );

  server.registerTool(
    "daily_briefing",
    {
      description: "Return a proactive daily briefing for due tasks, active initiatives, recent source events, and suggested focus.",
      inputSchema: z.object({
        project: z.string().optional(),
        date: z.string().optional(),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ project, date }) => textResult(await svc.dailyBriefing({ project, date })),
  );

  server.registerTool(
    "context_health_check",
    {
      description: "Check context completeness, retrieval mode, linked initiatives/entities/tasks, and likely freshness gaps for a project.",
      inputSchema: z.object({
        project: z.string().optional(),
        query: z.string().optional(),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ project, query }) => textResult(await svc.contextHealthCheck({ project, query })),
  );

  server.registerTool(
    "bootstrap_project_context",
    {
      description: "Ensure a project exists and create any missing canonical current-context documents: overview, architecture, active goals, constraints, setup/deployment, and repo map.",
      inputSchema: z.object({
        project: z.string().min(1),
        display_name: z.string().optional(),
        description: z.string().optional(),
        author_client: z.string().optional(),
      }),
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    async ({ project, display_name, description, author_client }) =>
      textResult(await docSvc.bootstrapProjectContext({
        project, displayName: display_name, description, authorClient: author_client,
      })),
  );

}
