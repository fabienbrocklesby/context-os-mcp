import { z } from "zod";
import YAML from "yaml";

export const memoryTypeSchema = z.enum([
  "current_context",
  "historical_note",
  "decision",
  "session_summary",
  "snippet",
  "repo_index",
]);

export const memoryStatusSchema = z.enum([
  "active",
  "historical",
  "superseded",
  "archived",
]);

export const frontmatterSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  project: z.string().min(1),
  memory_type: memoryTypeSchema,
  status: memoryStatusSchema,
  revision: z.number().int().min(1),
  tags: z.array(z.string()).default([]),
  created_at: z.string().min(1),
  updated_at: z.string().min(1),
  author_client: z.string().min(1),
  source: z.string().optional(),
  source_urls: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1).optional(),
  usefulness: z.number().min(0).max(1).optional(),
  repo: z.string().optional(),
  path: z.string().optional(),
  supersedes: z.array(z.string()).default([]),
  superseded_by: z.array(z.string()).default([]),
  canonical: z.boolean().default(false),
});

export type MemoryFrontmatter = z.infer<typeof frontmatterSchema>;
export type MemoryType = z.infer<typeof memoryTypeSchema>;
export type MemoryStatus = z.infer<typeof memoryStatusSchema>;

export type ParsedMarkdownDocument = {
  frontmatter: MemoryFrontmatter;
  body: string;
};

export type MemoryPrincipal = {
  authType: "bearer" | "oauth" | "anonymous";
  userId: string;
  login: string;
  email?: string;
  displayName?: string;
};

export type MemorySearchFilters = {
  project?: string;
  memoryTypes?: MemoryType[];
  statuses?: MemoryStatus[];
  includeSuperseded?: boolean;
  activeOnly?: boolean;
  repo?: string;
  path?: string;
  source?: string;
  tags?: string[];
};

export type MemorySearchHit = {
  documentId: string;
  snapshotId: string;
  vectorId: string;
  title: string;
  path: string;
  project: string;
  namespace: string;
  workdriveFileId: string;
  memoryType: MemoryType;
  status: MemoryStatus;
  active: boolean;
  superseded: boolean;
  revision: number;
  repo?: string;
  repoPath?: string;
  tags?: string[];
  source?: string;
  confidence?: number;
  usefulness?: number;
  headingPath: string;
  chunkIndex: number;
  chunkText: string;
  score: number;
  updatedAtUnix: number;
  url?: string;
};

export type ResolvedMemoryDocument = {
  id: string;
  workdriveFileId: string;
  currentSnapshotId: string | null;
  path: string;
  title: string;
  project: string;
  namespace: string;
  parentFolderId: string;
  fileName: string;
  permalink: string | null;
  downloadUrl: string | null;
  memoryType: MemoryType;
  status: MemoryStatus;
  canonical: boolean;
  active: boolean;
  revision: number;
  source?: string | null;
  sourceUrl?: string | null;
  repo?: string | null;
  repoPath?: string | null;
  tags: string[];
  confidence?: number | null;
  usefulness?: number | null;
  supersededByDocumentId?: string | null;
  rawMarkdown?: string;
  bodyMarkdown?: string;
  frontmatter?: MemoryFrontmatter;
  lastRemoteModifiedAt?: number | null;
};

export type ChunkRecord = {
  vectorId: string;
  chunkIndex: number;
  headingPath: string;
  content: string;
  tokenEstimate: number;
  updatedAtUnix: number;
};

export type ProjectStatus = "active" | "paused" | "archived";

export type MemoryProject = {
  slug: string;
  displayName: string;
  description: string | null;
  status: ProjectStatus;
  profile: Record<string, unknown>;
  ownerLogin: string | null;
  shared: boolean;
  workdriveRootFolderId: string | null;
  contextCurrentFolderId: string | null;
  contextHistoryFolderId: string | null;
  decisionsFolderId: string | null;
  sessionsFolderId: string | null;
  snippetsFolderId: string | null;
  repoIndexFolderId: string | null;
  lastHealth: Record<string, unknown> | null;
  canonicalProject?: string | null;
  mergedIntoProject?: string | null;
  noncanonicalReason?: string | null;
  canonicalStatus?: string | null;
  canonicalUpdatedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ClientEnvironment = {
  id: string;
  slug: string;
  displayName: string;
  description: string | null;
  defaultToolStyle: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ToolCapability = {
  id: string;
  slug: string;
  displayName: string;
  sourceKind: string;
  actionKind: string;
  sourceOfTruth: boolean;
  volatile: boolean;
  sensitivity: "public" | "internal" | "confidential" | "sensitive";
  requiresConfirmation: boolean;
  destructive: boolean;
  savePolicy: "durable_summary" | "live_only" | "requires_approval";
  instructionsMarkdown: string | null;
  inputHints: Record<string, unknown>;
  outputHints: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type EnvironmentCapability = {
  id: string;
  environmentSlug: string;
  capabilitySlug: string;
  availability: "available" | "unavailable" | "unknown" | "user_configured";
  invocationStyle:
    | "mcp_tool"
    | "connector"
    | "chatgpt_app"
    | "terminal_command"
    | "local_file"
    | "api_call"
    | "manual_instruction"
    | "other";
  toolName: string | null;
  usageInstructionsMarkdown: string | null;
  limitationsMarkdown: string | null;
  priority: number;
  createdAt: string;
  updatedAt: string;
};

export type MigrationAuditEvent = {
  id: string;
  migrationSlug: string;
  phase: string;
  dryRun: boolean;
  status: string;
  summary: string;
  counts: Record<string, unknown>;
  createdAt: string;
};

export type ProjectGithubRepo = {
  id: string;
  projectSlug: string;
  repoFullName: string;
  defaultBranch: string | null;
  visibility: string | null;
  htmlUrl: string | null;
  description: string | null;
  associatedBy: string | null;
  associatedAt: string;
  lastIndexedAt: string | null;
  status: string;
};

export const assistantSearchScopeSchema = z.enum([
  "project",
  "initiative",
  "entity",
  "all_related",
]);

export type AssistantSearchScope = z.infer<typeof assistantSearchScopeSchema>;

export const initiativeStatusSchema = z.enum([
  "active",
  "paused",
  "completed",
  "archived",
]);

export const entityTypeSchema = z.enum([
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

export const taskStatusSchema = z.enum([
  "open",
  "in_progress",
  "blocked",
  "done",
  "cancelled",
]);

export const taskPrioritySchema = z.enum(["low", "normal", "high", "urgent"]);

export const sourceSensitivitySchema = z.enum([
  "public",
  "internal",
  "confidential",
  "sensitive",
]);

export const sourceSavePolicySchema = z.enum([
  "durable_summary",
  "live_only",
  "requires_approval",
]);

export const strategyNodeTypeSchema = z.enum([
  "vision",
  "north_star",
  "strategic_pillar",
  "outcome",
]);

export const assetTypeSchema = z.enum([
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

export const assetStatusSchema = z.enum([
  "active",
  "planned",
  "deprecated",
  "unavailable",
  "archived",
]);

export const liveSourceKindSchema = z.enum([
  "github",
  "workdrive",
  "zoho_crm",
  "zoho_mail",
  "calendar",
  "shopify",
  "manual",
  "other",
]);

export const milestoneStatusSchema = z.enum([
  "planned",
  "active",
  "blocked",
  "completed",
  "missed",
  "cancelled",
  "archived",
]);

export const branchRiskLevelSchema = z.enum([
  "low",
  "medium",
  "high",
  "critical",
]);

export const branchProjectStatusSchema = z.enum([
  "proposed",
  "active",
  "merge_back",
  "killed",
  "completed",
  "archived",
]);

export const alignmentLabelSchema = z.enum([
  "directly_advances",
  "indirectly_supports",
  "neutral_experiment",
  "distraction_risk",
  "conflicts",
  "unknown_until_more_context",
]);

export const alignmentConfidenceSchema = z.enum(["low", "medium", "high"]);

export type InitiativeStatus = z.infer<typeof initiativeStatusSchema>;
export type EntityType = z.infer<typeof entityTypeSchema>;
export type TaskStatus = z.infer<typeof taskStatusSchema>;
export type TaskPriority = z.infer<typeof taskPrioritySchema>;
export type SourceSensitivity = z.infer<typeof sourceSensitivitySchema>;
export type SourceSavePolicy = z.infer<typeof sourceSavePolicySchema>;
export type StrategyNodeType = z.infer<typeof strategyNodeTypeSchema>;
export type AssetType = z.infer<typeof assetTypeSchema>;
export type AssetStatus = z.infer<typeof assetStatusSchema>;
export type LiveSourceKind = z.infer<typeof liveSourceKindSchema>;
export type MilestoneStatus = z.infer<typeof milestoneStatusSchema>;
export type BranchRiskLevel = z.infer<typeof branchRiskLevelSchema>;
export type BranchProjectStatus = z.infer<typeof branchProjectStatusSchema>;
export type AlignmentLabel = z.infer<typeof alignmentLabelSchema>;
export type AlignmentConfidence = z.infer<typeof alignmentConfidenceSchema>;

export type MemoryInitiative = {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  status: InitiativeStatus;
  owner: string | null;
  horizon: string | null;
  priority: TaskPriority;
  startsAt: string | null;
  dueAt: string | null;
  tags: string[];
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type InitiativeProject = {
  initiativeId: string;
  projectSlug: string;
  role: string | null;
  status: string;
  createdAt: string;
};

export type MemoryEntity = {
  id: string;
  project: string;
  type: EntityType;
  slug: string;
  name: string;
  summary: string | null;
  source: string | null;
  sourceId: string | null;
  confidence: number | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type DurableFact = {
  id: string;
  project: string;
  title: string;
  body: string;
  factKey: string | null;
  status: "active" | "superseded" | "archived";
  source: string | null;
  sourceUrl: string | null;
  confidence: number | null;
  initiativeId: string | null;
  entityId: string | null;
  documentId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type ContextTask = {
  id: string;
  project: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueAt: string | null;
  owner: string | null;
  initiativeId: string | null;
  entityId: string | null;
  source: string | null;
  sourceUrl: string | null;
  reminderAt: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type SourceEvent = {
  id: string;
  project: string;
  source: string;
  sourceId: string | null;
  eventType: string;
  occurredAt: string | null;
  title: string;
  summary: string;
  sensitivity: SourceSensitivity;
  savePolicy: SourceSavePolicy;
  initiativeId: string | null;
  entityId: string | null;
  externalUrl: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type MemoryLink = {
  id: string;
  project: string;
  fromType: string;
  fromId: string;
  toType: string;
  toId: string;
  relation: string;
  weight: number;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type StrategyNode = {
  id: string;
  project: string;
  slug: string;
  type: StrategyNodeType;
  title: string;
  summary: string | null;
  status: InitiativeStatus;
  parentId: string | null;
  horizon: string | null;
  priority: TaskPriority;
  metricName: string | null;
  targetValue: string | null;
  currentValue: string | null;
  metricUnit: string | null;
  metricDirection: "increase" | "decrease" | "maintain" | "binary" | "qualitative" | null;
  startsAt: string | null;
  dueAt: string | null;
  reviewCadence: string | null;
  tags: string[];
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type StrategyAsset = {
  id: string;
  project: string;
  slug: string;
  name: string;
  type: AssetType;
  summary: string | null;
  status: AssetStatus;
  owner: string | null;
  source: string | null;
  sourceId: string | null;
  sourceUrl: string | null;
  liveSourceKind: LiveSourceKind | null;
  sensitivity: SourceSensitivity;
  howToUse: string | null;
  limitations: string | null;
  tags: string[];
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type StrategyMilestone = {
  id: string;
  project: string;
  slug: string;
  title: string;
  summary: string | null;
  status: MilestoneStatus;
  initiativeId: string | null;
  projectSlug: string | null;
  outcomeId: string | null;
  owner: string | null;
  dueAt: string | null;
  completedAt: string | null;
  successMetric: string | null;
  evidence: string | null;
  tags: string[];
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type BranchProject = {
  id: string;
  projectSlug: string;
  parentInitiativeId: string;
  parentProjectSlug: string | null;
  branchReason: string;
  hypothesis: string;
  timeboxStartsAt: string;
  timeboxEndsAt: string;
  successMetric: string;
  riskToParent: string;
  riskLevel: BranchRiskLevel;
  mergeBackCondition: string;
  killCondition: string;
  status: BranchProjectStatus;
  decisionLog: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type AlignmentAssessment = {
  id: string;
  project: string;
  subjectType: string;
  subjectId: string | null;
  userIntent: string;
  alignmentLabel: AlignmentLabel;
  score: -2 | -1 | 0 | 1 | 2;
  confidence: AlignmentConfidence;
  rationale: string;
  evidence: string[];
  risks: string[];
  scopeGuidance: string | null;
  missingContext: string[];
  strategySnapshot: Record<string, unknown>;
  createdAt: string;
};

export function buildMarkdownDocument(frontmatter: MemoryFrontmatter, body: string) {
  return `---\n${YAML.stringify(frontmatter).trimEnd()}\n---\n\n${body.trim()}\n`;
}

export function buildLogicalPath(project: string, segments: string[], fileName: string) {
  const normalizedProject = normalizeProject(project);
  const prefix =
    normalizedProject === "shared"
      ? ["memory", "shared"]
      : ["memory", "projects", normalizedProject];
  return `/${[...prefix, ...segments, fileName].join("/")}`;
}

export function normalizeProject(project?: string | null) {
  if (!project || project === "shared") {
    return "shared";
  }
  return slugify(project);
}

export function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/--+/g, "-");
}

export function inferMemoryTypeFromPath(path: string): MemoryType {
  if (path.includes("/repo-index/")) {
    return "repo_index";
  }
  if (path.includes("/snippets/")) {
    return "snippet";
  }
  if (path.includes("/decisions/")) {
    return "decision";
  }
  if (path.includes("/sessions/")) {
    return "session_summary";
  }
  if (path.includes("/history/")) {
    return "historical_note";
  }
  return "current_context";
}

export function inferStatusFromPath(path: string): MemoryStatus {
  if (path.includes("/history/")) {
    return "historical";
  }
  return "active";
}

export function extractProjectFromPath(path: string) {
  const parts = path.split("/").filter(Boolean);
  const projectsIndex = parts.indexOf("projects");
  if (projectsIndex >= 0 && parts[projectsIndex + 1]) {
    return parts[projectsIndex + 1];
  }
  return "shared";
}

export function isAdminPrincipal(
  principal: MemoryPrincipal,
  adminGithubLogins: Set<string>,
) {
  return (
    principal.authType === "bearer" ||
    adminGithubLogins.has(principal.login.toLowerCase())
  );
}

export function createSystemFrontmatter(input: {
  path: string;
  title: string;
  project?: string;
  memoryType?: MemoryType;
  status?: MemoryStatus;
  canonical?: boolean;
  revision?: number;
  authorClient: string;
  supersedes?: string[];
  supersededBy?: string[];
  now?: string;
}) {
  const now = input.now ?? new Date().toISOString();
  const project = normalizeProject(input.project ?? extractProjectFromPath(input.path));
  const memoryType = input.memoryType ?? inferMemoryTypeFromPath(input.path);
  const status = input.status ?? inferStatusFromPath(input.path);
  return frontmatterSchema.parse({
    id: crypto.randomUUID(),
    title: input.title,
    project,
    memory_type: memoryType,
    status,
    revision: input.revision ?? 1,
    tags: [],
    created_at: now,
    updated_at: now,
    author_client: input.authorClient,
    source: undefined,
    source_urls: [],
    confidence: undefined,
    usefulness: undefined,
    repo: undefined,
    path: undefined,
    supersedes: input.supersedes ?? [],
    superseded_by: input.supersededBy ?? [],
    canonical: input.canonical ?? memoryType === "current_context",
  });
}
