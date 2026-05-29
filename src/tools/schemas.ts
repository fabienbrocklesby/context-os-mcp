import { z } from "zod";

export const businessHoursSchema = z.object({
  start: z.string().optional(),
  end: z.string().optional(),
  business_days: z.array(z.number().int().min(1).max(7)).optional(),
});

export const taskProfileSchema = z.enum(["sales_proposal", "code_repo", "daily_priority", "general"]);
export const strategyNodeTypeSchema = z.enum(["vision", "north_star", "strategic_pillar", "outcome"]);
export const strategyStatusSchema = z.enum(["active", "paused", "completed", "archived"]);
export const prioritySchema = z.enum(["low", "normal", "high", "urgent"]);

export const assetTypeSchema = z.enum([
  "document", "repo", "dataset", "system", "credential_reference",
  "process", "contact_group", "budget", "tool", "other",
]);
export const assetStatusSchema = z.enum(["active", "planned", "deprecated", "unavailable", "archived"]);

export const liveSourceKindSchema = z.enum([
  "github", "workdrive", "zoho_crm", "zoho_mail", "calendar", "shopify", "manual", "other",
]);

export const entityTypeToolSchema = z.enum([
  "person", "company", "account", "store", "repo", "product", "supplier", "deal", "project", "other",
]);
export const entityStateStatusToolSchema = z.enum(["active", "superseded", "archived"]);

export const sensitivitySchema = z.enum(["public", "internal", "confidential", "sensitive"]);
export const savePolicySchema = z.enum(["durable_summary", "live_only", "requires_approval"]);

export const capabilityAvailabilitySchema = z.enum([
  "available", "unavailable", "unknown", "user_configured",
]);
export const invocationStyleSchema = z.enum([
  "mcp_tool", "connector", "chatgpt_app", "terminal_command",
  "local_file", "api_call", "manual_instruction", "other",
]);
export const milestoneStatusSchema = z.enum([
  "planned", "active", "blocked", "completed", "missed", "cancelled", "archived",
]);

export const proposedWorkSchema = z.object({
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

export function textResult(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }] };
}
