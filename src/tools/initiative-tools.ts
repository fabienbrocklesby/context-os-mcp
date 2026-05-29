import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { InitiativeService } from "~/service/InitiativeService";
import {
  assetStatusSchema,
  assetTypeSchema,
  liveSourceKindSchema,
  milestoneStatusSchema,
  prioritySchema,
  proposedWorkSchema,
  sensitivitySchema,
  strategyNodeTypeSchema,
  strategyStatusSchema,
  textResult,
} from "~/tools/schemas";

export function registerInitiativeTools(server: McpServer, svc: InitiativeService) {
  server.registerTool(
    "list_initiatives",
    {
      description: "List structured initiatives, optionally narrowed by project or status.",
      inputSchema: z.object({
        status: z.string().optional(),
        project: z.string().optional(),
        limit: z.number().int().min(1).max(100).optional(),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ status, project, limit }) => textResult(await svc.listInitiatives({ status, project, limit })),
  );

  server.registerTool(
    "get_initiative_context",
    {
      description: "Get an initiative with linked projects, open tasks, durable facts, and recent source events.",
      inputSchema: z.object({ initiative: z.string().min(1) }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ initiative }) => textResult(await svc.getInitiativeContext({ initiative })),
  );

  server.registerTool(
    "upsert_initiative",
    {
      description: "Create or update a large cross-project initiative and optionally link projects to it.",
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
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    async ({ slug, title, summary, status, owner, horizon, priority, starts_at, due_at, tags, metadata, project_slugs }) =>
      textResult(await svc.upsertInitiative({
        slug, title, summary, status, owner, horizon, priority,
        startsAt: starts_at, dueAt: due_at, tags, metadata, projectSlugs: project_slugs,
      })),
  );

  server.registerTool(
    "upsert_vision",
    {
      description: "Create or update a strategic vision, north star, pillar, or measurable outcome.",
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
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    async ({ project, id, slug, type, title, summary, status, parent_id, horizon, priority, metric, starts_at, due_at, review_cadence, tags, metadata }) =>
      textResult(await svc.upsertVision({
        project, id, slug, type, title, summary, status, parentId: parent_id, horizon, priority,
        metric, startsAt: starts_at, dueAt: due_at, reviewCadence: review_cadence, tags, metadata,
      })),
  );

  server.registerTool(
    "list_visions",
    {
      description: "List strategic visions, north stars, pillars, and outcomes, optionally scoped by parent or status.",
      inputSchema: z.object({
        project: z.string().optional(),
        type: strategyNodeTypeSchema.optional(),
        status: strategyStatusSchema.optional(),
        parent_id: z.string().optional(),
        include_children: z.boolean().optional(),
        limit: z.number().int().min(1).max(100).optional(),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ project, type, status, parent_id, include_children, limit }) =>
      textResult(await svc.listVisions({
        project, type, status, parentId: parent_id, includeChildren: include_children, limit,
      })),
  );

  server.registerTool(
    "get_strategy_context",
    {
      description: "Return compact strategic context for a project: visions, pillars, outcomes, initiatives, milestones, assets, branch protocol, and warnings.",
      inputSchema: z.object({
        project_or_topic: z.string().optional(),
        user_intent: z.string().optional(),
        include: z.array(z.enum(["visions", "pillars", "outcomes", "initiatives", "milestones", "assets", "branch_projects"])).optional(),
        horizon: z.string().optional(),
        limit: z.number().int().min(1).max(100).optional(),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ project_or_topic, user_intent, include, horizon, limit }) =>
      textResult(await svc.getStrategyContext({ projectOrTopic: project_or_topic, userIntent: user_intent, include, horizon, limit })),
  );

  server.registerTool(
    "upsert_asset",
    {
      description: "Create or update a reusable strategic asset/resource with live source pointers and usage guidance.",
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
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    async ({ project, id, slug, name, type, summary, status, owner, source, source_id, source_url, live_source_kind, sensitivity, how_to_use, limitations, tags, metadata }) =>
      textResult(await svc.upsertAsset({
        project, id, slug, name, type, summary, status, owner, source,
        sourceId: source_id, sourceUrl: source_url, liveSourceKind: live_source_kind,
        sensitivity, howToUse: how_to_use, limitations, tags, metadata,
      })),
  );

  server.registerTool(
    "list_assets",
    {
      description: "List strategic assets/resources, optionally filtered by project, query, type, or status.",
      inputSchema: z.object({
        project: z.string().optional(),
        query: z.string().optional(),
        type: z.string().optional(),
        status: z.string().optional(),
        include_archived: z.boolean().optional(),
        limit: z.number().int().min(1).max(100).optional(),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ project, query, type, status, include_archived, limit }) =>
      textResult(await svc.listAssets({ project, query, type, status, includeArchived: include_archived, limit })),
  );

  server.registerTool(
    "link_asset",
    {
      description: "Link an asset to a strategy node, initiative, project, milestone, task, branch project, entity, document, or fact.",
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
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    async ({ project, asset_id, to_type, to_id, relation, weight, guidance, metadata }) =>
      textResult(await svc.linkAsset({ project, assetId: asset_id, toType: to_type, toId: to_id, relation, weight, guidance, metadata })),
  );

  server.registerTool(
    "upsert_milestone",
    {
      description: "Create or update a strategic milestone linked to an initiative, project, and/or outcome.",
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
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    async ({ project, id, slug, title, summary, status, initiative_id, project_slug, outcome_id, owner, due_at, completed_at, success_metric, evidence, tags, metadata }) =>
      textResult(await svc.upsertMilestone({
        project, id, slug, title, summary, status, initiativeId: initiative_id,
        projectSlug: project_slug, outcomeId: outcome_id, owner,
        dueAt: due_at, completedAt: completed_at, successMetric: success_metric,
        evidence, tags, metadata,
      })),
  );

  server.registerTool(
    "create_branch_project",
    {
      description: "Create or update a governed short-term branch project/experiment with required hypothesis, timebox, success, merge-back, kill, and risk fields.",
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
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    async ({ project, display_name, description, parent_initiative_id, parent_project_slug, branch_reason, hypothesis, timebox_starts_at, timebox_ends_at, success_metric, risk_to_parent, risk_level, merge_back_condition, kill_condition, assets, tags, metadata }) =>
      textResult(await svc.createBranchProject({
        project, displayName: display_name, description, parentInitiativeId: parent_initiative_id,
        parentProjectSlug: parent_project_slug, branchReason: branch_reason, hypothesis,
        timeboxStartsAt: timebox_starts_at, timeboxEndsAt: timebox_ends_at,
        successMetric: success_metric, riskToParent: risk_to_parent, riskLevel: risk_level,
        mergeBackCondition: merge_back_condition, killCondition: kill_condition,
        assets, tags, metadata,
      })),
  );

  server.registerTool(
    "check_alignment",
    {
      description: "Classify whether proposed work directly advances, supports, risks distraction, conflicts with, or needs more context against active strategy.",
      inputSchema: z.object({
        project_or_topic: z.string().optional(),
        user_intent: z.string().min(1),
        proposed_work: proposedWorkSchema.optional(),
        save: z.boolean().optional(),
      }),
      annotations: { destructiveHint: true, idempotentHint: false },
    },
    async ({ project_or_topic, user_intent, proposed_work, save }) =>
      textResult(await svc.checkAlignment({
        projectOrTopic: project_or_topic, userIntent: user_intent, proposedWork: proposed_work, save,
      })),
  );
}
