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
  createdAt: string;
  updatedAt: string;
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

export type InitiativeStatus = z.infer<typeof initiativeStatusSchema>;
export type EntityType = z.infer<typeof entityTypeSchema>;
export type TaskStatus = z.infer<typeof taskStatusSchema>;
export type TaskPriority = z.infer<typeof taskPrioritySchema>;
export type SourceSensitivity = z.infer<typeof sourceSensitivitySchema>;
export type SourceSavePolicy = z.infer<typeof sourceSavePolicySchema>;

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
