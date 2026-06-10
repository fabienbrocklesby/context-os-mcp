# Obsidian Vault Layer Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every D1 entity/fact/task/event write also produce a markdown vault file in a layered folder structure, and configure Obsidian to show the result as a colourful, wikilinked "brain" graph.

**Architecture:** A new pure `vault-markdown.ts` module generates markdown for each node type. A new `VaultSyncService` handles WorkDrive uploads for those nodes. Both `EntityService` and `DocumentService.finishWorkSession` receive `VaultSyncService` optionally and call it after every D1 write. A one-time admin tool backfills existing D1 data into vault files. Obsidian graph config and initiative hub files are written locally.

**Tech Stack:** TypeScript, Cloudflare Workers, Zoho WorkDrive API (`zoho.uploadMarkdownFile`, `zoho.ensureFolderPath`), Vitest, Zod, Obsidian graph.json

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/domain/vault-markdown.ts` | Create | Pure functions: generate vault markdown for entity, fact, task, event, initiative |
| `src/service/VaultSyncService.ts` | Create | Resolves WorkDrive folders, calls `uploadMarkdownFile` for each node type |
| `src/service/EntityService.ts` | Modify | Accept optional `VaultSyncService`, call it after every D1 write |
| `src/service/DocumentService.ts` | Modify | Accept optional `VaultSyncService`, call it in `finishWorkSession` for tasks/events/facts |
| `src/mcp/tools.ts` | Modify | Instantiate `VaultSyncService` and inject into both services |
| `src/domain/memory.ts` | Modify | Update `inferMemoryTypeFromPath` for new folder paths |
| `src/tools/admin-tools.ts` | Modify | Add `admin_sync_vault_from_d1` bulk backfill tool |
| `tests/unit/vault-markdown.test.ts` | Create | Unit tests for all markdown generators |
| `tests/unit/vault-sync.test.ts` | Create | Unit tests for VaultSyncService with mocked Zoho |
| `.obsidian/graph.json` (vault) | Create (local) | Obsidian graph colour config |
| `shared/initiatives/*.md` (vault) | Create (local) | Initiative hub files |

---

## Task 1: vault-markdown.ts — pure markdown generators

**Files:**
- Create: `src/domain/vault-markdown.ts`
- Test: `tests/unit/vault-markdown.test.ts`

The module generates vault markdown strings for each node type. No I/O, no deps except domain types.

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/unit/vault-markdown.test.ts
import { describe, expect, it } from "vitest";
import {
  buildEntityVaultMarkdown,
  buildEventVaultMarkdown,
  buildFactVaultMarkdown,
  buildInitiativeVaultMarkdown,
  buildTaskVaultMarkdown,
  vaultSlugForTask,
} from "~/domain/vault-markdown";

describe("buildEntityVaultMarkdown", () => {
  it("includes entity name as H1", () => {
    const md = buildEntityVaultMarkdown(
      { id: "e1", project: "light-lane", type: "company", slug: "acme", name: "Acme Corp",
        summary: null, source: null, sourceId: null, confidence: null, metadata: {},
        createdAt: "2026-05-30T00:00:00Z", updatedAt: "2026-05-30T00:00:00Z" },
      { deal_stage: { value: "Discovery", updated_at: "2026-05-30T00:00:00Z" } },
    );
    expect(md).toContain("# Acme Corp");
    expect(md).toContain("deal_stage");
    expect(md).toContain("Discovery");
  });

  it("includes memory_layer: knowledge in frontmatter", () => {
    const md = buildEntityVaultMarkdown(
      { id: "e1", project: "light-lane", type: "person", slug: "fabien", name: "Fabien",
        summary: null, source: null, sourceId: null, confidence: null, metadata: {},
        createdAt: "2026-05-30T00:00:00Z", updatedAt: "2026-05-30T00:00:00Z" },
      {},
    );
    expect(md).toContain("memory_layer: knowledge");
    expect(md).toContain("entity_type: person");
  });
});

describe("buildFactVaultMarkdown", () => {
  it("renders fact body and source", () => {
    const md = buildFactVaultMarkdown({
      id: "f1", project: "light-lane", title: "Creditflex is a partner",
      body: "Not a prospect.", factKey: "creditflex-partner", status: "active",
      source: "Fabien", sourceUrl: null, confidence: 1, initiativeId: null,
      entityId: null, documentId: null, metadata: {},
      createdAt: "2026-05-30T00:00:00Z", updatedAt: "2026-05-30T00:00:00Z",
    });
    expect(md).toContain("# Creditflex is a partner");
    expect(md).toContain("Not a prospect.");
    expect(md).toContain("memory_layer: knowledge");
    expect(md).toContain("memory_type: decision");
  });
});

describe("buildTaskVaultMarkdown", () => {
  it("includes priority and status", () => {
    const md = buildTaskVaultMarkdown({
      id: "t1", project: "light-lane", title: "Send info to South Pine",
      description: "Send by Monday.", status: "open", priority: "urgent",
      dueAt: "2026-06-01", owner: "Fabien", initiativeId: null, entityId: null,
      source: null, sourceUrl: null, reminderAt: null, metadata: {},
      createdAt: "2026-05-30T00:00:00Z", updatedAt: "2026-05-30T00:00:00Z",
    });
    expect(md).toContain("# Send info to South Pine");
    expect(md).toContain("urgent");
    expect(md).toContain("2026-06-01");
    expect(md).toContain("memory_layer: operational");
  });
});

describe("buildEventVaultMarkdown", () => {
  it("includes event type and summary", () => {
    const md = buildEventVaultMarkdown({
      id: "ev1", project: "light-lane", source: "Fabien direct report",
      sourceId: null, eventType: "sales_meeting", occurredAt: "2026-05-30",
      title: "South Pine meeting", summary: "Went very well.", sensitivity: "internal",
      savePolicy: "durable_summary", initiativeId: null, entityId: null,
      externalUrl: null, metadata: {},
      createdAt: "2026-05-30T00:00:00Z", updatedAt: "2026-05-30T00:00:00Z",
    });
    expect(md).toContain("# South Pine meeting");
    expect(md).toContain("Went very well.");
    expect(md).toContain("memory_layer: operational");
    expect(md).toContain("historical_note");
  });
});

describe("buildInitiativeVaultMarkdown", () => {
  it("links all entity names as wikilinks", () => {
    const md = buildInitiativeVaultMarkdown(
      { id: "i1", slug: "light-lane", title: "Light Lane", description: "Laser biz",
        status: "active", metadata: {}, createdAt: "2026-05-30T00:00:00Z", updatedAt: "2026-05-30T00:00:00Z" },
      ["Acme Corp", "HamiltonJet"],
    );
    expect(md).toContain("# Light Lane");
    expect(md).toContain("[[Acme Corp]]");
    expect(md).toContain("[[HamiltonJet]]");
    expect(md).toContain("memory_layer: situation");
  });
});

describe("vaultSlugForTask", () => {
  it("returns slugified title with id suffix", () => {
    expect(vaultSlugForTask("Send info", "abc123")).toBe("send-info-abc123");
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd /Users/fabienbrocklesby/Code/personal/memory-system-mcp
npx vitest run tests/unit/vault-markdown.test.ts 2>&1 | tail -20
```
Expected: multiple import errors — `vault-markdown` module not found.

- [ ] **Step 3: Create `src/domain/vault-markdown.ts`**

```typescript
// src/domain/vault-markdown.ts
// Pure functions that generate Obsidian vault markdown for each Context OS node type.
// No I/O. No side effects. All inputs are plain domain objects.

import YAML from "yaml";
import type { ContextTask, DurableFact, MemoryEntity, MemoryInitiative, SourceEvent } from "~/domain/memory";
import { slugify } from "~/domain/memory";

// ---------------------------------------------------------------------------
// Entity vault node
// ---------------------------------------------------------------------------

type StateValues = Record<string, { value: unknown; updated_at?: string | null }>;

export function buildEntityVaultMarkdown(entity: MemoryEntity, states: StateValues): string {
  const subfolder = entity.type === "person" ? "people" : "companies";
  const frontmatter = {
    id: entity.id,
    title: entity.name,
    project: entity.project,
    memory_type: "current_context",
    status: "active",
    revision: 1,
    canonical: true,
    memory_layer: "knowledge",
    entity_type: entity.type,
    entity_slug: entity.slug,
    entity_subfolder: subfolder,
    tags: ["entity", entity.type, `project/${entity.project}`],
    created_at: entity.createdAt,
    updated_at: entity.updatedAt,
    author_client: "context-os",
    source_urls: [],
  };

  const stateRows = Object.entries(states)
    .map(([key, s]) => `| ${key} | ${formatStateValue(s.value)} | ${s.updated_at?.slice(0, 10) ?? "—"} |`)
    .join("\n");

  const stateTable = stateRows
    ? `## Current State\n\n| State Key | Value | Last Updated |\n|-----------|-------|-------------|\n${stateRows}`
    : `## Current State\n\n_No state records yet._`;

  const summary = entity.summary ? `\n${entity.summary}\n` : "";

  const body = [
    `# ${entity.name}`,
    "",
    `**Type:** ${entity.type}${entity.source ? ` | **Source:** ${entity.source}` : ""}`,
    "",
    summary,
    stateTable,
    "",
    "## Related Sessions",
    "",
    "_Sessions that mention this entity will appear here after reindex._",
  ].join("\n");

  return `---\n${YAML.stringify(frontmatter).trimEnd()}\n---\n\n${body.trim()}\n`;
}

// ---------------------------------------------------------------------------
// Fact vault node
// ---------------------------------------------------------------------------

export function buildFactVaultMarkdown(fact: DurableFact): string {
  const frontmatter = {
    id: fact.id,
    title: fact.title,
    project: fact.project,
    memory_type: "decision",
    status: fact.status === "active" ? "active" : "historical",
    revision: 1,
    canonical: true,
    memory_layer: "knowledge",
    fact_key: fact.factKey ?? null,
    confidence: fact.confidence ?? null,
    tags: ["fact", `project/${fact.project}`],
    created_at: fact.createdAt,
    updated_at: fact.updatedAt,
    author_client: "context-os",
    source_urls: fact.sourceUrl ? [fact.sourceUrl] : [],
  };

  const body = [
    `# ${fact.title}`,
    "",
    fact.body,
    "",
    fact.source ? `**Source:** ${fact.source}` : "",
    fact.confidence != null ? `**Confidence:** ${fact.confidence}` : "",
  ]
    .filter((line) => line !== "")
    .join("\n");

  return `---\n${YAML.stringify(frontmatter).trimEnd()}\n---\n\n${body.trim()}\n`;
}

// ---------------------------------------------------------------------------
// Task vault node
// ---------------------------------------------------------------------------

export function buildTaskVaultMarkdown(task: ContextTask): string {
  const frontmatter = {
    id: task.id,
    title: task.title,
    project: task.project,
    memory_type: "current_context",
    status: task.status === "open" || task.status === "in_progress" ? "active" : "historical",
    revision: 1,
    canonical: false,
    memory_layer: "operational",
    task_status: task.status,
    task_priority: task.priority,
    task_due: task.dueAt ?? null,
    task_owner: task.owner ?? null,
    tags: ["task", task.priority ?? "normal", `project/${task.project}`],
    created_at: task.createdAt,
    updated_at: task.updatedAt,
    author_client: "context-os",
    source_urls: task.sourceUrl ? [task.sourceUrl] : [],
  };

  const meta = [
    `**Status:** ${task.status}`,
    `**Priority:** ${task.priority ?? "normal"}`,
    task.dueAt ? `**Due:** ${task.dueAt.slice(0, 10)}` : null,
    task.owner ? `**Owner:** ${task.owner}` : null,
  ]
    .filter(Boolean)
    .join(" | ");

  const body = [
    `# ${task.title}`,
    "",
    meta,
    "",
    task.description ?? "",
  ]
    .filter((line) => line !== "")
    .join("\n");

  return `---\n${YAML.stringify(frontmatter).trimEnd()}\n---\n\n${body.trim()}\n`;
}

// ---------------------------------------------------------------------------
// Source event vault node
// ---------------------------------------------------------------------------

export function buildEventVaultMarkdown(event: SourceEvent): string {
  const frontmatter = {
    id: event.id,
    title: event.title,
    project: event.project,
    memory_type: "historical_note",
    status: "historical",
    revision: 1,
    canonical: false,
    memory_layer: "operational",
    event_type: event.eventType,
    occurred_at: event.occurredAt ?? null,
    source: event.source,
    sensitivity: event.sensitivity,
    tags: ["event", slugify(event.eventType), `project/${event.project}`],
    created_at: event.createdAt,
    updated_at: event.updatedAt,
    author_client: "context-os",
    source_urls: event.externalUrl ? [event.externalUrl] : [],
  };

  const meta = [
    `**Type:** ${event.eventType}`,
    `**Source:** ${event.source}`,
    event.occurredAt ? `**Date:** ${event.occurredAt.slice(0, 10)}` : null,
  ]
    .filter(Boolean)
    .join(" | ");

  const body = [`# ${event.title}`, "", meta, "", event.summary].join("\n");

  return `---\n${YAML.stringify(frontmatter).trimEnd()}\n---\n\n${body.trim()}\n`;
}

// ---------------------------------------------------------------------------
// Initiative hub node
// ---------------------------------------------------------------------------

export function buildInitiativeVaultMarkdown(
  initiative: Pick<MemoryInitiative, "id" | "slug" | "title" | "description" | "status" | "createdAt" | "updatedAt">,
  entityNames: string[],
): string {
  const frontmatter = {
    id: initiative.id,
    title: initiative.title,
    project: "shared",
    memory_type: "current_context",
    status: "active",
    revision: 1,
    canonical: true,
    memory_layer: "situation",
    initiative_slug: initiative.slug,
    tags: ["initiative", initiative.slug],
    created_at: initiative.createdAt,
    updated_at: initiative.updatedAt,
    author_client: "context-os",
    source_urls: [],
  };

  const entityLinks = entityNames
    .map((name) => `- [[${name}]]`)
    .join("\n");

  const body = [
    `# ${initiative.title}`,
    "",
    initiative.description ?? "",
    "",
    "## Key Entities",
    "",
    entityLinks || "_No entities yet._",
  ].join("\n");

  return `---\n${YAML.stringify(frontmatter).trimEnd()}\n---\n\n${body.trim()}\n`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function vaultSlugForTask(title: string, id: string): string {
  return `${slugify(title)}-${id.slice(0, 8)}`;
}

function formatStateValue(value: unknown): string {
  if (typeof value === "string") {
    return value.length > 120 ? `${value.slice(0, 117)}…` : value;
  }
  return JSON.stringify(value);
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx vitest run tests/unit/vault-markdown.test.ts 2>&1 | tail -20
```
Expected: all 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/vault-markdown.ts tests/unit/vault-markdown.test.ts
git commit -m "feat: add vault-markdown domain module for Obsidian node generation"
```

---

## Task 2: VaultSyncService — WorkDrive write wrapper

**Files:**
- Create: `src/service/VaultSyncService.ts`
- Test: `tests/unit/vault-sync.test.ts`

`VaultSyncService` takes `env`, `zoho`, `config`, and `projectRepo`. Each `sync*` method resolves the target WorkDrive folder via `ensureFolderPath`, then calls `zoho.uploadMarkdownFile` with `overrideExisting: true`.

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/unit/vault-sync.test.ts
import { describe, expect, it, vi, type Mock } from "vitest";

vi.mock("~/integrations/zoho/client", () => ({
  ZohoWorkDriveClient: vi.fn(),
}));

vi.mock("~/persistence/d1/ProjectRepository", () => ({
  ProjectRepository: vi.fn(),
}));

const mockZoho = {
  ensureFolderPath: vi.fn().mockResolvedValue({ folder: { id: "folder-123" }, created: [] }),
  uploadMarkdownFile: vi.fn().mockResolvedValue({ id: "file-abc" }),
};

const mockProjectRepo = {
  getProject: vi.fn().mockResolvedValue({
    slug: "light-lane",
    workdriveRootFolderId: "root-folder-id",
  }),
};

const mockConfig = {
  zoho: { sharedRootFolderId: "shared-root-id", uploadUrl: "https://upload.zoho.test" },
};

import { VaultSyncService } from "~/service/VaultSyncService";
import {
  buildEntityVaultMarkdown,
  buildFactVaultMarkdown,
  buildTaskVaultMarkdown,
  buildEventVaultMarkdown,
} from "~/domain/vault-markdown";

describe("VaultSyncService.syncEntity", () => {
  it("calls uploadMarkdownFile with correct folder and filename", async () => {
    const svc = new VaultSyncService({} as Env, mockZoho as any, mockConfig as any, mockProjectRepo as any);
    await svc.syncEntity("light-lane", {
      id: "e1", project: "light-lane", type: "company", slug: "acme", name: "Acme Corp",
      summary: null, source: null, sourceId: null, confidence: null, metadata: {},
      createdAt: "2026-05-30T00:00:00Z", updatedAt: "2026-05-30T00:00:00Z",
    }, {});
    expect(mockZoho.ensureFolderPath).toHaveBeenCalledWith("root-folder-id", ["knowledge", "entities", "companies"]);
    expect(mockZoho.uploadMarkdownFile).toHaveBeenCalledWith(
      expect.objectContaining({ fileName: "acme.md", overrideExisting: true }),
    );
  });

  it("returns null silently when project has no workdriveRootFolderId", async () => {
    mockProjectRepo.getProject.mockResolvedValueOnce({ slug: "light-lane", workdriveRootFolderId: null });
    const svc = new VaultSyncService({} as Env, mockZoho as any, mockConfig as any, mockProjectRepo as any);
    const result = await svc.syncEntity("light-lane", {
      id: "e1", project: "light-lane", type: "company", slug: "acme", name: "Acme Corp",
      summary: null, source: null, sourceId: null, confidence: null, metadata: {},
      createdAt: "2026-05-30T00:00:00Z", updatedAt: "2026-05-30T00:00:00Z",
    }, {});
    expect(result).toBeNull();
  });
});

describe("VaultSyncService.syncFact", () => {
  it("uploads to knowledge/facts folder", async () => {
    (mockZoho.ensureFolderPath as Mock).mockClear();
    const svc = new VaultSyncService({} as Env, mockZoho as any, mockConfig as any, mockProjectRepo as any);
    await svc.syncFact("light-lane", {
      id: "f1", project: "light-lane", title: "Test Fact", body: "Fact body.",
      factKey: "test-fact-key", status: "active", source: null, sourceUrl: null,
      confidence: 1, initiativeId: null, entityId: null, documentId: null, metadata: {},
      createdAt: "2026-05-30T00:00:00Z", updatedAt: "2026-05-30T00:00:00Z",
    });
    expect(mockZoho.ensureFolderPath).toHaveBeenCalledWith("root-folder-id", ["knowledge", "facts"]);
    expect(mockZoho.uploadMarkdownFile).toHaveBeenCalledWith(
      expect.objectContaining({ fileName: "test-fact-key.md", overrideExisting: true }),
    );
  });
});
```

- [ ] **Step 2: Run to confirm they fail**

```bash
npx vitest run tests/unit/vault-sync.test.ts 2>&1 | tail -20
```
Expected: import error — `VaultSyncService` not found.

- [ ] **Step 3: Create `src/service/VaultSyncService.ts`**

```typescript
// src/service/VaultSyncService.ts
// Writes entity/fact/task/event/initiative vault markdown files to WorkDrive.
// Called as a write-through side effect whenever D1 is updated.
// All methods return null silently if WorkDrive is not configured.

import { loadConfig } from "~/config/env";
import type { ContextTask, DurableFact, MemoryEntity, MemoryInitiative, SourceEvent } from "~/domain/memory";
import { slugify } from "~/domain/memory";
import {
  buildEntityVaultMarkdown,
  buildEventVaultMarkdown,
  buildFactVaultMarkdown,
  buildInitiativeVaultMarkdown,
  buildTaskVaultMarkdown,
  vaultSlugForTask,
} from "~/domain/vault-markdown";
import type { ZohoWorkDriveClient } from "~/integrations/zoho/client";
import type { ProjectRepository } from "~/persistence/d1/ProjectRepository";

type StateValues = Record<string, { value: unknown; updated_at?: string | null }>;

export class VaultSyncService {
  constructor(
    private readonly env: Env,
    private readonly zoho: ZohoWorkDriveClient,
    private readonly config: ReturnType<typeof loadConfig>,
    private readonly projectRepo: ProjectRepository,
  ) {}

  async syncEntity(
    project: string,
    entity: MemoryEntity,
    states: StateValues,
  ): Promise<{ path: string; workdriveFileId: string } | null> {
    const rootId = await this.getProjectRootFolderId(project);
    if (!rootId) return null;
    const subfolder = entity.type === "person" ? "people" : "companies";
    const { folder } = await this.zoho.ensureFolderPath(rootId, ["knowledge", "entities", subfolder]);
    const fileName = `${entity.slug}.md`;
    const markdown = buildEntityVaultMarkdown(entity, states);
    const uploaded = await this.zoho.uploadMarkdownFile({ folderId: folder.id, fileName, markdown, overrideExisting: true });
    return { path: `/memory/projects/${project}/knowledge/entities/${subfolder}/${fileName}`, workdriveFileId: uploaded.id };
  }

  async syncFact(
    project: string,
    fact: DurableFact,
  ): Promise<{ path: string; workdriveFileId: string } | null> {
    const rootId = await this.getProjectRootFolderId(project);
    if (!rootId) return null;
    const { folder } = await this.zoho.ensureFolderPath(rootId, ["knowledge", "facts"]);
    const fileName = `${fact.factKey ? slugify(fact.factKey).slice(0, 100) : fact.id}.md`;
    const markdown = buildFactVaultMarkdown(fact);
    const uploaded = await this.zoho.uploadMarkdownFile({ folderId: folder.id, fileName, markdown, overrideExisting: true });
    return { path: `/memory/projects/${project}/knowledge/facts/${fileName}`, workdriveFileId: uploaded.id };
  }

  async syncTask(
    project: string,
    task: ContextTask,
  ): Promise<{ path: string; workdriveFileId: string } | null> {
    const rootId = await this.getProjectRootFolderId(project);
    if (!rootId) return null;
    const { folder } = await this.zoho.ensureFolderPath(rootId, ["operational", "tasks"]);
    const fileName = `${vaultSlugForTask(task.title, task.id)}.md`;
    const markdown = buildTaskVaultMarkdown(task);
    const uploaded = await this.zoho.uploadMarkdownFile({ folderId: folder.id, fileName, markdown, overrideExisting: true });
    return { path: `/memory/projects/${project}/operational/tasks/${fileName}`, workdriveFileId: uploaded.id };
  }

  async syncEvent(
    project: string,
    event: SourceEvent,
  ): Promise<{ path: string; workdriveFileId: string } | null> {
    const rootId = await this.getProjectRootFolderId(project);
    if (!rootId) return null;
    const { folder } = await this.zoho.ensureFolderPath(rootId, ["operational", "events"]);
    const fileName = `${event.occurredAt?.slice(0, 10) ?? "no-date"}-${slugify(event.title).slice(0, 80)}.md`;
    const markdown = buildEventVaultMarkdown(event);
    const uploaded = await this.zoho.uploadMarkdownFile({ folderId: folder.id, fileName, markdown, overrideExisting: true });
    return { path: `/memory/projects/${project}/operational/events/${fileName}`, workdriveFileId: uploaded.id };
  }

  async syncInitiative(
    initiative: Pick<MemoryInitiative, "id" | "slug" | "title" | "description" | "status" | "createdAt" | "updatedAt">,
    entityNames: string[],
  ): Promise<{ path: string; workdriveFileId: string } | null> {
    const sharedRootId = this.config.zoho.sharedRootFolderId;
    if (!sharedRootId) return null;
    const { folder } = await this.zoho.ensureFolderPath(sharedRootId, ["initiatives"]);
    const fileName = `${initiative.slug}.md`;
    const markdown = buildInitiativeVaultMarkdown(initiative, entityNames);
    const uploaded = await this.zoho.uploadMarkdownFile({ folderId: folder.id, fileName, markdown, overrideExisting: true });
    return { path: `/memory/shared/initiatives/${fileName}`, workdriveFileId: uploaded.id };
  }

  private async getProjectRootFolderId(project: string): Promise<string | null> {
    const proj = await this.projectRepo.getProject(project);
    return proj?.workdriveRootFolderId ?? null;
  }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx vitest run tests/unit/vault-sync.test.ts 2>&1 | tail -20
```
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/service/VaultSyncService.ts tests/unit/vault-sync.test.ts
git commit -m "feat: add VaultSyncService for write-through WorkDrive vault files"
```

---

## Task 3: Wire VaultSyncService into EntityService

**Files:**
- Modify: `src/service/EntityService.ts`

Add an optional `vaultSvc?: VaultSyncService` to the constructor. Call it after each D1 write. The vault sync is fire-and-forget — errors are caught and logged, never thrown.

- [ ] **Step 1: Read the current EntityService constructor**

The constructor is at the top of `src/service/EntityService.ts`:
```typescript
constructor(
  private readonly env: Env,
  private readonly principal: MemoryPrincipal,
  private readonly entityRepo: EntityRepository,
  private readonly projectRepo: ProjectRepository,
)
```

- [ ] **Step 2: Add the import and constructor parameter**

At the top of `src/service/EntityService.ts`, add the import after the existing imports:
```typescript
import type { VaultSyncService } from "~/service/VaultSyncService";
```

Change the constructor to:
```typescript
constructor(
  private readonly env: Env,
  private readonly principal: MemoryPrincipal,
  private readonly entityRepo: EntityRepository,
  private readonly projectRepo: ProjectRepository,
  private readonly vaultSvc?: VaultSyncService,
) {}
```

- [ ] **Step 3: Wire vault sync into upsertEntityState**

At the end of `upsertEntityState`, after `return { project, entity, aliases, state }`, add the vault sync call before the return:

```typescript
    // After the D1 writes, sync vault markdown (fire-and-forget, errors swallowed)
    if (this.vaultSvc && entity) {
      const allStates = await this.entityRepo.listEntityStatesForEntities({
        project,
        entityIds: [entity.id],
      });
      const stateValues: Record<string, { value: unknown; updated_at: string | null }> = {};
      for (const s of allStates) {
        stateValues[s.stateKey] = { value: s.value, updated_at: s.updatedAt };
      }
      this.vaultSvc.syncEntity(project, entity, stateValues).catch(() => {});
    }
    return { project, entity, aliases, state };
```

- [ ] **Step 4: Wire vault sync into upsertTask**

At the end of `upsertTask`, before `return { task }`:
```typescript
    const result = { task: await this.entityRepo.upsertTask({ ...input, project }) };
    if (this.vaultSvc && result.task) {
      this.vaultSvc.syncTask(project, result.task).catch(() => {});
    }
    return result;
```

- [ ] **Step 5: Wire vault sync into saveSourceEvent**

At the end of `saveSourceEvent`, for the saved=true branch:
```typescript
    const sourceEvent = await this.entityRepo.saveSourceEvent({ ...input, project, savePolicy });
    if (this.vaultSvc) {
      this.vaultSvc.syncEvent(project, sourceEvent).catch(() => {});
    }
    return { saved: true, policy, source_event: sourceEvent };
```

- [ ] **Step 6: Wire vault sync into extractDurableFacts**

At the end of `extractDurableFacts`, after the `for` loop that populates `saved`:
```typescript
    if (this.vaultSvc) {
      for (const fact of saved) {
        if (fact) this.vaultSvc.syncFact(project, fact).catch(() => {});
      }
    }
    return { project, facts: extracted, saved };
```

- [ ] **Step 7: Run the full test suite to confirm nothing broke**

```bash
npx vitest run 2>&1 | tail -30
```
Expected: all existing tests pass. Any failures here mean the edits above introduced a regression — check the diff carefully.

- [ ] **Step 8: Commit**

```bash
git add src/service/EntityService.ts
git commit -m "feat: wire VaultSyncService into EntityService for write-through vault sync"
```

---

## Task 4: Wire VaultSyncService into DocumentService.finishWorkSession

**Files:**
- Modify: `src/service/DocumentService.ts`

`finishWorkSession` bypasses EntityService and calls `entityRepo` directly for tasks/events/facts. Add the same vault sync here.

- [ ] **Step 1: Add the import to DocumentService.ts**

After the existing imports at the top of `src/service/DocumentService.ts`:
```typescript
import type { VaultSyncService } from "~/service/VaultSyncService";
```

- [ ] **Step 2: Add optional vaultSvc to DocumentService constructor**

Find the `export class DocumentService` constructor. The current signature is:
```typescript
constructor(
  private readonly env: Env,
  private readonly principal: MemoryPrincipal,
  private readonly projectRepo: ProjectRepository,
  private readonly docRepo: DocumentRepository,
  private readonly entityRepo: EntityRepository,
  private readonly config: ReturnType<typeof loadConfig>,
  private readonly zoho: ZohoWorkDriveClient,
  private readonly github?: GithubOAuthClient,
)
```

Add `vaultSvc` at the end:
```typescript
constructor(
  private readonly env: Env,
  private readonly principal: MemoryPrincipal,
  private readonly projectRepo: ProjectRepository,
  private readonly docRepo: DocumentRepository,
  private readonly entityRepo: EntityRepository,
  private readonly config: ReturnType<typeof loadConfig>,
  private readonly zoho: ZohoWorkDriveClient,
  private readonly github?: GithubOAuthClient,
  private readonly vaultSvc?: VaultSyncService,
)
```

- [ ] **Step 3: Add vault sync after the tasks loop in finishWorkSession**

Find the tasks loop in `finishWorkSession` (around line 1409–1417):
```typescript
    const tasks = [];
    for (const task of input.tasks ?? []) {
      await this.ensureProjectMinimal({ project });
      tasks.push({
        task: await this.entityRepo.upsertTask({ ...task, project }),
      });
    }
```

Replace with:
```typescript
    const tasks = [];
    for (const task of input.tasks ?? []) {
      await this.ensureProjectMinimal({ project });
      const saved = await this.entityRepo.upsertTask({ ...task, project });
      tasks.push({ task: saved });
      if (this.vaultSvc && saved) this.vaultSvc.syncTask(project, saved).catch(() => {});
    }
```

- [ ] **Step 4: Add vault sync after the sourceEvents loop**

Find the sourceEvents loop (around line 1419–1440). Replace the `saved: true` branch:
```typescript
      } else {
        const sourceEvent = await this.entityRepo.saveSourceEvent({ ...event, project, savePolicy });
        if (this.vaultSvc) this.vaultSvc.syncEvent(project, sourceEvent).catch(() => {});
        sourceEvents.push({ saved: true, policy, source_event: sourceEvent });
      }
```

- [ ] **Step 5: Add vault sync after the facts loop**

Find the facts loop (around line 1442–1450). Replace:
```typescript
    const facts = [];
    for (const fact of input.facts ?? []) {
      const saved = await this.entityRepo.upsertFact({ ...fact, project });
      if (this.vaultSvc && saved) this.vaultSvc.syncFact(project, saved).catch(() => {});
      facts.push(saved);
    }
```

- [ ] **Step 6: Run the full test suite**

```bash
npx vitest run 2>&1 | tail -30
```
Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/service/DocumentService.ts
git commit -m "feat: wire VaultSyncService into DocumentService.finishWorkSession"
```

---

## Task 5: Wire VaultSyncService in tools.ts

**Files:**
- Modify: `src/mcp/tools.ts`

Instantiate `VaultSyncService` and pass it to `EntityService` and `DocumentService`.

- [ ] **Step 1: Add the import**

In `src/mcp/tools.ts`, add after existing service imports:
```typescript
import { VaultSyncService } from "~/service/VaultSyncService";
```

- [ ] **Step 2: Instantiate VaultSyncService and pass it to both services**

Replace:
```typescript
  const entitySvc = new EntityService(env, principal, entityRepo, projectRepo);
  // ...
  const docSvc = new DocumentService(env, principal, projectRepo, docRepo, entityRepo, config, zoho, github);
```

With:
```typescript
  const vaultSvc = new VaultSyncService(env, zoho, config, projectRepo);
  const entitySvc = new EntityService(env, principal, entityRepo, projectRepo, vaultSvc);
  // ...
  const docSvc = new DocumentService(env, principal, projectRepo, docRepo, entityRepo, config, zoho, github, vaultSvc);
```

- [ ] **Step 3: Run the full test suite**

```bash
npx vitest run 2>&1 | tail -30
```
Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/mcp/tools.ts
git commit -m "feat: instantiate VaultSyncService and wire into EntityService and DocumentService"
```

---

## Task 6: Update inferMemoryTypeFromPath for new folder paths

**Files:**
- Modify: `src/domain/memory.ts`

The WorkDrive crawler calls `inferMemoryTypeFromPath` to classify files. Add cases for the new paths.

- [ ] **Step 1: Find the function**

In `src/domain/memory.ts`, find `inferMemoryTypeFromPath` (around line 708):
```typescript
export function inferMemoryTypeFromPath(path: string): MemoryType {
  if (path.includes("/repo-index/")) return "repo_index";
  if (path.includes("/snippets/")) return "snippet";
  if (path.includes("/decisions/")) return "decision";
  if (path.includes("/sessions/")) return "session_summary";
  if (path.includes("/history/")) return "historical_note";
  return "current_context";
}
```

- [ ] **Step 2: Add new path cases**

Replace with:
```typescript
export function inferMemoryTypeFromPath(path: string): MemoryType {
  if (path.includes("/repo-index/")) return "repo_index";
  if (path.includes("/snippets/")) return "snippet";
  if (path.includes("/knowledge/facts/")) return "decision";
  if (path.includes("/knowledge/decisions/") || path.includes("/decisions/")) return "decision";
  if (path.includes("/operational/events/")) return "historical_note";
  if (path.includes("/operational/sessions/") || path.includes("/sessions/")) return "session_summary";
  if (path.includes("/history/")) return "historical_note";
  return "current_context";
}
```

Also find `inferMemoryLayer` in `DocumentService.ts` (around line 204) and extend it to handle path-based layer inference for new paths:

```typescript
function inferMemoryLayer(
  memoryType: string,
  canonical: boolean,
  path?: string,
): "situation" | "knowledge" | "operational" | "event_log" {
  if (path) {
    if (path.includes("/knowledge/")) return "knowledge";
    if (path.includes("/operational/")) return "operational";
    if (path.includes("/initiatives/")) return "situation";
  }
  if (memoryType === "session_summary" || memoryType === "historical_note") return "event_log";
  if (
    memoryType === "decision" ||
    memoryType === "snippet" ||
    memoryType === "repo_index" ||
    (canonical && memoryType === "current_context")
  ) return "knowledge";
  return "operational";
}
```

Wherever `inferMemoryLayer` is called in `DocumentService.ts`, pass the `path` argument if available.

- [ ] **Step 3: Run tests**

```bash
npx vitest run 2>&1 | tail -20
```
Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/domain/memory.ts src/service/DocumentService.ts
git commit -m "feat: extend path inference for new knowledge/operational vault folder structure"
```

---

## Task 7: admin_sync_vault_from_d1 bulk backfill tool

**Files:**
- Modify: `src/tools/admin-tools.ts`
- Modify: `src/mcp/tools.ts` (pass vaultSvc to registerAdminTools)

- [ ] **Step 1: Update registerAdminTools signature**

In `src/tools/admin-tools.ts`, change the signature:
```typescript
import type { VaultSyncService } from "~/service/VaultSyncService";

export function registerAdminTools(
  server: McpServer,
  docSvc: DocumentService,
  vaultSvc: VaultSyncService,
) {
```

- [ ] **Step 2: Add the bulk sync tool**

In `registerAdminTools`, add after the existing tools:

```typescript
  server.registerTool(
    "admin_sync_vault_from_d1",
    {
      description: "Backfill Obsidian vault files from all D1 entities, facts, tasks, and source events for a given project. Run once after deploying vault sync to materialise existing data.",
      inputSchema: z.object({
        project: z.string().describe("Project slug, e.g. 'light-lane'"),
        dry_run: z.boolean().optional().describe("Default false. Set true to preview counts without writing files."),
      }),
      annotations: { destructiveHint: false, idempotentHint: true },
    },
    async ({ project, dry_run }) => {
      const isDryRun = dry_run === true;
      const counts = { entities: 0, facts: 0, tasks: 0, events: 0, errors: 0 };

      // Import needed repos — access via docSvc is not available; we need direct D1 access.
      // VaultSyncService and EntityRepository are injected from outside.
      const result = await docSvc.adminSyncVaultFromD1({ project, dryRun: isDryRun, vaultSvc });
      return textResult(JSON.stringify(result, null, 2));
    },
  );
```

- [ ] **Step 3: Add adminSyncVaultFromD1 to DocumentService**

In `src/service/DocumentService.ts`, add the method:

```typescript
  async adminSyncVaultFromD1(input: {
    project: string;
    dryRun: boolean;
    vaultSvc: VaultSyncService;
  }) {
    const project = normalizeProject(input.project);
    const counts = { entities: 0, facts: 0, tasks: 0, events: 0, errors: 0 };

    // Entities
    const entities = await this.entityRepo.searchEntities({ project, limit: 200 });
    for (const entity of entities) {
      try {
        const states = await this.entityRepo.listEntityStatesForEntities({ project, entityIds: [entity.id] });
        const stateValues: Record<string, { value: unknown; updated_at: string | null }> = {};
        for (const s of states) stateValues[s.stateKey] = { value: s.value, updated_at: s.updatedAt };
        if (!input.dryRun) await input.vaultSvc.syncEntity(project, entity, stateValues);
        counts.entities++;
      } catch { counts.errors++; }
    }

    // Facts
    const facts = await this.entityRepo.listFacts({ project, limit: 200 });
    for (const fact of facts) {
      try {
        if (!input.dryRun) await input.vaultSvc.syncFact(project, fact);
        counts.facts++;
      } catch { counts.errors++; }
    }

    // Tasks
    const tasks = await this.entityRepo.listTasks({ project, includeDone: true, limit: 200 });
    for (const task of tasks) {
      try {
        if (!input.dryRun) await input.vaultSvc.syncTask(project, task);
        counts.tasks++;
      } catch { counts.errors++; }
    }

    // Source events
    const events = await this.entityRepo.listSourceEvents({ project, limit: 200 });
    for (const event of events) {
      try {
        if (!input.dryRun) await input.vaultSvc.syncEvent(project, event);
        counts.events++;
      } catch { counts.errors++; }
    }

    return { project, dry_run: input.dryRun, counts };
  }
```

Note: `DocumentService` already has `entityRepo` injected — the `listFacts`, `listTasks`, `listSourceEvents` methods used here are already defined in `EntityRepository`.

- [ ] **Step 4: Update tools.ts to pass vaultSvc to registerAdminTools**

In `src/mcp/tools.ts`, change:
```typescript
  registerAdminTools(server, docSvc);
```
To:
```typescript
  registerAdminTools(server, docSvc, vaultSvc);
```

- [ ] **Step 5: Run the full test suite**

```bash
npx vitest run 2>&1 | tail -30
```
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/tools/admin-tools.ts src/service/DocumentService.ts src/mcp/tools.ts
git commit -m "feat: add admin_sync_vault_from_d1 bulk backfill tool"
```

---

## Task 8: Write Obsidian graph.json (local file write, no deploy needed)

**Files:**
- Create: `/Users/fabienbrocklesby/Library/CloudStorage/ZohoWorkDriveTrueSync-LightLane/My Folders/memory/.obsidian/graph.json`

This configures Obsidian's graph view with colours per layer and sizing parameters that create the "brain" look.

- [ ] **Step 1: Write graph.json**

Write the following content to `.obsidian/graph.json` in the vault:

```json
{
  "collapse-filter": false,
  "search": "",
  "showTags": false,
  "showAttachments": false,
  "hideUnresolved": false,
  "showOrphans": true,
  "collapse-color-groups": false,
  "colorGroups": [
    {
      "query": "path:\"shared/initiatives\"",
      "color": { "a": 1, "rgb": 10181046 }
    },
    {
      "query": "path:\"knowledge/entities\"",
      "color": { "a": 1, "rgb": 15105570 }
    },
    {
      "query": "path:\"knowledge/facts\"",
      "color": { "a": 1, "rgb": 15844367 }
    },
    {
      "query": "path:\"knowledge/decisions\" OR path:\"decisions\"",
      "color": { "a": 1, "rgb": 2719929 }
    },
    {
      "query": "path:\"knowledge/context\" OR path:\"context/current\"",
      "color": { "a": 1, "rgb": 6139362 }
    },
    {
      "query": "path:\"operational/sessions\" OR path:\"sessions\"",
      "color": { "a": 1, "rgb": 2600544 }
    },
    {
      "query": "path:\"operational/tasks\"",
      "color": { "a": 1, "rgb": 1752220 }
    },
    {
      "query": "path:\"operational/events\"",
      "color": { "a": 1, "rgb": 3066993 }
    },
    {
      "query": "path:\"snippets\"",
      "color": { "a": 1, "rgb": 9807270 }
    }
  ],
  "collapse-display": false,
  "showArrow": false,
  "textFadeMultiplier": 0,
  "nodeSizeMultiplier": 2,
  "lineSizeMultiplier": 1,
  "collapse-forces": false,
  "centerStrength": 0.518713,
  "repelStrength": 16,
  "linkStrength": 1,
  "linkDistance": 30,
  "scale": 1,
  "close": false
}
```

Colour legend:
- Purple `#9B59B6` (10181046) — initiatives (situation layer)
- Orange `#E67E22` (15105570) — entities (companies + people)
- Yellow `#F1C40F` (15844367) — facts
- Blue `#2980B9` (2719929) — decisions
- Steel blue `#5DADE2` (6139362) — context documents
- Green `#27AE60` (2600544) — sessions
- Teal `#1ABC9C` (1752220) — tasks
- Sage `#2ECC71` (3066993) — events
- Grey `#95A5A6` (9807270) — snippets

`nodeSizeMultiplier: 2` and `repelStrength: 16` spread nodes apart and make the brain look denser.

- [ ] **Step 2: Verify Obsidian picks it up**

Open Obsidian → Graph View → confirm nodes are now coloured. If Obsidian is already open, close and reopen it.

---

## Task 9: Write initiative hub files (local file write)

**Files:**
- Create: `.../memory/projects/light-lane/knowledge/context/light-lane-initiative.md`
- Create: `.../memory/projects/shared/context/current/dropshipping-portfolio-initiative.md`
- Create: `.../memory/projects/shared/context/current/software-infrastructure-initiative.md`

Since the `shared/initiatives/` folder via WorkDrive API isn't set up yet (needs deploy), write these locally into the shared context folder which already exists and syncs.

- [ ] **Step 1: Write light-lane initiative file**

Write to `/Users/fabienbrocklesby/Library/CloudStorage/ZohoWorkDriveTrueSync-LightLane/My Folders/memory/shared/context/current/initiative-light-lane.md`:

```markdown
---
id: initiative-light-lane
title: Light Lane Initiative
project: shared
memory_type: current_context
status: active
revision: 1
canonical: true
memory_layer: situation
initiative_slug: light-lane
tags:
  - initiative
  - light-lane
  - situation
created_at: "2026-05-30T00:00:00Z"
updated_at: "2026-05-30T00:00:00Z"
author_client: context-os
source_urls: []
---

# Light Lane Initiative

Enterprise laser business — hardware, software, training, workflow, sales. Based in Nelson, NZ.

## Active Deals (Pipeline)

- [[HamiltonJet - Laser traceability and manufacturing solutions]]
- [[South Pine Nelson Ltd]]
- [[Kernohan Engineering Limited]]
- [[Allspec Marine & Osprey Boats]]
- [[Talley's Group]]
- [[Victor Packaging Limited]]
- [[Speedy Signs Nelson - Laser Upgrade & Software]]
- [[Fivestar Print - CO2 + Fiber Multi-Machine Setup]]
- [[Cristy Aydon - Fully Promoted Nelson]]
- [[MainFreight]]
- [[Focused Joinery]]
- [[Graphic Maker]]

## Team

- [[Sequoia]]

## Partners

- [[Creditflex]]
```

- [ ] **Step 2: Write dropshipping initiative file**

Write to `.../memory/shared/context/current/initiative-dropshipping-portfolio.md`:

```markdown
---
id: initiative-dropshipping-portfolio
title: Dropshipping Portfolio Initiative
project: shared
memory_type: current_context
status: active
revision: 1
canonical: true
memory_layer: situation
initiative_slug: dropshipping-portfolio
tags:
  - initiative
  - dropshipping-portfolio
  - situation
created_at: "2026-05-30T00:00:00Z"
updated_at: "2026-05-30T00:00:00Z"
author_client: context-os
source_urls: []
---

# Dropshipping Portfolio Initiative

Exclusive Moto (TrayRig), Kieran collab stores, sourcing automation.
```

- [ ] **Step 3: Write software-infrastructure initiative file**

Write to `.../memory/shared/context/current/initiative-software-infrastructure.md`:

```markdown
---
id: initiative-software-infrastructure
title: Software Infrastructure Initiative
project: shared
memory_type: current_context
status: active
revision: 1
canonical: true
memory_layer: situation
initiative_slug: software-infrastructure
tags:
  - initiative
  - software-infrastructure
  - situation
created_at: "2026-05-30T00:00:00Z"
updated_at: "2026-05-30T00:00:00Z"
author_client: context-os
source_urls: []
---

# Software Infrastructure Initiative

Memory system, MCP servers, Context OS, internal tooling.

## Projects

- [[memory-system-mcp]]
```

---

## Task 10: Deploy and run migration

- [ ] **Step 1: Run full test suite before deploy**

```bash
cd /Users/fabienbrocklesby/Code/personal/memory-system-mcp
npx vitest run 2>&1 | tail -30
```
Expected: all tests pass.

- [ ] **Step 2: Build to check for TypeScript errors**

```bash
npx tsc --noEmit 2>&1 | head -40
```
Expected: no errors.

- [ ] **Step 3: Deploy to Cloudflare**

```bash
npx wrangler deploy 2>&1 | tail -20
```
Expected: deploy succeeds.

- [ ] **Step 4: Run vault backfill for light-lane via MCP**

Call the `admin_sync_vault_from_d1` MCP tool:
```
admin_sync_vault_from_d1({ project: "light-lane", dry_run: false })
```
Expected response includes counts: `{ entities: N, facts: N, tasks: N, events: N, errors: 0 }`.

- [ ] **Step 5: Verify vault files appeared locally**

```bash
ls "/Users/fabienbrocklesby/Library/CloudStorage/ZohoWorkDriveTrueSync-LightLane/My Folders/memory/projects/light-lane/knowledge/entities/companies/" 2>/dev/null | head -10
ls "/Users/fabienbrocklesby/Library/CloudStorage/ZohoWorkDriveTrueSync-LightLane/My Folders/memory/projects/light-lane/operational/tasks/" 2>/dev/null | head -10
```
Expected: entity and task files present.

- [ ] **Step 6: Trigger reindex**

```bash
# Via the admin_reindex_all MCP tool — this will be called via the MCP, not bash
```
Call `admin_reindex_all` in the MCP tool.

- [ ] **Step 7: Open Obsidian graph and verify**

Open Obsidian → Graph View. Expected:
- Coloured nodes by layer (initiatives purple, entities orange, facts yellow, sessions green, tasks teal)
- Wikilinks creating edges between entity files and related context files
- A noticeably richer, more interconnected graph than before
