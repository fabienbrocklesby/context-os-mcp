# Context OS Phase 1: Restore Correctness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> Read `docs/superpowers/plans/2026-06-10-context-os-remediation-overview.md` first for the full diagnosis. This plan covers Phase 1 ONLY (P1-1 batching fix, P1-2 honest degradation, P1-3 failed-jobs triage and reindex). Do not start Phase 2 or 3 work from this plan.

**Goal:** Fix the D1 bind-parameter overflow that has silently disabled all semantic retrieval in production, make degraded retrieval visible instead of silent, and triage the 22,638-job failed-reindex backlog.

**Architecture:** Extract a pure id-batching helper, use it in both duplicated D1 repository classes so no `IN (...)` query ever exceeds D1's 100-bind-parameter limit. Surface vector failure as an explicit degraded mode in search responses and context-health warnings for all projects. Then purge the stale failed-job backlog and re-run a full reindex so the vector index is complete.

**Tech Stack:** Cloudflare Workers, D1 (SQLite), Vectorize, TypeScript (ESM), vitest.

**Before starting:** `git status` shows pre-existing uncommitted changes on `main` (src/domain/service.ts, src/domain/session.ts, src/service/PlanningService.ts, tests/integration/assistant-session-planning.test.ts, plus untracked docs). These belong to unrelated in-progress vault-sync work. Do NOT revert or commit them as part of this work. Create a feature branch from the current state (`git checkout -b fix/d1-bind-batching`) and only stage the files this plan touches.

---

### Task 1: Pure batching helper

**Files:**
- Create: `src/persistence/d1/binding.ts`
- Test: `tests/unit/d1-binding.test.ts`

D1 allows at most 100 bound parameters per statement. We batch at 90 to leave headroom for any fixed parameters a query adds around the id list.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/d1-binding.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { chunkForBinding } from "../../src/persistence/d1/binding";

describe("chunkForBinding", () => {
  it("returns empty array for empty input", () => {
    expect(chunkForBinding([])).toEqual([]);
  });

  it("returns a single batch when under the batch size", () => {
    const ids = ["a", "b", "c"];
    expect(chunkForBinding(ids)).toEqual([["a", "b", "c"]]);
  });

  it("splits input larger than the batch size into batches of at most 90", () => {
    const ids = Array.from({ length: 250 }, (_, i) => `id-${i}`);
    const batches = chunkForBinding(ids);
    expect(batches.length).toBe(3);
    expect(batches[0].length).toBe(90);
    expect(batches[1].length).toBe(90);
    expect(batches[2].length).toBe(70);
    expect(batches.flat()).toEqual(ids);
  });

  it("respects a custom batch size", () => {
    const ids = ["a", "b", "c", "d", "e"];
    expect(chunkForBinding(ids, 2)).toEqual([["a", "b"], ["c", "d"], ["e"]]);
  });

  it("never produces a batch above 100 even for huge inputs", () => {
    const ids = Array.from({ length: 1000 }, (_, i) => `id-${i}`);
    for (const batch of chunkForBinding(ids)) {
      expect(batch.length).toBeLessThanOrEqual(100);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/d1-binding.test.ts`
Expected: FAIL (cannot resolve `../../src/persistence/d1/binding`)

- [ ] **Step 3: Write the implementation**

Create `src/persistence/d1/binding.ts`:

```typescript
// D1 rejects statements with more than 100 bound parameters
// ("variable number must be between ?1 and ?100"). Any query that
// binds one parameter per id in an IN (...) clause must batch ids
// through this helper. 90 leaves headroom for fixed parameters.
export const D1_BIND_BATCH_SIZE = 90;

export function chunkForBinding<T>(values: T[], batchSize = D1_BIND_BATCH_SIZE): T[][] {
  if (batchSize < 1 || batchSize > 100) {
    throw new Error(`batchSize must be between 1 and 100, got ${batchSize}`);
  }
  const batches: T[][] = [];
  for (let index = 0; index < values.length; index += batchSize) {
    batches.push(values.slice(index, index + batchSize));
  }
  return batches;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/d1-binding.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/persistence/d1/binding.ts tests/unit/d1-binding.test.ts
git commit -m "feat: add chunkForBinding helper for D1 100-bind-parameter limit"
```

---

### Task 2: Batch the IN queries in both repositories

**Files:**
- Modify: `src/persistence/d1/DocumentRepository.ts:113-140`
- Modify: `src/persistence/d1/repository.ts:674-701`

Both files contain byte-identical `getChunkContentsByVectorIds` and `getDocumentsByIds`. Fix both. Do not consolidate the duplication in this task (out of scope).

- [ ] **Step 1: Replace both methods in `src/persistence/d1/DocumentRepository.ts`**

Add the import at the top of the file with the other local imports:

```typescript
import { chunkForBinding } from "./binding";
```

Replace `getChunkContentsByVectorIds` (currently lines 113-123) with:

```typescript
  async getChunkContentsByVectorIds(vectorIds: string[]) {
    const contents = new Map<string, string>();
    const uniqueIds = [...new Set(vectorIds.filter(Boolean))];
    for (const batch of chunkForBinding(uniqueIds)) {
      const placeholders = batch.map((_, index) => `?${index + 1}`).join(", ");
      const result = await this.db
        .prepare(`SELECT vector_id, content FROM chunks WHERE vector_id IN (${placeholders})`)
        .bind(...batch)
        .all<ChunkLookupRow>();
      for (const row of result.results) {
        contents.set(row.vector_id, row.content);
      }
    }
    return contents;
  }
```

Replace `getDocumentsByIds` (currently lines 125-140) with:

```typescript
  async getDocumentsByIds(documentIds: string[]) {
    const documents = new Map<string, ResolvedMemoryDocument>();
    const uniqueIds = [...new Set(documentIds.filter(Boolean))];
    for (const batch of chunkForBinding(uniqueIds)) {
      const placeholders = batch.map((_, index) => `?${index + 1}`).join(", ");
      const result = await this.db
        .prepare(`SELECT * FROM documents WHERE id IN (${placeholders})`)
        .bind(...batch)
        .all<DocumentRow>();
      for (const row of result.results) {
        const document = mapDocument(row);
        if (document) {
          documents.set(document.id, document);
        }
      }
    }
    return documents;
  }
```

- [ ] **Step 2: Apply the identical replacement in `src/persistence/d1/repository.ts`**

Same import, same two method bodies, replacing lines 674-701. The surrounding class differs but the method code is identical.

- [ ] **Step 3: Audit for other unbounded IN clauses**

Run: `grep -rn 'IN (${placeholders})' src/`

For every hit where the id array is unbounded (comes from vector results, caller-supplied lists, or document sets rather than a hardcoded small list), apply the same batching pattern. Known hits beyond the two above must be evaluated individually; batch any that can exceed 90 ids.

- [ ] **Step 4: Typecheck and run the full suite**

Run: `npm run typecheck && npm test`
Expected: clean typecheck, all tests pass. If `ranking.test.ts` or `search-memory.test.ts` fail, the change broke hydration semantics; the maps returned must have the same shape as before (vector_id -> content, id -> document).

- [ ] **Step 5: Commit**

```bash
git add src/persistence/d1/DocumentRepository.ts src/persistence/d1/repository.ts
git commit -m "fix: batch D1 IN-clause queries to stay under 100 bind parameters"
```

This is THE fix. Everything observed as "bad ranking" in production was downstream of these queries throwing.

---

### Task 3: Honest degraded mode

**Files:**
- Modify: `src/service/RetrievalService.ts` (fallback scoring ~line 801, response assembly ~lines 817-825)
- Modify: `src/service/PlanningService.ts:1019-1028` (warning gate)
- Test: `tests/unit/search-memory.test.ts` (extend existing file; follow its existing test construction patterns)

- [ ] **Step 1: Replace the flat 0.35 keyword score**

In `src/service/RetrievalService.ts`, the keyword result mapping (around line 795-814) emits `score: 0.35` for every result, which destroys ordering information downstream. `keywordFallbackScore` (defined at lines 122-149, range roughly -11 to +11) already computes a meaningful relative score and is already used for sorting at lines 764-768. Map it into the emitted score. Replace line 801:

```typescript
          score: 0.35,
```

with:

```typescript
          score: keywordFallbackRelevance(document, normalizedProject),
```

and add this helper next to `keywordFallbackScore` (after line 149):

```typescript
// Maps keywordFallbackScore (roughly -11..+11) into a bounded 0.05..0.6
// relevance so keyword fallback results keep their relative order in
// emitted scores but never outrank strong semantic hits (which score
// higher once vector retrieval is healthy).
function keywordFallbackRelevance(
  document: { project: string; memoryType: string; active: boolean; canonical: boolean; status: string },
  project: string,
) {
  const raw = keywordFallbackScore(document, project);
  return Math.min(0.6, Math.max(0.05, 0.35 + raw * 0.02));
}
```

- [ ] **Step 2: Add a top-level degraded signal to search responses**

In the same file, the `searchMemory` return object starts at line 817 (`task_profile`, `required_context_pack`, ... `results`, `grouped`). `vectorError` and `ranked` are in scope. Add two fields to that returned object:

```typescript
      degraded: Boolean(vectorError),
      retrieval_mode: vectorError
        ? "keyword_fallback_degraded"
        : ranked.length > 0
          ? "semantic"
          : "keyword_fallback",
```

If the return type is explicitly declared elsewhere (check for a `SearchMemoryResult` or similar interface via `grep -rn "task_profile" src/ --include="*.ts" -l`), add the two fields to that type too.

- [ ] **Step 3: Surface degradation warnings for ALL projects**

In `src/service/PlanningService.ts`, lines 1019-1028 currently read:

```typescript
    const warnings = buildContextWarnings({
      projectStatus,
      groupedMemory,
      retrievalMode,
      entities,
      initiatives,
      activeSources: input.activeSources,
    })
      .concat(project === "light-lane" ? contextCompleteness.warnings : [])
      .concat(currentTruth?.warnings ?? []);
```

Replace with:

```typescript
    const warnings = buildContextWarnings({
      projectStatus,
      groupedMemory,
      retrievalMode,
      entities,
      initiatives,
      activeSources: input.activeSources,
    })
      .concat(contextCompleteness.warnings)
      .concat(currentTruth?.warnings ?? [])
      .concat(
        retrievalMode === "vector_error"
          ? [
              "DEGRADED: semantic retrieval failed and results are keyword-only; treat memory recall as incomplete and stale-biased.",
            ]
          : [],
      );
```

Note: the file has pre-existing uncommitted edits from unrelated work. Make this change surgically; do not reformat or stage unrelated hunks (`git add -p` if needed).

- [ ] **Step 4: Add a regression test for the degraded flag**

Open `tests/unit/search-memory.test.ts`, study how it constructs the service/fixtures, and add a test asserting that when the vector path throws, the response has `degraded: true`, `retrieval_mode: "keyword_fallback_degraded"`, and keyword results have non-identical scores when their `keywordFallbackScore` inputs differ (e.g. a project-scoped current_context doc scores higher than a shared historical doc). Follow the file's existing mocking patterns exactly; do not invent a new harness.

- [ ] **Step 5: Run the suite**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/service/RetrievalService.ts src/service/PlanningService.ts tests/unit/search-memory.test.ts
git commit -m "feat: surface degraded retrieval mode and ranked keyword fallback scores"
```

---

### Task 4: Deploy, triage failed jobs, full reindex, live verification

This task is operational. It requires the user's permission for production actions; confirm before deploying and before deleting job rows.

- [ ] **Step 1: Deploy**

Run: `npm run deploy:production`
(This runs typecheck + tests + remote migrations + deploy. There are no new migrations in this plan; that is expected.)

- [ ] **Step 2: Verify the bind bug is gone, live**

Call MCP tool `mcp__context-os__retrieval_diagnostics` with `{"query": "current deals underway Light Lane pipeline", "project": "light-lane"}`.

Expected after fix: no `vector_error`, `ranked_vector_hits > 0`, top results with varied scores (not all 0.35). If `vector_error` still appears, STOP and debug before continuing; nothing else in this task matters until this is green.

- [ ] **Step 3: Inspect the failed-job backlog**

Find the jobs table name: `grep -rn "createReindexJob" src/persistence/d1/ | head -5`, then read that method to get the table name (expected: something like `reindex_jobs`). Then:

```bash
npx wrangler d1 execute DB --remote --command "SELECT status, COUNT(*) AS n FROM reindex_jobs GROUP BY status"
npx wrangler d1 execute DB --remote --command "SELECT error, COUNT(*) AS n FROM reindex_jobs WHERE status = 'failed' GROUP BY error ORDER BY n DESC LIMIT 10"
```

(Adjust table/column names to what the repository code actually uses.) Record the top failure reasons; if the dominant error is the same `variable number must be between ?1 and ?100` message, that confirms the write path was also hit by the bind bug and the index is incomplete.

- [ ] **Step 4: Archive the stale backlog**

After confirming with the user, delete failed job rows older than today (they are unretryable history; the reindex in the next step regenerates anything missing):

```bash
npx wrangler d1 execute DB --remote --command "DELETE FROM reindex_jobs WHERE status = 'failed'"
```

- [ ] **Step 5: Full reindex**

Call MCP tool `mcp__context-os__admin_reindex_all` (it exists on the production server). Monitor with `mcp__context-os__admin_status` until `queued_reindex_jobs` returns to 0; check `failed_reindex_jobs` stays near 0. If new failures appear, pull their errors via the SQL above and fix before closing the task.

- [ ] **Step 6: End-to-end verification**

Call `mcp__context-os__prepare_assistant_session` with `{"project_or_topic": "light-lane", "user_intent": "what deals are currently underway"}`.

Expected improvements vs the 10 June baseline: `grouped_memory.retrieval_summary` shows `vector_hits > 0` and `keyword_fallback_used: false` (or fallback with varied scores); results include recent material (Talley's, June source events) ranked above May-era documents. KNOWN REMAINING GAPS (do not chase in Phase 1, they are Phase 2): `situation` will still be null, dead May tasks will still appear, old facts are still active. Record the observed output somewhere durable (finish_work_session) as the post-P1 baseline for Phase 2/3 design.

- [ ] **Step 7: Merge**

Use the superpowers:finishing-a-development-branch skill: run the full suite once more, then merge `fix/d1-bind-batching` per the user's preference (direct merge to main or PR).

---

## Self-review notes

- The exact line numbers cited were verified on 10 June 2026 against a working tree that already had uncommitted modifications to `PlanningService.ts`; if lines have drifted, locate code by the quoted snippets, not the numbers.
- `keywordFallbackRelevance` caps at 0.6 deliberately: post-fix semantic hits carry ranking boosts (layer/type/project) and healthy semantic scores; fallback results must stay distinguishable and lower.
- Task 4 steps 3-5 touch production data. Confirm with Fabien before the DELETE and before triggering the full reindex (it consumes Workers/Vectorize quota).
