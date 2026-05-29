# Context OS Intelligence Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a four-layer memory model with intent-classified retrieval and an actionability model to eliminate stale context surfacing, then refactor the god-class architecture into focused, maintainable modules.

**Architecture:** Two migrations add `actionability`/`resolve_after` to entity_states and `memory_layer` to documents. A `RetrievalIntent` enum drives layer-aware filtering in ranking so planning queries never surface blocked items. The 6,765-line `service.ts`, 2,853-line `tools.ts`, and 3,875-line `repository.ts` are split into focused service and repository classes, each under 400 lines.

**Tech Stack:** Cloudflare Workers (TypeScript), D1 (SQLite), Cloudflare Vectorize, Zod 4, MCP SDK, Vitest (node environment, `~/` alias)

---

## Phase 1 — Schema Additions

### Task 1: Migration 0009 — actionability fields on entity_states

**Files:**
- Create: `migrations/0009_actionability.sql`

- [ ] **Step 1.1: Create the migration file**

```sql
-- migrations/0009_actionability.sql
ALTER TABLE entity_states ADD COLUMN actionability TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE entity_states ADD COLUMN resolve_after TEXT;

CREATE INDEX IF NOT EXISTS idx_entity_states_actionability
  ON entity_states(project, entity_id, actionability, resolve_after)
  WHERE status = 'active';
```

- [ ] **Step 1.2: Apply locally and verify**

```bash
npx wrangler d1 migrations apply DB --local
```

Expected: `✅ Applied 1 migrations`

- [ ] **Step 1.3: Commit**

```bash
git add migrations/0009_actionability.sql
git commit -m "feat: add actionability fields to entity_states"
```

---

### Task 2: Migration 0010 — memory_layer on documents

**Files:**
- Create: `migrations/0010_memory_layer.sql`

- [ ] **Step 2.1: Create the migration file**

```sql
-- migrations/0010_memory_layer.sql
ALTER TABLE documents ADD COLUMN memory_layer TEXT;

CREATE INDEX IF NOT EXISTS idx_documents_memory_layer
  ON documents(project, memory_layer, status, active);
```

- [ ] **Step 2.2: Apply locally and verify**

```bash
npx wrangler d1 migrations apply DB --local
```

Expected: `✅ Applied 1 migrations`

- [ ] **Step 2.3: Commit**

```bash
git add migrations/0010_memory_layer.sql
git commit -m "feat: add memory_layer column to documents"
```

---

## Phase 2 — Type Foundation

### Task 3: Add MemoryLayer type to domain/memory.ts

**Files:**
- Modify: `src/domain/memory.ts`

- [ ] **Step 3.1: Add the MemoryLayer type after the existing memoryStatusSchema**

In `src/domain/memory.ts`, after the `memoryStatusSchema` declaration (line ~14), add:

```typescript
export const memoryLayerSchema = z.enum(["situation", "knowledge", "operational", "event_log"]);
export type MemoryLayer = z.infer<typeof memoryLayerSchema>;
```

- [ ] **Step 3.2: Add memoryLayer to MemorySearchHit**

In `src/domain/memory.ts`, in the `MemorySearchHit` type (after the `url?` field), add:

```typescript
  memoryLayer?: MemoryLayer;
```

- [ ] **Step 3.3: Add memoryLayer to MemoryFrontmatter schema**

In `src/domain/memory.ts`, in the `frontmatterSchema` z.object call (after the `canonical` field), add:

```typescript
  memory_layer: memoryLayerSchema.optional(),
```

- [ ] **Step 3.4: Typecheck**

```bash
npm run typecheck
```

Expected: no errors

- [ ] **Step 3.5: Commit**

```bash
git add src/domain/memory.ts
git commit -m "feat: add MemoryLayer type and memoryLayer to search hits"
```

---

### Task 4: Add RetrievalIntent to request-classification.ts

**Files:**
- Modify: `src/domain/request-classification.ts`
- Modify: `tests/unit/request-classification.test.ts`

- [ ] **Step 4.1: Write failing tests**

Add to `tests/unit/request-classification.test.ts`:

```typescript
import { classifyRequest, deriveRetrievalIntent } from "~/domain/request-classification";

describe("deriveRetrievalIntent", () => {
  it("returns 'planning' for prioritization queries", () => {
    const classification = classifyRequest("what should I focus on this week");
    expect(deriveRetrievalIntent(classification, "what should I focus on this week")).toBe("planning");
  });

  it("returns 'planning' for push/work-on queries", () => {
    const classification = classifyRequest("what should I push on now");
    expect(deriveRetrievalIntent(classification, "what should I push on now")).toBe("planning");
  });

  it("returns 'knowledge' for explain queries", () => {
    const classification = classifyRequest("explain the module architecture");
    expect(deriveRetrievalIntent(classification, "explain the module architecture")).toBe("knowledge");
  });

  it("returns 'status' for current-state queries", () => {
    const classification = classifyRequest("what is the status of the HamiltonJet deal");
    expect(deriveRetrievalIntent(classification, "what is the status of the HamiltonJet deal")).toBe("status");
  });

  it("returns 'historical' for history queries", () => {
    const classification = classifyRequest("what happened with FiveStar Print");
    expect(deriveRetrievalIntent(classification, "what happened with FiveStar Print")).toBe("historical");
  });

  it("returns 'general' for ambiguous queries", () => {
    const classification = classifyRequest("tell me something");
    expect(deriveRetrievalIntent(classification, "tell me something")).toBe("general");
  });
});
```

- [ ] **Step 4.2: Run tests to confirm failure**

```bash
npm test -- tests/unit/request-classification.test.ts
```

Expected: FAIL — `deriveRetrievalIntent is not a function`

- [ ] **Step 4.3: Add RetrievalIntent type and deriveRetrievalIntent function**

Add to the end of `src/domain/request-classification.ts`:

```typescript
export type RetrievalIntent = "planning" | "knowledge" | "status" | "historical" | "general";

export function deriveRetrievalIntent(
  classification: RequestClassification,
  userIntent?: string,
): RetrievalIntent {
  const text = (userIntent ?? "").toLowerCase();

  if (/\b(history|what happened|walk me through|recap)\b/.test(text)) {
    return "historical";
  }

  if (/\b(what is the status|status of|where are we with|update on|latest on)\b/.test(text)) {
    return "status";
  }

  if (
    classification.categories.planning_scheduling ||
    /\b(what should i|push on|focus on|work on|prioriti[sz]e|most important|best move|what.s next)\b/.test(text)
  ) {
    return "planning";
  }

  if (/\b(explain|tell me about|how does|describe|what is|what are)\b/.test(text)) {
    return "knowledge";
  }

  return "general";
}
```

- [ ] **Step 4.4: Run tests to confirm pass**

```bash
npm test -- tests/unit/request-classification.test.ts
```

Expected: all tests PASS

- [ ] **Step 4.5: Commit**

```bash
git add src/domain/request-classification.ts tests/unit/request-classification.test.ts
git commit -m "feat: add RetrievalIntent classification"
```

---

### Task 5: Add layer-aware filtering to ranking.ts

**Files:**
- Modify: `src/domain/ranking.ts`
- Modify: `tests/unit/retrieval-policy.test.ts`

- [ ] **Step 5.1: Write failing tests**

Add to `tests/unit/retrieval-policy.test.ts`:

```typescript
import { rerankSearchHits } from "~/domain/ranking";
import type { MemoryLayer } from "~/domain/memory";

function makeLayeredHit(
  documentId: string,
  layer: MemoryLayer,
  score: number,
): MemorySearchHit {
  return {
    ...makeHit(documentId, 0, score),
    memoryLayer: layer,
    memoryType: layer === "event_log" ? "session_summary" : "current_context",
    status: "historical" as const,
  };
}

describe("rerankSearchHits with layer filtering", () => {
  it("excludes event_log hits when excludeLayers includes event_log", () => {
    const hits = [
      makeLayeredHit("session-old", "event_log", 0.95),
      makeLayeredHit("current-state", "operational", 0.7),
      makeLayeredHit("knowledge-doc", "knowledge", 0.6),
    ];

    const result = rerankSearchHits(hits, {
      excludeLayers: ["event_log"],
      includeSuperseded: true,
    });

    expect(result.map((h) => h.documentId)).not.toContain("session-old");
    expect(result.map((h) => h.documentId)).toContain("current-state");
  });

  it("boosts situation layer docs to the top", () => {
    const hits = [
      makeLayeredHit("knowledge-doc", "knowledge", 0.9),
      makeLayeredHit("situation-doc", "situation", 0.5),
    ];

    const result = rerankSearchHits(hits, { includeSuperseded: true });

    expect(result[0].documentId).toBe("situation-doc");
  });

  it("strongly penalises event_log when not excluded but included", () => {
    const hits = [
      makeLayeredHit("session-old", "event_log", 0.99),
      makeLayeredHit("knowledge-doc", "knowledge", 0.6),
    ];

    const result = rerankSearchHits(hits, { includeSuperseded: true });

    expect(result[0].documentId).toBe("knowledge-doc");
  });
});
```

- [ ] **Step 5.2: Run tests to confirm failure**

```bash
npm test -- tests/unit/retrieval-policy.test.ts
```

Expected: FAIL

- [ ] **Step 5.3: Update rerankSearchHits signature and filtering**

Replace `src/domain/ranking.ts` with:

```typescript
import { isRetrievableMemoryStatus, type MemoryLayer, type MemorySearchHit } from "~/domain/memory";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export function rerankSearchHits(
  hits: MemorySearchHit[],
  options: {
    includeSuperseded?: boolean;
    now?: number;
    project?: string;
    repo?: string;
    path?: string;
    excludeLayers?: MemoryLayer[];
  } = {},
) {
  const now = options.now ?? Date.now();
  return [...hits]
    .filter((hit) => options.includeSuperseded || !hit.superseded)
    .filter((hit) => options.includeSuperseded || isRetrievableMemoryStatus(hit.status))
    .filter((hit) => {
      if (!options.excludeLayers?.length || !hit.memoryLayer) return true;
      return !options.excludeLayers.includes(hit.memoryLayer);
    })
    .map((hit) => ({ hit, rankingScore: computeRankingScore(hit, now, options) }))
    .sort((a, b) => b.rankingScore - a.rankingScore)
    .map(({ hit }) => hit);
}

function computeRankingScore(
  hit: MemorySearchHit,
  now: number,
  options: { project?: string; repo?: string; path?: string },
): number {
  let score = hit.score;

  // Layer boosts — most important signal
  if (hit.memoryLayer === "situation") score += 0.45;
  if (hit.memoryLayer === "knowledge") score += 0.15;
  if (hit.memoryLayer === "event_log") score -= 0.40;

  // Project match
  if (options.project && hit.project === options.project) score += 0.18;
  if (options.project && hit.project === "shared") score -= 0.03;

  // Repo and path match
  if (options.repo && hit.repo === options.repo.toLowerCase()) score += 0.08;
  if (options.path && hit.repoPath?.includes(options.path)) score += 0.05;

  // Document quality signals
  if (hit.active) score += 0.12;
  if (hit.memoryType === "current_context") score += 0.20;
  if (hit.memoryType === "decision") score += 0.10;
  if (hit.memoryType === "session_summary") score -= 0.05;
  if (hit.memoryType === "snippet" || hit.memoryType === "repo_index") score += 0.03;
  if (hit.status === "historical") score -= 0.08;
  if (hit.superseded) score -= 0.25;

  // Freshness (decays over 30 days)
  const age = Math.max(0, now - hit.updatedAtUnix * 1000);
  score += Math.max(0, 1 - age / THIRTY_DAYS_MS) * 0.1;

  // Curator signals
  score += (hit.usefulness ?? 0) * 0.04;
  score += (hit.confidence ?? 0) * 0.03;

  return score;
}
```

- [ ] **Step 5.4: Run tests to confirm pass**

```bash
npm test -- tests/unit/retrieval-policy.test.ts
```

Expected: all tests PASS

- [ ] **Step 5.5: Commit**

```bash
git add src/domain/ranking.ts tests/unit/retrieval-policy.test.ts
git commit -m "feat: add layer-aware filtering and boosts to ranking"
```

---

## Phase 3 — Intelligence Features

### Task 6: Add memory_layer to Vectorize indexing

**Files:**
- Modify: `src/integrations/vectorize/client.ts`
- Modify: `src/persistence/d1/repository.ts` (DocumentRow type)

- [ ] **Step 6.1: Add memory_layer to ChunkVectorMetadata**

In `src/integrations/vectorize/client.ts`, add to the `ChunkVectorMetadata` type (after `url?`):

```typescript
  memory_layer?: string;
```

- [ ] **Step 6.2: Add memory_layer to replaceDocumentVectors input**

In `src/integrations/vectorize/client.ts`, add to the `replaceDocumentVectors` input type (after `url?`):

```typescript
    memoryLayer?: string | null;
```

- [ ] **Step 6.3: Include memory_layer in vector metadata**

In `replaceDocumentVectors`, inside the `metadata` object spread (after the `url` conditional), add:

```typescript
      ...(input.memoryLayer ? { memory_layer: input.memoryLayer } : {}),
```

- [ ] **Step 6.4: Add memory_layer to Vectorize filter**

In `buildFilter` in `src/integrations/vectorize/client.ts`, add before the closing check (after the `source` filter block):

```typescript
  if ((filters as { memoryLayer?: string }).memoryLayer) {
    filter.memory_layer = (filters as { memoryLayer?: string }).memoryLayer!;
  }
```

- [ ] **Step 6.5: Add memory_layer to MemorySearchHit hydration**

In `queryMemoryIndexWithDiagnostics`, in the `hits.push({...})` block (after `url: metadata.url`), add:

```typescript
        memoryLayer: metadata.memory_layer as MemorySearchHit["memoryLayer"] | undefined,
```

- [ ] **Step 6.6: Add memory_layer to DocumentRow type in repository.ts**

In `src/persistence/d1/repository.ts`, in the `DocumentRow` type (after `usefulness`), add:

```typescript
  memory_layer: string | null;
```

- [ ] **Step 6.7: Update all repository methods that read DocumentRow to map memory_layer**

Search `src/persistence/d1/repository.ts` for `mapDocument` or wherever `DocumentRow` is mapped to `ResolvedMemoryDocument`. Add `memoryLayer: row.memory_layer as MemoryLayer | undefined ?? undefined` to the mapped object.

Note: `ResolvedMemoryDocument` in `src/domain/memory.ts` needs `memoryLayer?: MemoryLayer` added to it as well. Add it after `usefulness`.

- [ ] **Step 6.8: Typecheck**

```bash
npm run typecheck
```

Expected: no errors

- [ ] **Step 6.9: Commit**

```bash
git add src/integrations/vectorize/client.ts src/persistence/d1/repository.ts src/domain/memory.ts
git commit -m "feat: propagate memory_layer through vectorize indexing and document hydration"
```

---

### Task 7: Intent-aware searchMemory in service.ts

**Files:**
- Modify: `src/domain/service.ts`

- [ ] **Step 7.1: Import the new types at the top of service.ts**

Add to the existing imports from `~/domain/request-classification`:

```typescript
import { ..., deriveRetrievalIntent, type RetrievalIntent } from "~/domain/request-classification";
```

- [ ] **Step 7.2: Add retrieval_intent to searchMemory input type**

In `src/domain/service.ts`, find the `searchMemory` method signature (around line 597). Add to its input object:

```typescript
    retrieval_intent?: RetrievalIntent;
```

- [ ] **Step 7.3: Apply layer exclusion based on intent**

In the `searchMemory` method, after the existing `rerankSearchHits` call, apply the following pattern. Find the block that calls `rerankSearchHits` and add the `excludeLayers` option:

```typescript
// Derive intent from explicit input or from classification
const intent = input.retrieval_intent ?? deriveRetrievalIntent(
  classifyRequest(input.query),
  input.query,
);

// Planning queries: never surface old sessions
const excludeLayers = intent === "planning" || intent === "general"
  ? ["event_log" as const]
  : intent === "status"
  ? ["event_log" as const]
  : [];

// Pass excludeLayers to rerankSearchHits
// (find the existing rerankSearchHits call and add excludeLayers to its options)
```

Find the existing `rerankSearchHits(hits, { ... })` call in `searchMemory` and add `excludeLayers` to the options object:

```typescript
rerankSearchHits(hits, {
  project: input.project,
  repo: input.repo,
  path: input.path,
  includeSuperseded: input.includeSuperseded,
  excludeLayers,  // add this
})
```

- [ ] **Step 7.4: Typecheck**

```bash
npm run typecheck
```

Expected: no errors

- [ ] **Step 7.5: Commit**

```bash
git add src/domain/service.ts
git commit -m "feat: apply retrieval intent layer exclusion in searchMemory"
```

---

### Task 8: Situation document first-read in prepare_assistant_session

**Files:**
- Modify: `src/domain/service.ts`

- [ ] **Step 8.1: Add a helper to find the situation document**

In `src/domain/service.ts`, add this private helper method to `MemoryService` (place it near other private helpers):

```typescript
private async findSituationDocument(project: string): Promise<ResolvedMemoryDocument | null> {
  const docs = await this.repo.findDocumentsByLayer({
    project: "shared",
    memoryLayer: "situation",
    canonical: true,
    limit: 1,
  });
  return docs[0] ?? null;
}
```

- [ ] **Step 8.2: Add findDocumentsByLayer to repository.ts**

In `src/persistence/d1/repository.ts`, add this method to `MemoryRepository`:

```typescript
async findDocumentsByLayer(input: {
  project: string;
  memoryLayer: string;
  canonical?: boolean;
  limit?: number;
}): Promise<ResolvedMemoryDocument[]> {
  const limit = input.limit ?? 10;
  const rows = await this.db
    .prepare(
      `SELECT d.*, s.raw_markdown, s.body_markdown, s.frontmatter_json
       FROM documents d
       LEFT JOIN document_snapshots s ON s.id = d.current_snapshot_id
       WHERE d.memory_layer = ?
         AND d.status != 'archived'
         AND d.active = 1
         ${input.canonical !== undefined ? "AND d.canonical = ?" : ""}
       ORDER BY d.updated_at DESC
       LIMIT ?`,
    )
    .bind(
      input.memoryLayer,
      ...(input.canonical !== undefined ? [input.canonical ? 1 : 0] : []),
      limit,
    )
    .all<DocumentRow & { raw_markdown?: string; body_markdown?: string; frontmatter_json?: string }>();
  return rows.results.map((row) => this.mapDocument(row));
}
```

- [ ] **Step 8.3: Include situation document in prepareAssistantSession response**

In `prepareAssistantSession` in `src/domain/service.ts`, find where the response object is assembled. Before the main retrieval loop, add:

```typescript
const situationDoc = await this.findSituationDocument(resolvedProject);
```

Then in the response assembly, add `situation` as a top-level field:

```typescript
situation: situationDoc
  ? {
      content: situationDoc.bodyMarkdown ?? null,
      path: situationDoc.path,
      updated_at: situationDoc.updatedAt ?? null,
    }
  : null,
```

- [ ] **Step 8.4: Typecheck**

```bash
npm run typecheck
```

Expected: no errors

- [ ] **Step 8.5: Commit**

```bash
git add src/domain/service.ts src/persistence/d1/repository.ts
git commit -m "feat: read situation document first in prepare_assistant_session"
```

---

### Task 9: New tools — upsert_situation and set_entity_actionability

**Files:**
- Modify: `src/mcp/tools.ts`
- Modify: `src/domain/service.ts`

- [ ] **Step 9.1: Add setSituationDocument service method**

Add to `MemoryService` in `src/domain/service.ts`:

```typescript
async setSituationDocument(input: {
  financial_position?: string;
  location?: string;
  top_priorities?: string[];
  key_constraints?: string[];
  active_initiatives?: string[];
  notes?: string;
}) {
  const sections: string[] = ["# Current Situation"];

  if (input.financial_position) {
    sections.push(`## Financial Position\n${input.financial_position}`);
  }
  if (input.location) {
    sections.push(`## Current Location\n${input.location}`);
  }
  if (input.top_priorities?.length) {
    sections.push(`## Top Priorities\n${input.top_priorities.map((p) => `- ${p}`).join("\n")}`);
  }
  if (input.key_constraints?.length) {
    sections.push(`## Key Constraints\n${input.key_constraints.map((c) => `- ${c}`).join("\n")}`);
  }
  if (input.active_initiatives?.length) {
    sections.push(`## Active Initiatives\n${input.active_initiatives.map((i) => `- ${i}`).join("\n")}`);
  }
  if (input.notes) {
    sections.push(`## Notes\n${input.notes}`);
  }

  const body = sections.join("\n\n");
  const now = new Date().toISOString();

  // Find existing situation doc or create new
  const existing = await this.findSituationDocument("shared");

  const frontmatter = {
    id: existing?.id ?? crypto.randomUUID(),
    title: "Current Situation",
    project: "shared",
    memory_type: "current_context" as const,
    status: "active" as const,
    revision: (existing?.revision ?? 0) + 1,
    tags: ["situation", "personal"],
    created_at: existing?.createdAt ?? now,
    updated_at: now,
    author_client: "context-os",
    canonical: true,
    memory_layer: "situation",
  };

  return this.writeDocumentToWorkDrive({
    project: "shared",
    folder: "context/current",
    fileName: "situation.md",
    frontmatter,
    body,
  });
}
```

- [ ] **Step 9.2: Add setEntityActionability service method**

Add to `MemoryService` in `src/domain/service.ts`:

```typescript
async setEntityActionability(input: {
  project: string;
  entitySlug: string;
  stateKey: string;
  actionability: "active" | "ready" | "waiting" | "blocked" | "unknown";
  resolveAfter?: string;
  reason?: string;
}) {
  const entity = await this.repo.findEntityBySlug(input.project, input.entitySlug);
  if (!entity) {
    throw new Error(`Entity not found: ${input.entitySlug} in project ${input.project}`);
  }

  await this.repo.updateEntityStateActionability({
    project: input.project,
    entityId: entity.id,
    stateKey: input.stateKey,
    actionability: input.actionability,
    resolveAfter: input.resolveAfter ?? null,
    updatedAt: new Date().toISOString(),
  });

  return {
    entity_slug: input.entitySlug,
    state_key: input.stateKey,
    actionability: input.actionability,
    resolve_after: input.resolveAfter ?? null,
    reason: input.reason ?? null,
  };
}
```

- [ ] **Step 9.3: Add updateEntityStateActionability to repository.ts**

Add to `MemoryRepository` in `src/persistence/d1/repository.ts`:

```typescript
async updateEntityStateActionability(input: {
  project: string;
  entityId: string;
  stateKey: string;
  actionability: string;
  resolveAfter: string | null;
  updatedAt: string;
}): Promise<void> {
  await this.db
    .prepare(
      `UPDATE entity_states
       SET actionability = ?, resolve_after = ?, updated_at = ?
       WHERE project = ? AND entity_id = ? AND state_key = ? AND status = 'active'`,
    )
    .bind(
      input.actionability,
      input.resolveAfter,
      input.updatedAt,
      input.project,
      input.entityId,
      input.stateKey,
    )
    .run();
}
```

- [ ] **Step 9.4: Register upsert_situation tool in tools.ts**

In `src/mcp/tools.ts`, add the new tool registration (place it near the existing `finish_work_session` registration):

```typescript
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
      location: z
        .string()
        .optional()
        .describe("Where you are and where you're going, e.g. 'In Nelson this week, moving to Christchurch in 2 weeks'"),
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
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  },
);
```

- [ ] **Step 9.5: Register set_entity_actionability tool in tools.ts**

```typescript
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
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  },
);
```

- [ ] **Step 9.6: Typecheck**

```bash
npm run typecheck
```

Expected: no errors

- [ ] **Step 9.7: Commit**

```bash
git add src/domain/service.ts src/persistence/d1/repository.ts src/mcp/tools.ts
git commit -m "feat: add upsert_situation and set_entity_actionability tools"
```

---

### Task 10: Admin tool — backfill_memory_layers

**Files:**
- Modify: `src/domain/service.ts`
- Modify: `src/mcp/tools.ts`

- [ ] **Step 10.1: Add backfillMemoryLayers service method**

Add to `MemoryService` in `src/domain/service.ts`:

```typescript
async backfillMemoryLayers(input: { dryRun?: boolean } = {}): Promise<{
  updated: number;
  skipped: number;
  dry_run: boolean;
  samples: Array<{ path: string; memory_type: string; canonical: boolean; assigned_layer: string }>;
}> {
  const dryRun = input.dryRun !== false; // default to dry run

  const rows = await this.repo.getAllDocumentsForLayerBackfill();
  let updated = 0;
  let skipped = 0;
  const samples: Array<{ path: string; memory_type: string; canonical: boolean; assigned_layer: string }> = [];

  for (const row of rows) {
    if (row.memory_layer) {
      skipped++;
      continue;
    }

    const layer = inferMemoryLayer(row.memory_type, row.canonical);

    if (samples.length < 20) {
      samples.push({
        path: row.path,
        memory_type: row.memory_type,
        canonical: row.canonical,
        assigned_layer: layer,
      });
    }

    if (!dryRun) {
      await this.repo.setDocumentMemoryLayer(row.id, layer);
    }
    updated++;
  }

  return { updated, skipped, dry_run: dryRun, samples };
}
```

Add the `inferMemoryLayer` helper as a module-level function at the bottom of `service.ts`:

```typescript
function inferMemoryLayer(
  memoryType: string,
  canonical: boolean,
): "situation" | "knowledge" | "operational" | "event_log" {
  if (memoryType === "session_summary" || memoryType === "historical_note") {
    return "event_log";
  }
  if (canonical && (memoryType === "current_context" || memoryType === "decision" || memoryType === "snippet" || memoryType === "repo_index")) {
    return "knowledge";
  }
  if (memoryType === "decision" || memoryType === "snippet" || memoryType === "repo_index") {
    return "knowledge";
  }
  return "operational";
}
```

- [ ] **Step 10.2: Add repository methods for backfill**

Add to `MemoryRepository` in `src/persistence/d1/repository.ts`:

```typescript
async getAllDocumentsForLayerBackfill(): Promise<
  Array<{ id: string; path: string; memory_type: string; canonical: boolean; memory_layer: string | null }>
> {
  const rows = await this.db
    .prepare(
      "SELECT id, path, memory_type, canonical, memory_layer FROM documents ORDER BY created_at ASC",
    )
    .all<{ id: string; path: string; memory_type: string; canonical: number; memory_layer: string | null }>();
  return rows.results.map((row) => ({
    id: row.id,
    path: row.path,
    memory_type: row.memory_type,
    canonical: row.canonical === 1,
    memory_layer: row.memory_layer,
  }));
}

async setDocumentMemoryLayer(documentId: string, layer: string): Promise<void> {
  const now = new Date().toISOString();
  await this.db
    .prepare("UPDATE documents SET memory_layer = ?, updated_at = ? WHERE id = ?")
    .bind(layer, now, documentId)
    .run();
}
```

- [ ] **Step 10.3: Register backfill_memory_layers tool in tools.ts**

```typescript
server.registerTool(
  "backfill_memory_layers",
  {
    description:
      "Assign memory_layer to all existing documents that do not yet have one, based on their memory_type and canonical flag. Run dry_run=true first to preview. Apply with dry_run=false.",
    inputSchema: z.object({
      dry_run: z
        .boolean()
        .optional()
        .describe("Default true. Set to false to actually apply the backfill."),
    }),
  },
  async (input) => {
    const result = await service.backfillMemoryLayers({ dryRun: input.dry_run !== false });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  },
);
```

- [ ] **Step 10.4: Typecheck**

```bash
npm run typecheck
```

Expected: no errors

- [ ] **Step 10.5: Commit**

```bash
git add src/domain/service.ts src/persistence/d1/repository.ts src/mcp/tools.ts
git commit -m "feat: add backfill_memory_layers admin tool"
```

---

## Phase 4 — Deploy Intelligence Features

### Task 11: Migrate production DB and deploy

- [ ] **Step 11.1: Run full test suite**

```bash
npm test
```

Expected: all tests pass

- [ ] **Step 11.2: Run typecheck**

```bash
npm run typecheck
```

Expected: no errors

- [ ] **Step 11.3: Apply migrations to production**

```bash
npm run migrate:production
```

Expected: `✅ Applied 2 migrations` (0009 and 0010)

- [ ] **Step 11.4: Deploy to production**

```bash
npm run deploy
```

Expected: successful deploy

- [ ] **Step 11.5: Backfill memory layers on production**

Call the MCP tool via Claude Code:

```
context-os.backfill_memory_layers(dry_run: true)
```

Review the output. Then apply:

```
context-os.backfill_memory_layers(dry_run: false)
```

- [ ] **Step 11.6: Set actionability on known stale deals**

```
context-os.set_entity_actionability(
  project: "light-lane",
  entity_slug: "fivestar-print",
  state_key: "deal_stage",
  actionability: "waiting",
  resolve_after: "2026-09-01",
  reason: "Waiting on finance partner before revised proposal. Sequoia commission also pending formalisation."
)

context-os.set_entity_actionability(
  project: "light-lane",
  entity_slug: "fully-promoted-cristy-aydon",
  state_key: "deal_stage",
  actionability: "waiting",
  resolve_after: "2026-09-01",
  reason: "Sequoia commissioned account, deal timing unclear. Re-evaluate after Sequoia contract resolved."
)
```

- [ ] **Step 11.7: Create situational awareness document**

Call `upsert_situation` with current known facts.

---

## Phase 5 — Code Architecture Refactor

The refactor splits the three god-files into focused modules. No new logic is introduced — all code is mechanically extracted. Each service file receives a subset of methods from `MemoryService`. The repositories split from `MemoryRepository`.

### Task 12: Create persistence/d1/types.ts — extract row types

**Files:**
- Create: `src/persistence/d1/types.ts`

- [ ] **Step 12.1: Create the file**

Extract ALL row type definitions from `src/persistence/d1/repository.ts` (the types named `*Row` at the top — `DocumentRow`, `SnapshotRow`, `ProjectRow`, etc.) into a new file:

```typescript
// src/persistence/d1/types.ts
// Database row types — one type per D1 table row. No logic.

export type DocumentRow = {
  id: string;
  workdrive_file_id: string;
  path: string;
  title: string;
  project: string;
  namespace: string;
  parent_folder_id: string;
  file_name: string;
  permalink: string | null;
  download_url: string | null;
  memory_type: string;
  status: string;
  canonical: number;
  active: number;
  revision: number;
  current_snapshot_id: string | null;
  last_remote_modified_at: number | null;
  source: string | null;
  source_url: string | null;
  repo: string | null;
  repo_path: string | null;
  tags_json: string | null;
  confidence: number | null;
  usefulness: number | null;
  superseded_by_document_id: string | null;
  memory_layer: string | null;
};

export type SnapshotRow = {
  id: string;
  document_id: string;
  revision: number;
  raw_markdown: string;
  body_markdown: string;
  frontmatter_json: string;
};
```

Continue extracting ALL row types from `repository.ts`. After extracting, add `import type { ... } from "~/persistence/d1/types"` to `repository.ts` and remove the inline type definitions.

- [ ] **Step 12.2: Typecheck**

```bash
npm run typecheck
```

Expected: no errors

- [ ] **Step 12.3: Commit**

```bash
git add src/persistence/d1/types.ts src/persistence/d1/repository.ts
git commit -m "refactor: extract D1 row types to persistence/d1/types.ts"
```

---

### Task 13: Create persistence/d1/DocumentRepository.ts

**Files:**
- Create: `src/persistence/d1/DocumentRepository.ts`

- [ ] **Step 13.1: Create the file with document-related methods**

Create `src/persistence/d1/DocumentRepository.ts`. Extract from `MemoryRepository` in `repository.ts` all methods that touch the `documents`, `document_snapshots`, `chunks`, `reindex_jobs`, and `sync_runs` tables. The constructor takes `db: D1Database`.

The interface of this class should expose:
- `getDocument(path: string): Promise<ResolvedMemoryDocument | null>`
- `upsertDocument(input): Promise<ResolvedMemoryDocument>`
- `findDocumentsByProject(project, options): Promise<ResolvedMemoryDocument[]>`
- `findDocumentsByLayer(input): Promise<ResolvedMemoryDocument[]>`
- `setDocumentMemoryLayer(id, layer): Promise<void>`
- `getAllDocumentsForLayerBackfill(): Promise<...>`
- `upsertSnapshot(input): Promise<string>`
- `getCurrentSnapshot(documentId): Promise<SnapshotRow | null>`
- `upsertChunks(input): Promise<void>`
- `getChunksByDocument(documentId): Promise<ChunkRecord[]>`
- `createReindexJob(input): Promise<string>`
- `updateReindexJob(input): Promise<void>`
- `getReindexJobsByStatus(status): Promise<ReindexJobRow[]>`
- `recordSyncRun(input): Promise<void>`
- `updateSyncRun(input): Promise<void>`
- `archiveDocument(id, reason): Promise<void>`
- `supersedDocument(fromId, toId): Promise<void>`
- `keywordSearchDocuments(query, project, options): Promise<MemorySearchHit[]>`

Copy the exact method bodies from `MemoryRepository`. Change `this.db` references to use the local `db` instance.

- [ ] **Step 13.2: Typecheck**

```bash
npm run typecheck
```

Expected: no errors

- [ ] **Step 13.3: Commit**

```bash
git add src/persistence/d1/DocumentRepository.ts
git commit -m "refactor: extract DocumentRepository from MemoryRepository"
```

---

### Task 14: Create persistence/d1/EntityRepository.ts

**Files:**
- Create: `src/persistence/d1/EntityRepository.ts`

- [ ] **Step 14.1: Extract entity-related methods from MemoryRepository**

Create `src/persistence/d1/EntityRepository.ts`. Extract all methods touching `memory_entities`, `entity_aliases`, `entity_states`, `source_events`, `durable_facts`, `tasks`, `memory_links` tables.

Key public interface:
- `upsertEntity(input): Promise<MemoryEntity>`
- `findEntityBySlug(project, slug): Promise<MemoryEntity | null>`
- `listEntities(project, options): Promise<MemoryEntity[]>`
- `upsertEntityState(input): Promise<EntityState>`
- `getActiveEntityStates(entityId, project): Promise<EntityState[]>`
- `updateEntityStateActionability(input): Promise<void>`
- `listEntitiesWithActionability(project, options): Promise<...>`
- `saveSourceEvent(input): Promise<SourceEvent>`
- `listSourceEvents(project, options): Promise<SourceEvent[]>`
- `upsertFact(input): Promise<DurableFact>`
- `listFacts(project, options): Promise<DurableFact[]>`
- `upsertTask(input): Promise<ContextTask>`
- `listTasks(project, options): Promise<ContextTask[]>`
- `upsertMemoryLink(input): Promise<MemoryLink>`
- `listMemoryLinks(documentId): Promise<MemoryLink[]>`

Copy exact method bodies from `MemoryRepository`.

- [ ] **Step 14.2: Typecheck**

```bash
npm run typecheck
```

Expected: no errors

- [ ] **Step 14.3: Commit**

```bash
git add src/persistence/d1/EntityRepository.ts
git commit -m "refactor: extract EntityRepository from MemoryRepository"
```

---

### Task 15: Create persistence/d1/ProjectRepository.ts and InitiativeRepository.ts

**Files:**
- Create: `src/persistence/d1/ProjectRepository.ts`
- Create: `src/persistence/d1/InitiativeRepository.ts`

- [ ] **Step 15.1: Create ProjectRepository.ts**

Extract all methods touching `projects`, `project_github_repos`, `client_environments`, `tool_capabilities`, `environment_capabilities` tables. Key interface:
- `upsertProject(input): Promise<MemoryProject>`
- `getProject(slug): Promise<MemoryProject | null>`
- `listProjects(options): Promise<MemoryProject[]>`
- `updateProjectProfile(input): Promise<MemoryProject | null>`
- `recordProjectFolderCheck(input): Promise<void>`
- `associateGithubRepo(input): Promise<void>`
- `listProjectGithubRepos(project): Promise<ProjectGithubRepo[]>`
- `upsertClientEnvironment(input): Promise<ClientEnvironment>`
- `listClientEnvironments(): Promise<ClientEnvironment[]>`
- `upsertToolCapability(input): Promise<ToolCapability>`
- `listToolCapabilities(): Promise<ToolCapability[]>`
- `upsertEnvironmentCapability(input): Promise<EnvironmentCapability>`
- `listEnvironmentCapabilities(environmentSlug): Promise<EnvironmentCapability[]>`

- [ ] **Step 15.2: Create InitiativeRepository.ts**

Extract all methods touching `initiatives`, `strategy_nodes`, `strategy_milestones`, `strategy_assets`, `branch_projects`, `alignment_assessments`, `workdrive_canonicalization_manifests`, `context_truth_migration_manifests`, `migration_audit_events` tables.

Key interface:
- `upsertInitiative(input): Promise<MemoryInitiative>`
- `listInitiatives(options): Promise<MemoryInitiative[]>`
- `getInitiativeById(id): Promise<MemoryInitiative | null>`
- `upsertStrategyNode(input): Promise<StrategyNode>`
- `listStrategyNodes(project, type): Promise<StrategyNode[]>`
- `upsertMilestone(input): Promise<StrategyMilestone>`
- `listMilestones(project, options): Promise<StrategyMilestone[]>`
- `upsertAsset(input): Promise<StrategyAsset>`
- `listAssets(project, options): Promise<StrategyAsset[]>`
- `upsertBranchProject(input): Promise<BranchProject>`
- `getBranchProject(project): Promise<BranchProject | null>`
- `upsertAlignmentAssessment(input): Promise<AlignmentAssessment>`
- `recordMigrationAuditEvent(input): Promise<void>`
- `listMigrationAuditEvents(options): Promise<MigrationAuditEvent[]>`

- [ ] **Step 15.3: Typecheck**

```bash
npm run typecheck
```

Expected: no errors

- [ ] **Step 15.4: Commit**

```bash
git add src/persistence/d1/ProjectRepository.ts src/persistence/d1/InitiativeRepository.ts
git commit -m "refactor: extract ProjectRepository and InitiativeRepository"
```

---

### Task 16: Create service/ directory with focused services

**Files:**
- Create: `src/service/ProjectService.ts`
- Create: `src/service/DocumentService.ts`
- Create: `src/service/EntityService.ts`
- Create: `src/service/RetrievalService.ts`
- Create: `src/service/PlanningService.ts`
- Create: `src/service/InitiativeService.ts`

Each service class has this constructor pattern:

```typescript
export class FooService {
  constructor(
    private readonly env: Env,
    private readonly principal: MemoryPrincipal,
    private readonly fooRepo: FooRepository,
    // other repos as needed
  ) {}
}
```

Services do NOT instantiate their own repos — they receive them via constructor injection. The MCP server creates repos and injects them.

- [ ] **Step 16.1: Create ProjectService.ts**

Extract from `MemoryService`: `ensureProject`, `listProjects`, `getProject`, `updateProjectProfile`, `projectStatus`, `bootstrapProjectContext`.

Also include the GitHub-related methods: `listGithubRepos`, `getGithubFile`, `inspectGithubRepoStructure`, `searchGithubCode`, `saveGithubFileMemory`, `associateGithubRepo`, `listProjectGithubRepos`, `indexGithubRepoOverview`.

Constructor receives: `env, principal, projectRepo, documentRepo`.

- [ ] **Step 16.2: Create DocumentService.ts**

Extract: `getDocument`, `getCurrentContext`, `saveSnippet`, `writeSessionSummary`, `recordDecision`, `writeRepoIndexDocument`, `archiveMemoryDocument`, `updateContextDocument`, `finishWorkSession`, `reindexDocument`, `reindexAll`, `reconcileWorkDrive`, `adminStatus`, `setSituationDocument`.

Also add wiki link generation here (see Task 17).

Constructor receives: `env, principal, documentRepo, entityRepo, zoho, config`.

- [ ] **Step 16.3: Create EntityService.ts**

Extract: `upsertEntityState`, `getEntityCurrentState`, `resolveCurrentTruth`, `linkMemory`, `saveSourceEvent`, `extractDurableFacts`, `upsertTask`, `setEntityActionability`.

Constructor receives: `env, principal, entityRepo`.

- [ ] **Step 16.4: Create RetrievalService.ts**

Extract: `searchMemory`, `retrievalDiagnostics`, `contextHealthCheck`.

Constructor receives: `env, principal, documentRepo, entityRepo, config`.

- [ ] **Step 16.5: Create PlanningService.ts**

Extract: `prepareWorkSession`, `prepareAssistantSession`, `planRequest`, `resolveContext`, `dailyBriefing`.

Move ALL compaction/session-payload logic inline here (session-payload.ts content moves into this file, not imported separately).

Constructor receives: `env, principal, documentRepo, entityRepo, projectRepo, initiativeRepo, retrievalService, config`.

- [ ] **Step 16.6: Create InitiativeService.ts**

Extract: `upsertInitiative`, `listInitiatives`, `getInitiativeContext`, `upsertVision`, `listVisions`, `getStrategyContext`, `upsertAsset`, `listAssets`, `linkAsset`, `upsertMilestone`, `createBranchProject`, `checkAlignment`.

Constructor receives: `env, principal, initiativeRepo, entityRepo`.

- [ ] **Step 16.7: Typecheck**

```bash
npm run typecheck
```

Expected: no errors

- [ ] **Step 16.8: Commit**

```bash
git add src/service/
git commit -m "refactor: create focused service classes"
```

---

### Task 17: Add wiki link generation to DocumentService

**Files:**
- Modify: `src/service/DocumentService.ts`

- [ ] **Step 17.1: Write a test for wiki link generation**

Create `tests/unit/wiki-links.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { generateRelatedSection } from "~/service/DocumentService";

describe("generateRelatedSection", () => {
  it("generates a Related section with wiki links for matched entity names", () => {
    const entities = [
      { name: "HamiltonJet", slug: "hamiltonjet", type: "company" },
      { name: "FiveStar Print", slug: "fivestar-print", type: "company" },
    ];
    const bodyText = "We discussed the HamiltonJet proposal with the team.";

    const section = generateRelatedSection(bodyText, entities);

    expect(section).toContain("## Related");
    expect(section).toContain("[[HamiltonJet]]");
    expect(section).not.toContain("[[FiveStar Print]]");
  });

  it("returns empty string when no entities are mentioned", () => {
    const entities = [{ name: "HamiltonJet", slug: "hamiltonjet", type: "company" }];
    const bodyText = "A document about something completely different.";

    const section = generateRelatedSection(bodyText, entities);

    expect(section).toBe("");
  });

  it("does not duplicate the same entity", () => {
    const entities = [{ name: "HamiltonJet", slug: "hamiltonjet", type: "company" }];
    const bodyText = "HamiltonJet is great. HamiltonJet has a nice campus.";

    const section = generateRelatedSection(bodyText, entities);
    const count = (section.match(/\[\[HamiltonJet\]\]/g) ?? []).length;
    expect(count).toBe(1);
  });
});
```

- [ ] **Step 17.2: Run test to confirm failure**

```bash
npm test -- tests/unit/wiki-links.test.ts
```

Expected: FAIL — `generateRelatedSection is not a function`

- [ ] **Step 17.3: Implement generateRelatedSection**

Add to `src/service/DocumentService.ts` as an exported pure function:

```typescript
export function generateRelatedSection(
  bodyText: string,
  entities: Array<{ name: string; slug: string; type: string }>,
): string {
  const mentioned = entities.filter((entity) =>
    bodyText.toLowerCase().includes(entity.name.toLowerCase()),
  );

  if (mentioned.length === 0) return "";

  const links = mentioned.map((e) => `- [[${e.name}]]`).join("\n");
  return `\n\n## Related\n${links}`;
}
```

- [ ] **Step 17.4: Call generateRelatedSection in document write methods**

In `DocumentService`, find the methods that write documents to WorkDrive (`writeSessionSummary`, `finishWorkSession`, `recordDecision`, `saveSnippet`). In each, after the body content is assembled and BEFORE calling `writeDocumentToWorkDrive`:

```typescript
const knownEntities = await this.entityRepo.listEntitiesForWikiLinks(input.project);
const relatedSection = generateRelatedSection(body, knownEntities);
const bodyWithLinks = relatedSection ? body + relatedSection : body;
// use bodyWithLinks instead of body in the write call
```

Add `listEntitiesForWikiLinks` to `EntityRepository.ts`:

```typescript
async listEntitiesForWikiLinks(
  project: string,
): Promise<Array<{ name: string; slug: string; type: string }>> {
  const rows = await this.db
    .prepare("SELECT name, slug, type FROM memory_entities WHERE project = ? AND status = 'active' ORDER BY name ASC")
    .bind(project)
    .all<{ name: string; slug: string; type: string }>();
  return rows.results;
}
```

- [ ] **Step 17.5: Run tests to confirm pass**

```bash
npm test -- tests/unit/wiki-links.test.ts
```

Expected: all tests PASS

- [ ] **Step 17.6: Commit**

```bash
git add src/service/DocumentService.ts src/persistence/d1/EntityRepository.ts tests/unit/wiki-links.test.ts
git commit -m "feat: auto-generate wiki links in document write-back"
```

---

### Task 18: Create tool groups and wire new server.ts

**Files:**
- Create: `src/tools/project-tools.ts`
- Create: `src/tools/document-tools.ts`
- Create: `src/tools/entity-tools.ts`
- Create: `src/tools/retrieval-tools.ts`
- Create: `src/tools/planning-tools.ts`
- Create: `src/tools/initiative-tools.ts`
- Create: `src/tools/admin-tools.ts`
- Modify: `src/mcp/server.ts`

Each tool file exports a single `registerXxxTools(server, service)` function. The function takes an `McpServer` and the relevant service instances, and registers the tool group.

- [ ] **Step 18.1: Create tool files**

For each tool group, create the corresponding file. Extract the `server.registerTool(...)` calls from `src/mcp/tools.ts` into the appropriate file:

- `project-tools.ts`: `ensure_project`, `get_project`, `list_projects`, `update_project_profile`, `project_status`, `bootstrap_project_context`, GitHub tools
- `document-tools.ts`: `get_document`, `get_current_context`, `save_snippet`, `record_decision`, `write_session_summary`, `update_context_document`, `archive_memory_document`, `fetch`
- `entity-tools.ts`: `upsert_entity_state`, `get_entity_current_state`, `resolve_current_truth`, `link_memory`, `save_source_event`, `extract_durable_facts`, `upsert_task`, `set_entity_actionability`
- `retrieval-tools.ts`: `search_memory`, `retrieval_diagnostics`
- `planning-tools.ts`: `prepare_assistant_session`, `prepare_work_session`, `plan_request`, `finish_work_session`, `write_session_summary`, `daily_briefing`, `resolve_context`, `check_alignment`, `get_operational_context`, `plan_assistant_action`, `upsert_situation`, `plan_environment_tool_use`, `plan_request`
- `initiative-tools.ts`: `upsert_initiative`, `list_initiatives`, `get_initiative_context`, `upsert_vision`, `list_visions`, `get_strategy_context`, `upsert_asset`, `list_assets`, `link_asset`, `upsert_milestone`, `create_branch_project`
- `admin-tools.ts`: `reindex_document`, `reindex_all`, `admin_status`, `admin_reconcile_workdrive`, `backfill_memory_layers`, `get_migration_audit`, `context_health_check`

Each file has this signature:

```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ProjectService } from "~/service/ProjectService"; // or relevant service

export function registerProjectTools(server: McpServer, service: ProjectService) {
  server.registerTool("ensure_project", { ... }, async (input) => { ... });
  // ...
}
```

- [ ] **Step 18.2: Rewrite mcp/server.ts to compose services and tool groups**

Replace `src/mcp/server.ts` with:

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import type { MemoryPrincipal } from "~/domain/types";
import { loadConfig } from "~/config/env";
import { DocumentRepository } from "~/persistence/d1/DocumentRepository";
import { EntityRepository } from "~/persistence/d1/EntityRepository";
import { ProjectRepository } from "~/persistence/d1/ProjectRepository";
import { InitiativeRepository } from "~/persistence/d1/InitiativeRepository";
import { ProjectService } from "~/service/ProjectService";
import { DocumentService } from "~/service/DocumentService";
import { EntityService } from "~/service/EntityService";
import { RetrievalService } from "~/service/RetrievalService";
import { PlanningService } from "~/service/PlanningService";
import { InitiativeService } from "~/service/InitiativeService";
import { registerProjectTools } from "~/tools/project-tools";
import { registerDocumentTools } from "~/tools/document-tools";
import { registerEntityTools } from "~/tools/entity-tools";
import { registerRetrievalTools } from "~/tools/retrieval-tools";
import { registerPlanningTools } from "~/tools/planning-tools";
import { registerInitiativeTools } from "~/tools/initiative-tools";
import { registerAdminTools } from "~/tools/admin-tools";
import { ZohoWorkDriveClient } from "~/integrations/workdrive/client";
import { GithubOAuthClient } from "~/integrations/github/client";

export function createMemoryMcpServer(env: Env, principal: MemoryPrincipal) {
  const config = loadConfig(env);
  const server = new McpServer({ name: "context-os-memory", version: "1.0.0" });

  // Repositories
  const docRepo = new DocumentRepository(env.DB);
  const entityRepo = new EntityRepository(env.DB);
  const projectRepo = new ProjectRepository(env.DB);
  const initiativeRepo = new InitiativeRepository(env.DB);
  const zoho = new ZohoWorkDriveClient(env);
  const github = new GithubOAuthClient(env, config.github, principal);

  // Services
  const projectService = new ProjectService(env, principal, projectRepo, docRepo, zoho, github, config);
  const documentService = new DocumentService(env, principal, docRepo, entityRepo, zoho, config);
  const entityService = new EntityService(env, principal, entityRepo);
  const retrievalService = new RetrievalService(env, principal, docRepo, entityRepo, config);
  const initiativeService = new InitiativeService(env, principal, initiativeRepo, entityRepo);
  const planningService = new PlanningService(
    env, principal, docRepo, entityRepo, projectRepo, initiativeRepo, retrievalService, config,
  );

  // Register tool groups
  registerProjectTools(server, projectService);
  registerDocumentTools(server, documentService);
  registerEntityTools(server, entityService);
  registerRetrievalTools(server, retrievalService);
  registerPlanningTools(server, planningService, documentService);
  registerInitiativeTools(server, initiativeService);
  registerAdminTools(server, documentService);

  return server;
}

// Re-export for Cloudflare Agents support
export class MemoryMcpAgent extends McpAgent<Env, unknown, Record<string, never>> {
  async init() {
    // agents framework wires MCP; composition happens in createMemoryMcpServer
  }
}

export async function serveAuthenticatedMcpRequest(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  principal: MemoryPrincipal,
): Promise<Response> {
  const server = createMemoryMcpServer(env, principal);
  return server.fetch(request, env, ctx);
}
```

- [ ] **Step 18.3: Typecheck**

```bash
npm run typecheck
```

Expected: no errors (fix any import issues found)

- [ ] **Step 18.4: Run full test suite**

```bash
npm test
```

Expected: all tests pass

- [ ] **Step 18.5: Commit**

```bash
git add src/tools/ src/mcp/server.ts
git commit -m "refactor: extract tool groups and rewrite server composition"
```

---

### Task 19: Delete legacy files

**Files:**
- Delete: `src/domain/service.ts`
- Delete: `src/domain/session-payload.ts`
- Delete: `src/domain/light-lane-memory-recovery.ts`
- Delete: `src/mcp/tools.ts`
- Delete: `src/persistence/d1/repository.ts`

- [ ] **Step 19.1: Verify nothing imports the old files**

```bash
grep -r "from \"~/domain/service\"" src/
grep -r "from \"~/domain/session-payload\"" src/
grep -r "from \"~/mcp/tools\"" src/
grep -r "from \"~/persistence/d1/repository\"" src/
```

Expected: no output (all imports have been updated)

- [ ] **Step 19.2: Delete the files**

```bash
git rm src/domain/service.ts src/domain/session-payload.ts src/domain/light-lane-memory-recovery.ts src/mcp/tools.ts src/persistence/d1/repository.ts
```

- [ ] **Step 19.3: Typecheck and test**

```bash
npm run typecheck && npm test
```

Expected: all pass

- [ ] **Step 19.4: Commit**

```bash
git commit -m "refactor: delete legacy god-files after refactor complete"
```

---

## Phase 6 — Tool Cleanup

### Task 20: Remove deprecated tools and Light Lane-specific domain files

**Files:**
- Delete: `src/domain/ai-brain-vault.ts` (Light Lane-specific import logic, data already imported)
- Modify: `src/tools/admin-tools.ts` (remove deprecated tool registrations)
- Delete: `tests/unit/light-lane-memory-recovery.test.ts`
- Delete: `tests/unit/light-lane-memory-recovery-service.test.ts`
- Delete: `tests/unit/ai-brain-vault.test.ts`
- Delete: `tests/unit/light-lane-live-state.test.ts`

Remove registrations for these tools from admin-tools.ts (if they exist after the refactor):
- `analyze_light_lane_memory_recovery` / `run_light_lane_memory_recovery`
- `import_ai_brain_vault`
- `analyze_workdrive_canonicalization` / `run_workdrive_canonicalization`
- `analyze_memory_migration` / `run_memory_migration`
- `analyze_context_truth_migration` / `run_context_truth_migration`

Rename `plan_light_lane_live_state_refresh` to `plan_live_state_refresh` and remove the Light Lane hard-coding from `src/domain/light-lane-live-state.ts` (renamed to `src/domain/zoho-planning.ts`). Make it generic: accept `project` as a parameter instead of hard-coding Light Lane paths.

- [ ] **Step 20.1: Rename light-lane-live-state.ts to zoho-planning.ts**

```bash
git mv src/domain/light-lane-live-state.ts src/domain/zoho-planning.ts
```

- [ ] **Step 20.2: Update all imports of the renamed file**

```bash
grep -r "light-lane-live-state" src/ tests/
```

Update each import to use `~/domain/zoho-planning`.

- [ ] **Step 20.3: Remove deprecated tools from admin-tools.ts**

Delete the `server.registerTool` calls for the tools listed above.

- [ ] **Step 20.4: Delete deprecated test files**

```bash
git rm tests/unit/light-lane-memory-recovery.test.ts \
       tests/unit/light-lane-memory-recovery-service.test.ts \
       tests/unit/ai-brain-vault.test.ts \
       tests/unit/light-lane-live-state.test.ts
```

- [ ] **Step 20.5: Typecheck and test**

```bash
npm run typecheck && npm test
```

Expected: all pass

- [ ] **Step 20.6: Commit**

```bash
git add -A
git commit -m "refactor: remove deprecated tools and Light Lane-specific domain files"
```

---

## Phase 7 — Final Verification and Deploy

### Task 21: Final quality checks and production deploy

- [ ] **Step 21.1: Verify all service files are under 400 lines**

```bash
wc -l src/service/*.ts src/tools/*.ts src/persistence/d1/*.ts
```

Expected: no file over 400 lines. If any are over, further decompose.

- [ ] **Step 21.2: Run full test suite**

```bash
npm test
```

Expected: all tests pass

- [ ] **Step 21.3: Typecheck in strict mode**

```bash
npm run typecheck
```

Expected: no errors

- [ ] **Step 21.4: Deploy to production**

```bash
npm run deploy:production
```

Expected: successful deploy

---

## Phase 8 — Vault Data and Initiative Hierarchy

These are MCP tool calls, not code changes.

### Task 22: Create initiative hierarchy

Call these tools after the production deploy:

- [ ] **Step 22.1: Create Light Lane initiative**

```
context-os.upsert_initiative(
  slug: "light-lane",
  title: "Light Lane",
  summary: "Enterprise laser business combining modern software with real-world implementation. Hardware, software, training, and workflow design for production environments.",
  status: "active"
)
```

Associate existing `light-lane` project and sub-projects.

- [ ] **Step 22.2: Create Dropshipping Portfolio initiative**

```
context-os.upsert_initiative(
  slug: "dropshipping-portfolio",
  title: "Dropshipping Portfolio",
  summary: "Portfolio of e-commerce and dropshipping projects including Exclusive Moto (TrayRig), Kieran collab stores, and sourcing automation.",
  status: "active"
)
```

- [ ] **Step 22.3: Create Software Infrastructure initiative**

```
context-os.upsert_initiative(
  slug: "software-infrastructure",
  title: "Software Infrastructure",
  summary: "Internal tools and MCP servers supporting all other initiatives. Memory system, automation, context OS.",
  status: "active"
)
```

- [ ] **Step 22.4: Create situational awareness document**

```
context-os.upsert_situation(
  financial_position: "[current state]",
  location: "[current location]",
  top_priorities: ["[priority 1]", "[priority 2]", "[priority 3]"],
  key_constraints: ["[constraint 1]", "[constraint 2]"],
  active_initiatives: ["light-lane", "dropshipping-portfolio", "software-infrastructure"]
)
```

- [ ] **Step 22.5: Trigger full reindex**

```
context-os.reindex_all()
```

This propagates the backfilled `memory_layer` values to Vectorize metadata, enabling layer filtering in semantic search.

---

## Self-Review Notes

**Spec coverage check:**
- ✅ Four-layer memory model → Tasks 3, 5, 6, 10
- ✅ Actionability model on entity_states → Tasks 1, 9
- ✅ RetrievalIntent classification → Tasks 4, 7
- ✅ Layer-aware filtering in ranking → Task 5
- ✅ Situation document first-read → Tasks 8, 9
- ✅ Wiki link generation → Task 17
- ✅ Code refactor (service, repository, tools split) → Tasks 12-19
- ✅ Tool cleanup (deprecated tools removed) → Task 20
- ✅ Vault data migration → Task 22

**Type consistency:**
- `MemoryLayer` defined in Task 3; used in Tasks 5, 6
- `RetrievalIntent` defined in Task 4; used in Task 7
- `generateRelatedSection` defined and tested in Task 17
- Repository classes named consistently: `DocumentRepository`, `EntityRepository`, `ProjectRepository`, `InitiativeRepository`
- Service classes: `ProjectService`, `DocumentService`, `EntityService`, `RetrievalService`, `PlanningService`, `InitiativeService`
