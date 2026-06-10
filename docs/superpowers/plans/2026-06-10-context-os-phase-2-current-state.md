# Context OS Phase 2: Current-State Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Context OS surface current state by giving each project a reachable situation document, retiring superseded facts on write, and dropping long-overdue tasks out of the default priority surface.

**Architecture:** Three independent feature areas from the remediation overview (P2-1 situation docs, P2-2 supersede-on-write, P2-3 task lifecycle), plus one foundation fix (persist `memory_layer` on index) that P2-1 depends on. All retrieval/session logic is duplicated across a production service layer (`src/service/*`) and a legacy mirror (`src/domain/service.ts`, class `MemoryService`); the unit-test harness exercises the legacy mirror, so every behavioural change lands in BOTH copies, and repository changes land in BOTH `DocumentRepository.ts` and `repository.ts`. No database migrations are required: every column used already exists (`documents.memory_layer`, `documents.tags_json`, `durable_facts.fact_key`, `entity_states.superseded_by_state_id`).

**Tech Stack:** Cloudflare Workers, D1 (SQLite), Vectorize, Zoho WorkDrive sync, TypeScript ESM, vitest (`@cloudflare/vitest-pool-workers`).

---

## Ground rules for the executor

- **Branch:** `feat/phase-2-current-state` (already created off `main`). Keep `main` clean.
- **Do NOT start Phase 3** (ranking rewrite, namespace weighting, payload slimming, memory_layer backfill for non-situation docs). If a change feels like ranking tuning, stop.
- **Two copies stay in sync.** Service logic: `src/service/PlanningService.ts` + `src/service/DocumentService.ts` AND `src/domain/service.ts`. Repositories: `src/persistence/d1/DocumentRepository.ts` AND `src/persistence/d1/repository.ts`. TDD tests import `~/domain/service` (`MemoryService`), so the legacy mirror must carry the behaviour for tests to pass; the production copy must carry it for production to work.
- **Match by quoted code, not line numbers.** Line numbers in this plan are from the 10 June 2026 post-Phase-1 snapshot and may drift; grep for the quoted snippet.
- **Verify before deploy:** `npm run typecheck && npm test` must pass.
- **Ask Fabien before:** any production deploy, any destructive data operation, and before making the authored situation document canonical.
- **Admin tools are off-limits** (`admin_reindex_all` / `reindex_all`). The production cron runs the identical `runReconciliation` every 30 minutes. For D1 inspection use `npx wrangler d1 execute DB --remote --json --command "..."`.

---

## File map

| File | Change |
|---|---|
| `src/persistence/d1/DocumentRepository.ts` | Persist `memory_layer` in `upsertIndexedDocument`; add `findActiveDocumentsByCanonicalKey`. |
| `src/persistence/d1/repository.ts` | Same two changes (legacy mirror). |
| `src/service/PlanningService.ts` | `findSituationDocument(project)`; reorder call site; partition tasks; surface `needs_review_tasks`. |
| `src/domain/service.ts` | Mirror of all PlanningService + DocumentService + recordDecision changes (class `MemoryService`). |
| `src/service/DocumentService.ts` | `setSituationDocument` project-aware + `body_markdown`; `recordDecision` canonical_key auto-supersession. |
| `src/service/EntityService.ts` | `extractDurableFacts` explicit `fact_key`. |
| `src/tools/memory-tools.ts` | Extend `upsert_situation`, `record_decision`, `extract_durable_facts` input schemas. |
| `src/domain/task-lifecycle.ts` | New: `partitionTasksByStaleness` pure helper. |
| `tests/unit/task-lifecycle.test.ts` | New: helper tests. |
| `tests/unit/*` (situation, supersede, session-tasks) | New/extended tests against `MemoryService`. |

---

## Task A: Persist `memory_layer` on index (foundation for P2-1)

**Why:** `documents.memory_layer` is NULL for all 938 rows in production — the index pipeline never writes it. `findDocumentsByLayer` filters `WHERE d.memory_layer = ?`, so situation lookups can never match regardless of content. This must land first or P2-1 is invisible.

**Scope guard:** Only persist `frontmatter.memory_layer` when present. Do NOT infer a layer for docs that lack one (that broad backfill is Phase 3). Net effect: situation docs (which set `memory_layer: situation`) become findable; everything else is unchanged (stays NULL).

**Files:**
- Modify: `src/persistence/d1/DocumentRepository.ts` (`upsertIndexedDocument`)
- Modify: `src/persistence/d1/repository.ts` (`upsertIndexedDocument` mirror)
- Test: `tests/unit/document-repository-memory-layer.test.ts` (new) — if the repo is hard to unit-test in isolation, assert via an integration-style D1 test that already exists; otherwise verify live in Task A step 5.

- [ ] **Step 1: Locate the INSERT in `upsertIndexedDocument`.**

In `src/persistence/d1/DocumentRepository.ts`, read `upsertIndexedDocument`. It performs `INSERT INTO documents (... tags_json, confidence, usefulness, created_at, updated_at ...) VALUES (...) ON CONFLICT(id) DO UPDATE SET ...`. Confirm `memory_layer` is NOT in the column list (it currently is not).

- [ ] **Step 2: Add `memory_layer` to the INSERT, the VALUES bind list, and the ON CONFLICT update.**

- Add `memory_layer` to the column name list (next to `tags_json` is fine).
- Add a positional bind placeholder for it in the `VALUES (...)` list (renumber following `?N` placeholders, or append at the end of the list if the statement uses trailing placeholders — keep numbering consistent).
- Bind value: `input.frontmatter?.memory_layer ?? null`.
- In `ON CONFLICT(id) DO UPDATE SET`, add: `memory_layer = excluded.memory_layer,`.

Confirm the `upsertIndexedDocument` input type already carries `frontmatter?: MemoryFrontmatter` (it does — `frontmatter: parsed.frontmatter` is passed from `indexMarkdownDocument`). `MemoryFrontmatter.memory_layer` is `MemoryLayer | undefined`.

- [ ] **Step 3: Confirm `mapDocument` reads the column.**

Verify `mapDocument` maps `row.memory_layer` → `memoryLayer` on `ResolvedMemoryDocument`. If it does not, add `memoryLayer: row.memory_layer ?? null`. (The `ResolvedMemoryDocument` type already has `memoryLayer?: MemoryLayer | null`.)

- [ ] **Step 4: Apply the identical change to the legacy mirror.**

Repeat Steps 1–3 in `src/persistence/d1/repository.ts` `upsertIndexedDocument`. The INSERT is duplicated there.

- [ ] **Step 5: Verify typecheck + tests, then commit.**

```bash
npm run typecheck && npm test
```
Expected: PASS (no behaviour change for existing tests).

```bash
git add src/persistence/d1/DocumentRepository.ts src/persistence/d1/repository.ts
git commit -m "fix: persist memory_layer on document index so situation layer is findable"
```

> Note: This change only takes effect for documents indexed AFTER deploy. The light-lane situation doc (Task D) is authored post-deploy, so it indexes with `memory_layer = situation` and becomes findable. No backfill needed.

---

## Task B: Per-project situation document resolution (read side)

**Why (RC-4):** `findSituationDocument` is hardcoded to `project: "shared"` in both copies, so every project gets `situation: null`.

**Files:**
- Modify: `src/service/PlanningService.ts` (`findSituationDocument` + its call site in `prepareAssistantSession`)
- Modify: `src/domain/service.ts` (`findSituationDocument` mirror + call site)
- Test: `tests/unit/situation-resolution.test.ts` (new)

- [ ] **Step 1: Write the failing test (targets the legacy `MemoryService`).**

Create `tests/unit/situation-resolution.test.ts`. Mock `findDocumentsByLayer` so it returns a project-scoped situation doc only when queried with the active project, and assert the prepared session surfaces it. Match the existing mock style in `tests/integration/assistant-session-planning.test.ts` (vi.hoisted mocks of repository methods, `MemoryService` imported from `~/domain/service`, `now` injected via input).

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  findDocumentsByLayer: vi.fn(),
}));

// Reuse the project's existing repository/service mock harness pattern.
// The key assertion: findDocumentsByLayer is called with the ACTIVE project first.

describe("per-project situation resolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findDocumentsByLayer.mockResolvedValue([]);
  });

  it("resolves the active project's situation document, not shared", async () => {
    mocks.findDocumentsByLayer.mockImplementation(async (input: { project: string }) => {
      if (input.project === "light-lane") {
        return [
          {
            id: "sit-ll",
            path: "/memory/projects/light-lane/context/current/situation.md",
            bodyMarkdown: "# Light Lane Situation\nTraceability infrastructure positioning.",
            memoryLayer: "situation",
            project: "light-lane",
          },
        ];
      }
      return [];
    });

    // ... build MemoryService with the harness, call prepareAssistantSession({
    //   projectOrTopic: "light-lane", userIntent: "what deals are underway",
    //   now: "2026-06-10T07:00:00Z" })
    // assert result.situation is non-null and contains "Traceability infrastructure"
    // assert mocks.findDocumentsByLayer was called with project: "light-lane"
  });

  it("falls back to shared when the project has no situation document", async () => {
    mocks.findDocumentsByLayer.mockImplementation(async (input: { project: string }) => {
      if (input.project === "shared") {
        return [{ id: "sit-shared", path: "/memory/shared/context/current/situation.md", bodyMarkdown: "# Shared Situation", memoryLayer: "situation", project: "shared" }];
      }
      return [];
    });
    // assert result.situation is non-null and from shared, and that the active
    // project was queried first (call order: active project, then "shared").
  });
});
```

Fill in the harness wiring to match the existing test files (read `tests/integration/assistant-session-planning.test.ts` for the exact mock setup, including how `MemoryService` is constructed and which repository the mocks attach to).

- [ ] **Step 2: Run the test, verify it fails.**

```bash
npm test -- situation-resolution
```
Expected: FAIL — current `findSituationDocument()` only ever queries `project: "shared"`, so the active-project assertion fails.

- [ ] **Step 3: Implement project-first resolution with shared fallback (both copies).**

In `src/service/PlanningService.ts`, replace:

```typescript
  private async findSituationDocument(): Promise<ResolvedMemoryDocument | null> {
    try {
      const docs = await this.documentRepo.findDocumentsByLayer({
        project: "shared",
        memoryLayer: "situation",
        canonical: true,
        limit: 1,
      });
      return docs[0] ?? null;
    } catch {
      return null;
    }
  }
```

with:

```typescript
  private async findSituationDocument(project: string): Promise<ResolvedMemoryDocument | null> {
    try {
      const scoped = await this.documentRepo.findDocumentsByLayer({
        project,
        memoryLayer: "situation",
        canonical: true,
        limit: 1,
      });
      if (scoped[0]) return scoped[0];
      if (project !== "shared") {
        const shared = await this.documentRepo.findDocumentsByLayer({
          project: "shared",
          memoryLayer: "situation",
          canonical: true,
          limit: 1,
        });
        return shared[0] ?? null;
      }
      return null;
    } catch {
      return null;
    }
  }
```

In `src/domain/service.ts`, apply the identical change but using `this.repo` instead of `this.documentRepo` (the legacy class names the repository `this.repo`).

- [ ] **Step 4: Fix the call site so the resolved project is passed (both copies).**

In `src/service/PlanningService.ts` `prepareAssistantSession`, the current order calls `findSituationDocument()` BEFORE resolving the project:

```typescript
const situationDoc = await this.findSituationDocument();
const resolution = await this.resolveContext({
  projectOrTopic: input.projectOrTopic,
  userIntent: input.userIntent,
});
const activeProject = resolution.active_project;
const project = activeProject.slug;
```

Reorder to resolve first, then look up the situation by active project:

```typescript
const resolution = await this.resolveContext({
  projectOrTopic: input.projectOrTopic,
  userIntent: input.userIntent,
});
const activeProject = resolution.active_project;
const project = activeProject.slug;
const situationDoc = await this.findSituationDocument(project);
```

Apply the identical reorder in `src/domain/service.ts` `prepareAssistantSession`. Verify nothing between the old `findSituationDocument()` call and the `resolveContext` call depended on `situationDoc` (it does not — `situationDoc` is only read later when building the `situation:` field).

- [ ] **Step 5: Run the test, verify it passes.**

```bash
npm test -- situation-resolution
```
Expected: PASS.

- [ ] **Step 6: Full suite + commit.**

```bash
npm run typecheck && npm test
git add src/service/PlanningService.ts src/domain/service.ts tests/unit/situation-resolution.test.ts
git commit -m "feat: resolve per-project situation document with shared fallback"
```

---

## Task C: Per-project situation document write (write side)

**Why:** `setSituationDocument` is hardcoded to `project = "shared"` and builds a fixed personal-situation body. To author a light-lane situation doc we need project scoping and a free-form body.

**Files:**
- Modify: `src/service/DocumentService.ts` (`setSituationDocument`)
- Modify: `src/domain/service.ts` (the `setSituationDocument` mirror — search `memory_layer: "situation"`)
- Modify: `src/tools/memory-tools.ts` (`upsert_situation` input schema)
- Test: `tests/unit/situation-write.test.ts` (new) or extend an existing DocumentService test if one exists.

- [ ] **Step 1: Write the failing test.**

Create `tests/unit/situation-write.test.ts`. Assert that `setSituationDocument({ project: "light-lane", body_markdown: "# X" })` writes to `/memory/projects/light-lane/context/current/situation.md` with frontmatter `memory_layer: "situation"`, `canonical: true`, and a body equal to the provided `body_markdown`. Mock the Zoho upload + index job (match how DocumentService is tested elsewhere; if there is no existing DocumentService unit test, write the assertions against the markdown passed to `uploadMarkdownFile`).

```typescript
// assert uploaded path === buildLogicalPath("light-lane", ["context","current"], "situation.md")
// assert markdown contains "memory_layer: situation"
// assert markdown body contains the provided body_markdown verbatim
```

- [ ] **Step 2: Run it, verify failure.**

```bash
npm test -- situation-write
```
Expected: FAIL — `setSituationDocument` ignores `project` and `body_markdown`.

- [ ] **Step 3: Make `setSituationDocument` project-aware with optional free-form body.**

In `src/service/DocumentService.ts`, change the signature and the project/body/path lines. Replace:

```typescript
  async setSituationDocument(input: {
    financial_position?: string;
    location?: string;
    top_priorities?: string[];
    key_constraints?: string[];
    active_initiatives?: string[];
    notes?: string;
  }) {
    const project = "shared";
    await this.ensureProjectMinimal({ project });
```

with:

```typescript
  async setSituationDocument(input: {
    project?: string;
    body_markdown?: string;
    financial_position?: string;
    location?: string;
    top_priorities?: string[];
    key_constraints?: string[];
    active_initiatives?: string[];
    notes?: string;
  }) {
    const project = normalizeProject(input.project);
    await this.ensureProjectMinimal({ project });
```

Then replace the body assembly line:

```typescript
  const body = sections.join("\n\n");
```

with:

```typescript
  const body = input.body_markdown?.trim()
    ? input.body_markdown.trim()
    : sections.join("\n\n");
```

`normalizeProject(undefined)` returns `"shared"`, preserving the existing default. `buildLogicalPath(project, ["context", "current"], "situation.md")` already uses `project`, so the path becomes project-scoped automatically. The frontmatter already sets `memory_layer: "situation"`, `canonical: true`, `status: "active"`. Confirm `normalizeProject` is imported in this file (it is used elsewhere in DocumentService; if not, add it to the import from `~/domain/memory`).

- [ ] **Step 4: Mirror the change in `src/domain/service.ts`.**

Find the legacy `setSituationDocument` (search `memory_layer: "situation"`). Apply the identical signature, `project`, and `body` changes.

- [ ] **Step 5: Extend the `upsert_situation` MCP tool schema.**

In `src/tools/memory-tools.ts`, in the `upsert_situation` registration, add to `inputSchema`:

```typescript
        project: z.string().optional().describe("Project slug to scope this situation document to. Omit for the cross-initiative shared situation."),
        body_markdown: z.string().optional().describe("Free-form markdown body. When provided, it becomes the situation body verbatim instead of the structured sections."),
```

and pass them through in the handler:

```typescript
  async (input) => {
    const result = await docSvc.setSituationDocument(input);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  },
```

(`input` already spreads through; just ensure `project` and `body_markdown` are part of the parsed object passed to `setSituationDocument`.)

- [ ] **Step 6: Run tests, verify pass, full suite, commit.**

```bash
npm test -- situation-write
npm run typecheck && npm test
git add src/service/DocumentService.ts src/domain/service.ts src/tools/memory-tools.ts tests/unit/situation-write.test.ts
git commit -m "feat: allow project-scoped situation documents with free-form body"
```

---

## Task D: Author and write the light-lane situation document (content + approval)

**Why:** Code from Tasks A–C is inert without the doc. This step produces canonical content and is GATED on Fabien's confirmation (hard constraint 4). It runs AFTER deploy (Task I), because authoring goes through the live MCP tool which must be running the new code.

**This is not a code task — no TDD.** It is a content + approval step.

- [ ] **Step 1: Draft the situation body from Context OS truth, not memory.**

Source content from current Context OS facts and source events (do not invent):
- `search_memory(query: "Light Lane positioning traceability infrastructure", project: "light-lane")`
- `search_memory(query: "Talley's Group deal status", project: "light-lane")` and the source events for the 4–5 June Talley's site visits.
- The Duncan Cotterill (Dene Gavin) legal engagement source event (9 June) and the accountant/business-manager engagement.
- The deal economics fact ($50k floor / $100k typical / $5M ceiling).
- Current team structure (Xiarn, Kai, Orry, Lee; Sequoia departed May 2026).

Draft a tight markdown body covering: current positioning (global traceability infrastructure, not laser shop), live enterprise deal (Talley's multi-site evaluation, current stage), legal + accounting engagements, deal economics band, team structure, and top current priorities.

- [ ] **Step 2: Show the draft to Fabien and get explicit confirmation before writing.**

Present the full draft. Ask Fabien to confirm or correct it. Do not proceed to write until confirmed (this is the "make the authored situation document canonical" approval gate).

- [ ] **Step 3: Write it via the deployed tool.**

```
upsert_situation(
  project: "light-lane",
  body_markdown: "<confirmed draft>"
)
```

- [ ] **Step 4: Confirm it indexed with the situation layer and is findable.**

```bash
npx wrangler d1 execute DB --remote --json --command "SELECT project, path, memory_layer, canonical, active FROM documents WHERE path = '/memory/projects/light-lane/context/current/situation.md'"
```
Expected: one row, `memory_layer = situation`, `canonical = 1`, `active = 1`. If `memory_layer` is NULL, Task A did not deploy correctly — stop and fix.

Then confirm via the session pack:
```
prepare_assistant_session(project_or_topic: "light-lane", user_intent: "what deals are underway")
```
Expected: `situation` is non-null and contains the current positioning.

> If indexing is async via the cron/queue, allow one reconciliation pass (~30 min) or confirm the write path's inline index job completed (the `setSituationDocument` return includes a `job_id`).

---

## Task E: Supersede-on-write — `record_decision` canonical-key auto-supersession

**Why (RC-3):** Nothing ever stamps conflicting prior records superseded automatically. `record_decision` already accepts explicit `supersedes_document_ids`, but a current-truth system must retire the old record on write without the caller hand-listing ids every time.

**Design:** Add an optional `canonical_key` (a stable topic slug, e.g. `light-lane-positioning`). When provided, the new decision is tagged `canonical-key:<key>`, and any other active document in the project already carrying that tag is marked superseded. This is deterministic, needs no migration (rides on the existing `tags_json` column, queried with `instr`), and is verifiable via `search_memory(include_superseded: true)` vs default. Retiring a PRE-EXISTING old doc that lacks the tag is still done via explicit `supersedes_document_ids` (unchanged) — use that during Task D content cleanup.

**Files:**
- Modify: `src/persistence/d1/DocumentRepository.ts` (add `findActiveDocumentsByCanonicalKey`)
- Modify: `src/persistence/d1/repository.ts` (mirror)
- Modify: `src/service/DocumentService.ts` (`recordDecision`)
- Modify: `src/domain/service.ts` (`recordDecision` mirror — search `memory_type: "decision"` write path)
- Modify: `src/tools/memory-tools.ts` (`record_decision` schema)
- Test: `tests/unit/supersede-on-write.test.ts` (new)

- [ ] **Step 1: Add the repository finder (both repos).**

In `src/persistence/d1/DocumentRepository.ts` add:

```typescript
  async findActiveDocumentsByCanonicalKey(input: {
    project: string;
    canonicalKey: string;
    excludeDocumentId?: string;
  }): Promise<ResolvedMemoryDocument[]> {
    const tag = `canonical-key:${input.canonicalKey}`.toLowerCase();
    const rows = await this.db
      .prepare(
        `SELECT * FROM documents
         WHERE project = ?1
           AND active = 1
           AND status NOT IN ('archived', 'superseded')
           AND instr(lower(COALESCE(tags_json, '')), ?2) > 0`,
      )
      .bind(input.project, tag)
      .all<DocumentRow>();
    return rows.results
      .map((row) => mapDocument(row)!)
      .filter((doc) => doc && doc.id !== input.excludeDocumentId);
  }
```

Add the identical method to `src/persistence/d1/repository.ts`. Confirm `DocumentRow` and `mapDocument` are in scope in each file (they are — both already define `findDocumentsByLayer` using them).

- [ ] **Step 2: Write the failing test (legacy `MemoryService`).**

Create `tests/unit/supersede-on-write.test.ts`. Mock `findActiveDocumentsByCanonicalKey` to return one prior active doc, and assert that `recordDecision({ canonical_key: "light-lane-positioning", ... })` calls `markDocumentsSuperseded` with that doc's id, and that the written markdown's frontmatter tags include `canonical-key:light-lane-positioning`.

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  findActiveDocumentsByCanonicalKey: vi.fn(),
  markDocumentsSuperseded: vi.fn(),
  // plus the upload/index mocks the harness needs
}));

describe("record_decision canonical-key supersession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findActiveDocumentsByCanonicalKey.mockResolvedValue([]);
  });

  it("supersedes prior active docs sharing the canonical key", async () => {
    mocks.findActiveDocumentsByCanonicalKey.mockResolvedValue([
      { id: "old-positioning", path: "/memory/projects/light-lane/knowledge/facts/old.md" },
    ]);
    // build MemoryService, call recordDecision({
    //   project: "light-lane",
    //   title: "Light Lane is global traceability infrastructure",
    //   markdown: "Body...",
    //   canonical_key: "light-lane-positioning",
    // })
    expect(mocks.markDocumentsSuperseded).toHaveBeenCalledWith(
      expect.objectContaining({ documentIds: ["old-positioning"] }),
    );
    // assert the uploaded markdown contains the canonical-key tag
  });

  it("does not supersede anything when no canonical_key is given", async () => {
    // call recordDecision without canonical_key
    expect(mocks.markDocumentsSuperseded).not.toHaveBeenCalled();
  });
});
```

Wire the harness to match the existing DocumentService/MemoryService test setup.

- [ ] **Step 3: Run it, verify failure.**

```bash
npm test -- supersede-on-write
```
Expected: FAIL — `recordDecision` ignores `canonical_key`.

- [ ] **Step 4: Implement in `src/service/DocumentService.ts` `recordDecision`.**

Add `canonicalKey?: string;` to the input type. Where tags are assembled in the `applyFrontmatterOverrides` call, fold in the canonical-key tag when present. Replace:

```typescript
      tags: input.tags ?? parsed.frontmatter.tags,
```

with:

```typescript
      tags: input.canonicalKey
        ? [
            ...(input.tags ?? parsed.frontmatter.tags ?? []),
            `canonical-key:${input.canonicalKey}`,
          ]
        : (input.tags ?? parsed.frontmatter.tags),
```

Then, after the existing explicit-supersede block:

```typescript
    if (input.supersedesDocumentIds?.length) {
      await this.docRepo.markDocumentsSuperseded({
        documentIds: input.supersedesDocumentIds,
      });
    }
```

add canonical-key auto-supersession:

```typescript
    if (input.canonicalKey) {
      const priorDocs = await this.docRepo.findActiveDocumentsByCanonicalKey({
        project,
        canonicalKey: input.canonicalKey,
      });
      const priorIds = priorDocs.map((doc) => doc.id);
      if (priorIds.length) {
        await this.docRepo.markDocumentsSuperseded({ documentIds: priorIds });
      }
    }
```

(The new decision's own D1 id is assigned later by the async index job, so we do not pass `supersededByDocumentId`; `markDocumentsSuperseded` already defaults it to null. Marking the old docs superseded is synchronous and independent of the new doc's indexing.)

- [ ] **Step 5: Mirror in `src/domain/service.ts` `recordDecision`.**

Apply the identical tag-folding and auto-supersession logic to the legacy `recordDecision`, using its repository handle (`this.repo`).

- [ ] **Step 6: Extend the `record_decision` MCP schema.**

In `src/tools/memory-tools.ts`, add to the `record_decision` `inputSchema`:

```typescript
        canonical_key: z.string().optional().describe("Stable topic key (slug). Writing a decision with this key supersedes any prior active document carrying the same key, so current truth replaces stale truth automatically."),
```

and thread it through the handler call as `canonicalKey: canonical_key`.

- [ ] **Step 7: Run tests, verify pass, full suite, commit.**

```bash
npm test -- supersede-on-write
npm run typecheck && npm test
git add src/persistence/d1/DocumentRepository.ts src/persistence/d1/repository.ts src/service/DocumentService.ts src/domain/service.ts src/tools/memory-tools.ts tests/unit/supersede-on-write.test.ts
git commit -m "feat: auto-supersede prior records on record_decision via canonical key"
```

---

## Task F: Supersede-on-write — explicit fact key + entity-state regression test

**Why:** Round out RC-3. Entity states already supersede-on-write (`upsertEntityState` flips the prior active row to `superseded` and sets `superseded_by_state_id`). Lock that with a regression test and route volatile truth there. Give `extract_durable_facts` an explicit `fact_key` so topic facts collapse deterministically (`durable_facts` has `UNIQUE(project, fact_key)`).

**Files:**
- Modify: `src/service/EntityService.ts` (`extractDurableFacts`)
- Modify: `src/domain/service.ts` (mirror — search `extractFactCandidates`)
- Modify: `src/tools/memory-tools.ts` (`extract_durable_facts` schema)
- Test: `tests/unit/entity-state-supersede.test.ts` (new) and extend the fact test.

- [ ] **Step 1: Write the entity-state regression test.**

Create `tests/unit/entity-state-supersede.test.ts`. Using the repository-level test harness (or a focused `EntityRepository` test if one exists), assert that calling `upsertEntityState` for an existing `(project, entity_id, state_key)` with `status: "active"` issues the UPDATE that flips the prior active row to `superseded` and sets `superseded_by_state_id` to the new id, then inserts the new active row. If a pure-unit harness for `EntityRepository` is impractical, assert at the service level that a second `upsertEntityState` on the same key leaves exactly one active state and one superseded state via `listEntityStatesForEntities({ includeSuperseded: true })`.

```typescript
// after two upsertEntityState calls on (light-lane, entity-1, "positioning"):
// const states = await repo.listEntityStatesForEntities({ entityIds: ["entity-1"], includeSuperseded: true });
// expect(states.filter(s => s.status === "active")).toHaveLength(1);
// expect(states.filter(s => s.status === "superseded")).toHaveLength(1);
// expect(active.value).toBe("traceability_infrastructure");
```

- [ ] **Step 2: Run it, verify it passes immediately (documents existing behaviour).**

```bash
npm test -- entity-state-supersede
```
Expected: PASS (this behaviour already exists). If it FAILS, the existing supersede-on-write for states is broken — stop and investigate before continuing.

- [ ] **Step 3: Add explicit `fact_key` to `extract_durable_facts` — write the failing test.**

Extend the fact test: assert that `extractDurableFacts({ text, fact_key: "light-lane-positioning", save: true })` calls `upsertFact` with `factKey: "light-lane-positioning"` (for a single extracted candidate), rather than the auto-generated `slugify(source-body)` key.

- [ ] **Step 4: Run it, verify failure.**

```bash
npm test -- durable-facts
```
Expected: FAIL — `fact_key` is currently always auto-generated.

- [ ] **Step 5: Implement explicit `fact_key`.**

In `src/service/EntityService.ts` `extractDurableFacts`, add `factKey?: string;` to the input type and use it when provided:

```typescript
    const extracted = extractFactCandidates(input.text).map((body, index) => ({
      title: input.title ?? `Extracted fact ${index + 1}`,
      body,
      factKey: input.factKey
        ? (index === 0 ? input.factKey : `${input.factKey}-${index}`)
        : slugify(`${input.source ?? "manual"}-${body}`).slice(0, 140),
      source: input.source,
      sourceUrl: input.sourceUrl,
      confidence: input.confidence ?? 0.65,
      initiativeId: input.initiativeId,
      entityId: input.entityId,
    }));
```

Mirror in `src/domain/service.ts`. Add `fact_key: z.string().optional()` to the `extract_durable_facts` MCP schema in `src/tools/memory-tools.ts` and thread it as `factKey: fact_key`.

- [ ] **Step 6: Run tests, verify pass, full suite, commit.**

```bash
npm test -- entity-state-supersede durable-facts
npm run typecheck && npm test
git add src/service/EntityService.ts src/domain/service.ts src/tools/memory-tools.ts tests/unit/entity-state-supersede.test.ts tests/unit/*durable*
git commit -m "feat: explicit fact_key for facts; lock entity-state supersede-on-write with a test"
```

---

## Task G: Task lifecycle — `partitionTasksByStaleness` pure helper

**Why (RC-7):** Tasks overdue by months read as today's priorities. Bucket tasks overdue by more than 14 days into `needs_review` so they leave the default surface. Build the rule as a pure, time-injectable function for clean TDD (the codebase has no injectable clock; `daysFromNowIso` uses `Date.now()` directly, so date logic must take `now` as a parameter).

**Files:**
- Create: `src/domain/task-lifecycle.ts`
- Test: `tests/unit/task-lifecycle.test.ts`

- [ ] **Step 1: Write the failing test.**

Create `tests/unit/task-lifecycle.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { partitionTasksByStaleness } from "~/domain/task-lifecycle";
import type { ContextTask } from "~/domain/memory";

function task(overrides: Partial<ContextTask>): ContextTask {
  return {
    id: "t", project: "light-lane", title: "T", description: null,
    status: "open", priority: "normal", dueAt: null, owner: null,
    initiativeId: null, entityId: null, source: null, sourceUrl: null,
    reminderAt: null, metadata: {}, createdAt: "2026-05-01T00:00:00Z",
    updatedAt: "2026-05-01T00:00:00Z", ...overrides,
  };
}

const NOW = "2026-06-10T00:00:00Z";

describe("partitionTasksByStaleness", () => {
  it("buckets tasks overdue by more than 14 days as needs_review", () => {
    const t = task({ id: "stale", dueAt: "2026-05-20T00:00:00Z" }); // 21 days overdue
    const { live, needsReview } = partitionTasksByStaleness([t], NOW);
    expect(needsReview.map((x) => x.id)).toEqual(["stale"]);
    expect(live).toEqual([]);
  });

  it("keeps tasks overdue by 14 days or less as live", () => {
    const t = task({ id: "recent", dueAt: "2026-06-01T00:00:00Z" }); // 9 days overdue
    const { live, needsReview } = partitionTasksByStaleness([t], NOW);
    expect(live.map((x) => x.id)).toEqual(["recent"]);
    expect(needsReview).toEqual([]);
  });

  it("keeps future and undated tasks as live", () => {
    const future = task({ id: "future", dueAt: "2026-07-01T00:00:00Z" });
    const undated = task({ id: "undated", dueAt: null });
    const { live, needsReview } = partitionTasksByStaleness([future, undated], NOW);
    expect(live.map((x) => x.id).sort()).toEqual(["future", "undated"]);
    expect(needsReview).toEqual([]);
  });

  it("never buckets closed tasks even if long overdue", () => {
    const done = task({ id: "done", status: "done", dueAt: "2026-01-01T00:00:00Z" });
    const cancelled = task({ id: "cancelled", status: "cancelled", dueAt: "2026-01-01T00:00:00Z" });
    const { live, needsReview } = partitionTasksByStaleness([done, cancelled], NOW);
    expect(needsReview).toEqual([]);
    expect(live.map((x) => x.id).sort()).toEqual(["cancelled", "done"]);
  });

  it("respects a custom threshold", () => {
    const t = task({ id: "x", dueAt: "2026-06-01T00:00:00Z" }); // 9 days overdue
    const { needsReview } = partitionTasksByStaleness([t], NOW, 7);
    expect(needsReview.map((x) => x.id)).toEqual(["x"]);
  });
});
```

- [ ] **Step 2: Run it, verify failure.**

```bash
npm test -- task-lifecycle
```
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the helper.**

Create `src/domain/task-lifecycle.ts`:

```typescript
import type { ContextTask } from "~/domain/memory";

export const DEFAULT_NEEDS_REVIEW_DAYS = 14;

export type TaskPartition = {
  live: ContextTask[];
  needsReview: ContextTask[];
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Split tasks into a default "live" surface and a "needs_review" bucket.
 * A task is needs_review only if it is still open (not done/cancelled) AND its
 * due date is more than `thresholdDays` before `nowIso`. Closed, future, and
 * undated tasks always stay live.
 */
export function partitionTasksByStaleness(
  tasks: ContextTask[],
  nowIso: string,
  thresholdDays: number = DEFAULT_NEEDS_REVIEW_DAYS,
): TaskPartition {
  const cutoffMs = new Date(nowIso).getTime() - thresholdDays * DAY_MS;
  const live: ContextTask[] = [];
  const needsReview: ContextTask[] = [];
  for (const task of tasks) {
    const isOpen = task.status !== "done" && task.status !== "cancelled";
    const dueMs = task.dueAt ? new Date(task.dueAt).getTime() : NaN;
    if (isOpen && !Number.isNaN(dueMs) && dueMs < cutoffMs) {
      needsReview.push(task);
    } else {
      live.push(task);
    }
  }
  return { live, needsReview };
}
```

- [ ] **Step 4: Run it, verify pass, commit.**

```bash
npm test -- task-lifecycle
git add src/domain/task-lifecycle.ts tests/unit/task-lifecycle.test.ts
git commit -m "feat: add partitionTasksByStaleness task-lifecycle helper"
```

---

## Task H: Wire task partitioning into the session pack (both copies)

**Why:** The helper is inert until the session pack uses it. The default high-priority surface and the response `tasks` field must show only live tasks; stale ones go to a separate `needs_review_tasks` bucket.

**Files:**
- Modify: `src/service/PlanningService.ts` (`prepareAssistantSession`; also `planRequest` for consistency)
- Modify: `src/domain/service.ts` (mirror)
- Test: `tests/unit/session-task-buckets.test.ts` (new)

- [ ] **Step 1: Write the failing integration-style test (legacy `MemoryService`).**

Create `tests/unit/session-task-buckets.test.ts`. Mock `listTasks` to return a mix: one task 30 days overdue (urgent), one task due in 3 days (high), one undated (normal). Call `prepareAssistantSession({ projectOrTopic: "light-lane", userIntent: "...", now: "2026-06-10T07:00:00Z" })`. Assert:
- `result.tasks` (or the compacted top-level tasks field) contains only the two live tasks, not the 30-day-overdue one.
- `result.needs_review_tasks` contains the 30-day-overdue task.
- `result.operating_brief.current_tasks_milestones.overdue_count` reflects only live overdue tasks (0 here, since the only overdue one is bucketed and the 3-day task is future).

Match the mock harness in `tests/integration/assistant-session-planning.test.ts`.

- [ ] **Step 2: Run it, verify failure.**

```bash
npm test -- session-task-buckets
```
Expected: FAIL — no `needs_review_tasks` field; stale task still in default surface.

- [ ] **Step 3: Bump the task fetch limit so live tasks are not starved.**

In `src/service/PlanningService.ts` `prepareAssistantSession`, change the `listTasks` call from:

```typescript
this.entityRepo.listTasks({ project, dueBefore: daysFromNowIso(14), limit: 12 }),
```

to:

```typescript
this.entityRepo.listTasks({ project, dueBefore: daysFromNowIso(14), limit: 50 }),
```

Rationale: `listTasks` orders by priority then due-date ASC, so a backlog of stale urgent tasks would fill a `limit: 12` window and hide live work. Fetch wider, then partition, then the existing `compactTasks` cap (MAX_TASKS) bounds what is surfaced.

- [ ] **Step 4: Partition and re-wire the response (both copies).**

After the point where `tasks` is available and `assistantActionPlan` (with `operational_context`) is built, add:

```typescript
import { partitionTasksByStaleness } from "~/domain/task-lifecycle";
```

and in `prepareAssistantSession`, immediately before `buildOperatingBrief` is called:

```typescript
const { live: liveTasks, needsReviewTasks } = (() => {
  const partition = partitionTasksByStaleness(
    tasks,
    assistantActionPlan.operational_context.now_utc,
  );
  return { live: partition.live, needsReviewTasks: partition.needsReview };
})();
```

Pass `liveTasks` (not `tasks`) into `buildOperatingBrief`:

```typescript
  tasks: liveTasks,
```

In the response object, change the tasks field to use live tasks and add the new bucket. Replace:

```typescript
tasks: compactTasks(tasks),
```

with:

```typescript
tasks: compactTasks(liveTasks),
needs_review_tasks: compactTasks(needsReviewTasks),
```

(`compactTasks` is already imported. `needs_review_tasks` is additive — it does not remove any existing field.)

- [ ] **Step 5: Mirror everything in `src/domain/service.ts` `prepareAssistantSession`.**

Apply the identical limit bump, partition, `buildOperatingBrief` input swap to `liveTasks`, and `tasks`/`needs_review_tasks` response fields. Use the legacy class's repository/operational-context handles. Confirm `now_utc` is available on the legacy operational context object (it comes from `buildTimeContext`, shared by both copies).

- [ ] **Step 6: Run tests, verify pass, full suite, commit.**

```bash
npm test -- session-task-buckets
npm run typecheck && npm test
git add src/service/PlanningService.ts src/domain/service.ts tests/unit/session-task-buckets.test.ts
git commit -m "feat: bucket >14-day-overdue tasks out of the default session surface"
```

---

## Task I: Verify, deploy (Fabien-gated), and confirm acceptance

- [ ] **Step 1: Full local verification.**

```bash
npm run typecheck && npm test
```
Expected: all tests pass (the Phase 1 baseline was 140; this plan adds tests — confirm zero failures).

- [ ] **Step 2: Ask Fabien to deploy.**

Per hard constraint 4, do not deploy without approval. When approved:

```bash
npm run deploy:production
```
(`deploy:production` runs typecheck + tests + remote D1 migrations + deploy. There are no new migrations in this plan; the migration step is a no-op for new schema.)

- [ ] **Step 3: Author the light-lane situation document (Task D), post-deploy, Fabien-gated.**

Execute Task D Steps 1–4 now that the new `upsert_situation` schema and `memory_layer` persistence are live.

- [ ] **Step 4: Retire stale current-state via entity states + canonical-key (Fabien-gated content/data).**

To satisfy "Talley's ranks above May-era deals," current truth must outrank stale truth. With Fabien's confirmation of real deal state:
- For each stale May deal (Fivestar, Speedy Signs / Fermin, Cristy / Fully Promoted) confirmed inactive, route the truth to an entity state, e.g. `upsert_entity_state(project: "light-lane", entity_name: "<deal>", state_key: "deal_stage", value: "<closed_or_parked>", source: "fabien_confirmation")`. The existing supersede-on-write retires the prior active state.
- If an explicit old positioning DOCUMENT still surfaces, retire it with `record_decision(..., supersedes_document_ids: ["<old-doc-id>"])` or by re-asserting positioning with `canonical_key: "light-lane-positioning"`.

This step is data, not code, and is gated on Fabien confirming the real-world deal state (do not invent deal status).

- [ ] **Step 5: Re-run the three verification calls and check against acceptance criteria.**

1. `retrieval_diagnostics(query: "current deals underway Light Lane pipeline", project: "light-lane")` — still `semantic`, `vector_error: null`, varied scores (no Phase-1 regression).
2. `admin_status()` — `queued_reindex_jobs: 0`, `failed_reindex_jobs: 0` (Task 0 holds after a cron pass).
3. `prepare_assistant_session(project_or_topic: "light-lane", user_intent: "what deals are underway")`.

Acceptance (from the overview):
- [ ] `situation` is non-null and contains current positioning (traceability infrastructure, Talley's, deal economics).
- [ ] A "deals underway" query surfaces Talley's before any May-era deal.
- [ ] No task overdue by more than 14 days appears in the default `tasks` list (they appear under `needs_review_tasks` instead).
- [ ] Writing a new positioning record marks the old one superseded: it is absent from `search_memory(...)` default and present with `search_memory(..., include_superseded: true)`.

- [ ] **Step 6: Save post-Phase-2 state and close out.**

- `finish_work_session(project: "memory-system-mcp", ...)` summarising P2-1/P2-2/P2-3 + Task 0.
- Mark Context OS tasks `task-phase-2-current-state` and `4ecc6b5e-1e63-4fa2-b665-b1d6e55e595c` done; mark `ebc9ce1c-8a8d-40ad-a3a3-53ee98b3f748` done (Task 0).
- Open the development-branch completion flow (superpowers:finishing-a-development-branch) to merge `feat/phase-2-current-state`.

---

## Self-review checklist (completed by plan author)

- **Spec coverage:** P2-1 → Tasks A,B,C,D. P2-2 → Tasks E,F. P2-3 → Tasks G,H. Acceptance → Task I. Foundation gap (memory_layer NULL) → Task A. ✓
- **No migrations:** all columns exist (`memory_layer`, `tags_json`, `fact_key`, `superseded_by_state_id`). ✓
- **Both copies:** every service change names `src/service/*` AND `src/domain/service.ts`; every repo change names both repos. ✓
- **Type consistency:** `findSituationDocument(project: string)`, `findActiveDocumentsByCanonicalKey({project, canonicalKey, excludeDocumentId?})`, `partitionTasksByStaleness(tasks, nowIso, thresholdDays?)` → `{ live, needsReview }`, `setSituationDocument({project?, body_markdown?, ...})` used consistently across tasks. ✓
- **Phase 3 excluded:** no ranking rewrite, no namespace weighting, no payload slimming, no broad memory_layer backfill. ✓
- **Time is injectable in tests:** date logic takes `nowIso`/`now` parameters; `prepareAssistantSession` accepts `input.now`. ✓
