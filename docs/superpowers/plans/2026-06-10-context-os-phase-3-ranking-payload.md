# Context OS Phase 3: Ranking and Payload Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Context OS rank CURRENT state above stale history for a project's own queries: time decays semantic relevance multiplicatively, volatile memory goes stale and drops out, current structured entity states demote contradicting documents, a project's own namespace decisively wins its queries, and the session pack is a tight working set under ~32KB instead of a 63KB trimmed dump.

**Architecture:** Three feature areas from the remediation overview (overview section 4, Phase 3; root causes RC-5, RC-6, RC-9, RC-10), plus one load-bearing data prerequisite (Task 0: backfill `memory_layer`, which is NULL on ~942 of 943 docs so every layer boost is currently dead for historical docs). Pure ranking logic lives in `src/domain/ranking.ts` (single shared file imported by both service paths) and a new `src/domain/entity-authority.ts`; payload assembly lives in `src/domain/session.ts` (shared helpers) and the two duplicated `prepareAssistantSession` copies (`src/service/PlanningService.ts` production, `src/domain/service.ts` `MemoryService` legacy mirror that the unit-test harness exercises). Wiring of entity-state authority lands in both `src/service/RetrievalService.ts` and the `src/domain/service.ts` search path.

**Tech Stack:** Cloudflare Workers, D1 (SQLite), Vectorize, Zoho WorkDrive sync, TypeScript ESM, vitest (`@cloudflare/vitest-pool-workers`).

---

## Ground rules for the executor

- **Branch:** `feat/phase-3-ranking-payload` (already created off `main`). Keep `main` clean.
- **Match by quoted code, not line numbers.** Every line number here is from the 10 June 2026 post-Phase-2 snapshot and will drift; grep for the quoted snippet.
- **Two copies / shared files.** `src/domain/ranking.ts`, `src/domain/session.ts`, and `src/domain/entity-authority.ts` are SHARED single files imported by both the production service layer and the legacy `MemoryService`; change them once. The PACK ASSEMBLY and the SEARCH WIRING are DUPLICATED: production lives in `src/service/PlanningService.ts` + `src/service/RetrievalService.ts`; the legacy mirror lives in `src/domain/service.ts` (class `MemoryService`). The unit-test harness imports `~/domain/service`, so every behavioural change to assembly/wiring lands in BOTH copies or tests and production diverge. Repository finders, if added, land in BOTH `src/persistence/d1/EntityRepository.ts` (new path) and `src/persistence/d1/repository.ts` (legacy mega-repo) only if the method is duplicated there — grep first.
- **No migrations.** Every column used already exists (`documents.memory_layer`, `entity_states.status`, `entity_states.value_json`). Do not add a migration.
- **Tests run under `environment: node` with NO real D1.** Repository SQL is never exercised in tests — only mocked at the service boundary. Pure logic (`ranking.ts`, `entity-authority.ts`, `session.ts` helpers) IS unit-testable; do real TDD there. Verify repository/data behaviour live against production with `npx wrangler d1 execute DB --remote --json --command "..."`.
- **Verify before deploy:** `npm run typecheck && npm test` must pass. Baseline is 152 tests passing on `main`.
- **Ask Fabien before:** any production deploy, any destructive/bulk data operation (including the Task 0 backfill), and before changing anything that alters what existing sessions retrieve.
- **Admin/cron:** `admin_reindex_all` / `reindex_all` are admin-gated and the Claude Code principal is NOT admin. The production cron runs `runReconciliation` every 30 minutes. Re-index a single doc by re-writing it through its MCP tool (e.g. `upsert_situation`).
- **Do not weaken Phase 1** (D1 bind batching, loud degradation) **or Phase 2** (situation layer, supersede-on-write, task lifecycle) while tuning.

---

## File map

| File | Change |
|---|---|
| (data) production D1 `documents.memory_layer` | Task 0: backfill via the already-deployed `backfill_memory_layers` tool (Fabien-gated). |
| `src/domain/memory.ts` | Add optional `contradictedByCurrentState?: boolean` to `MemorySearchHit`. |
| `src/domain/ranking.ts` | Rewrite `computeRankingScore`: multiplicative half-life recency, per-type decay floors, entity-state-contradiction penalty, stronger namespace weighting. Add a stale-volatile hard gate to `rerankSearchHits`. |
| `src/domain/entity-authority.ts` | New: `deriveNotCurrentEntities` + `markContradictedHits` pure helpers. |
| `src/service/RetrievalService.ts` | In `searchMemoryBase`: build not-current entity signals for the project and mark hits before rerank. |
| `src/domain/service.ts` | Mirror the search-wiring change in the legacy `MemoryService` search path; mirror the pack-assembly changes in `prepareAssistantSession`. |
| `src/domain/session.ts` | Slim the manifest (`selectCurrentContextManifest` + drop `MAX_MANIFEST_DOCUMENTS` from 72 to 16, exclude entity-stub flood); add `compactRepoCoverage`. |
| `src/service/PlanningService.ts` | Use curated manifest; dedupe repo-coverage in the pack; gate `recommendedLiveChecks` by classified intent. |
| `tests/unit/ranking.test.ts` | Extend: decay ordering, stale-volatile gate, contradiction penalty, namespace weighting. |
| `tests/unit/entity-authority.test.ts` | New: pure-helper tests. |
| `tests/unit/session-manifest.test.ts` | New: manifest curation + repo-coverage compaction tests. |

---

## Task 0: Backfill `memory_layer` across the corpus (data prerequisite, Fabien-gated)

**Why:** `documents.memory_layer` is NULL on ~942 of 943 production docs (only the light-lane situation doc set in Phase 2 carries one). Every layer boost in `computeRankingScore` (`situation +0.65`, `knowledge +0.15`, `event_log -0.40`) is therefore dead for historical docs. Tuning layer-aware ranking before this is tuning a function whose dominant structural signal is off. The backfill tool already exists and is deployed (`backfill_memory_layers` in `src/tools/admin-tools.ts` → `DocumentService.backfillMemoryLayers` → `inferMemoryLayer(memory_type, canonical)` in `src/domain/service.ts`); it is NOT a code task, only a gated data operation.

**This is data, not code — no TDD.**

- [ ] **Step 1: Re-confirm the dry-run delta (non-destructive).**

Call the MCP tool:
```
backfill_memory_layers(dry_run: true)
```
Expected: `updated` ~942, `skipped` 1 (the existing light-lane situation doc), `dry_run: true`, and `samples` showing `current_context`/canonical → `knowledge`, `session_summary`/`historical_note` → `event_log`, `decision`/`snippet`/`repo_index` → `knowledge`, non-canonical `current_context` → `operational`. Confirm the mapping matches `inferMemoryLayer`:
- `session_summary` | `historical_note` → `event_log`
- `decision` | `snippet` | `repo_index` | (canonical `current_context`) → `knowledge`
- everything else (incl. non-canonical `current_context`) → `operational`

- [ ] **Step 2: Ask Fabien to approve the bulk write.**

This is a one-shot `UPDATE documents SET memory_layer = ?` across ~942 remote-D1 rows. It only fills a currently-NULL column (additive; existing non-null layers are skipped), but it is a bulk production-data write. Per the hard constraints, get explicit approval before applying. State plainly: "942 rows get a derived `memory_layer`; the 1 already-set situation doc is skipped; nothing else changes."

- [ ] **Step 3: Apply the backfill (only after approval).**
```
backfill_memory_layers(dry_run: false)
```
Expected: `updated` ~942, `skipped` 1, `dry_run: false`.

- [ ] **Step 4: Verify NULLs are gone.**
```bash
npx wrangler d1 execute DB --remote --json --command "SELECT memory_layer, count(*) AS n FROM documents GROUP BY memory_layer ORDER BY n DESC"
```
Expected: rows for `knowledge`, `event_log`, `operational`, `situation`, and ZERO rows where `memory_layer IS NULL`. If any NULLs remain, stop and inspect those `memory_type` values before proceeding.

- [ ] **Step 5: Re-observe retrieval against the now-layered corpus (informs tuning).**
```
retrieval_diagnostics(query: "current deals underway Light Lane pipeline", project: "light-lane")
```
Record the new `top_results` ordering and scores. This is the post-backfill baseline you tune the rest of Phase 3 against; do NOT design the ranking tasks against the pre-backfill ordering.

> Task 0 can run before OR after the code tasks land locally, but it MUST be applied to production before the Phase 3 acceptance checks in Task 8 are meaningful. Recommended: run Steps 1-2 now (observe + get approval), apply in Step 3 alongside the Task 8 deploy so the corpus and code change together.

---

## Task 1: Multiplicative half-life recency in `computeRankingScore`

**Why (RC-5):** Today freshness is an additive `max(0, 1 - age/30days) * 0.1` — max +0.1, flat-zero after 30 days. A 90-day-old doc and yesterday's doc score identically on time. Replace it with a multiplicative half-life factor applied to the SEMANTIC base score (`hit.score`), with per-memory-type half-lives and decay floors so durable knowledge barely decays while volatile memory falls off fast.

**Files:**
- Modify: `src/domain/ranking.ts` (constants + `computeRankingScore`)
- Test: `tests/unit/ranking.test.ts`

- [ ] **Step 1: Write the failing test.**

Add to `tests/unit/ranking.test.ts` (inside a new `describe`):

```typescript
describe("multiplicative recency decay", () => {
  const NOW = Date.UTC(2026, 5, 10); // 2026-06-10

  function hitAt(documentId: string, daysAgo: number, over: Partial<MemorySearchHit> = {}): MemorySearchHit {
    return makeHit({
      documentId,
      score: 0.7,
      updatedAtUnix: Math.floor((NOW - daysAgo * 24 * 60 * 60 * 1000) / 1000),
      ...over,
    });
  }

  it("ranks a fresh session summary above a 60-day-old one", () => {
    const ranked = rerankSearchHits(
      [
        hitAt("stale-session", 60, { memoryType: "session_summary", status: "historical", active: false, memoryLayer: "event_log" }),
        hitAt("fresh-session", 1, { memoryType: "session_summary", status: "historical", active: false, memoryLayer: "event_log" }),
      ],
      { now: NOW, includeSuperseded: true },
    );
    expect(ranked[0]?.documentId).toBe("fresh-session");
  });

  it("decays a durable snippet far less than a session summary over the same age", () => {
    // Both 90 days old, same base score. The snippet (durable) should outrank the session summary (volatile).
    const ranked = rerankSearchHits(
      [
        hitAt("old-session", 90, { memoryType: "session_summary", status: "historical", active: false, memoryLayer: "event_log" }),
        hitAt("old-snippet", 90, { memoryType: "snippet", memoryLayer: "knowledge" }),
      ],
      { now: NOW, includeSuperseded: true },
    );
    expect(ranked[0]?.documentId).toBe("old-snippet");
  });
});
```

- [ ] **Step 2: Run it, verify failure.**
```bash
npm test -- ranking
```
Expected: the first new test may already pass by luck via layer/status boosts, but the SECOND fails or is fragile under the current additive +0.1 nudge (a 90-day session summary and snippet differ only by fixed boosts, not by decay). Confirm at least one new assertion fails before implementing.

- [ ] **Step 3: Add the recency model constants to `src/domain/ranking.ts`.**

At the top of the file, replace:
```typescript
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
```
with:
```typescript
const DAY_MS = 24 * 60 * 60 * 1000;

// Per-memory-type recency half-life in days. Volatile types lose relevance fast;
// durable knowledge barely ages.
const RECENCY_HALF_LIFE_DAYS: Record<MemoryType, number> = {
  session_summary: 21,
  historical_note: 21,
  current_context: 120,
  decision: 120,
  snippet: 365,
  repo_index: 365,
};

// Floor on the recency multiplier per type, so durable knowledge never decays to nothing
// while volatile memory is allowed to fall to zero relevance.
const RECENCY_FLOOR: Record<MemoryType, number> = {
  session_summary: 0,
  historical_note: 0,
  current_context: 0.6,
  decision: 0.6,
  snippet: 0.9,
  repo_index: 0.9,
};

function recencyMultiplier(memoryType: MemoryType, ageDays: number): number {
  const halfLife = RECENCY_HALF_LIFE_DAYS[memoryType] ?? 120;
  const floor = RECENCY_FLOOR[memoryType] ?? 0.5;
  const raw = Math.pow(0.5, Math.max(0, ageDays) / halfLife);
  return Math.max(floor, raw);
}
```

Confirm `MemoryType` is imported in `ranking.ts` (it imports from `~/domain/memory`; add `MemoryType` to that import if absent).

- [ ] **Step 4: Apply the multiplier in `computeRankingScore`.**

In `computeRankingScore`, replace:
```typescript
  let score = hit.score;
```
with:
```typescript
  const ageDays = Math.max(0, (now - hit.updatedAtUnix * 1000) / DAY_MS);
  let score = hit.score * recencyMultiplier(hit.memoryType, ageDays);
```

And DELETE the old additive freshness block:
```typescript
  // Freshness decay (30 days)
  const age = Math.max(0, now - hit.updatedAtUnix * 1000);
  score += Math.max(0, 1 - age / THIRTY_DAYS_MS) * 0.1;
```

Leave all the layer/type/project/quality boosts exactly as they are for now (Tasks 2-3 and 5 adjust them).

- [ ] **Step 5: Run it, verify pass, then full suite.**
```bash
npm test -- ranking
```
Expected: PASS, including the pre-existing `rerankSearchHits` tests (they use fresh `updatedAtUnix`, so the multiplier is ~1 and ordering is unchanged).
```bash
npm run typecheck && npm test
```
Expected: full suite green (152 + new).

- [ ] **Step 6: Commit.**
```bash
git add src/domain/ranking.ts tests/unit/ranking.test.ts
git commit -m "feat: multiplicative half-life recency decay in ranking, per memory type"
```

---

## Task 2: Hard staleness gate for volatile memory types

**Why (RC-5):** Decay alone still lets a very stale session summary linger if its semantic match is strong. Volatile types (session summaries, historical notes) past a cutoff should drop out of DEFAULT retrieval entirely, surfacing only when history is explicitly requested (`includeSuperseded: true` is the existing "give me everything" escape hatch).

**Files:**
- Modify: `src/domain/ranking.ts` (`rerankSearchHits` filter chain + a cutoff constant)
- Test: `tests/unit/ranking.test.ts`

- [ ] **Step 1: Write the failing test.**

Add to `tests/unit/ranking.test.ts`:

```typescript
describe("stale-volatile hard gate", () => {
  const NOW = Date.UTC(2026, 5, 10);
  function sessionAt(documentId: string, daysAgo: number): MemorySearchHit {
    return makeHit({
      documentId,
      score: 0.95,
      memoryType: "session_summary",
      status: "historical",
      active: false,
      memoryLayer: "event_log",
      updatedAtUnix: Math.floor((NOW - daysAgo * 24 * 60 * 60 * 1000) / 1000),
    });
  }

  it("drops session summaries older than the cutoff by default", () => {
    const ranked = rerankSearchHits([sessionAt("ancient", 90), makeHit({ documentId: "keep" })], { now: NOW });
    expect(ranked.map((h) => h.documentId)).not.toContain("ancient");
    expect(ranked.map((h) => h.documentId)).toContain("keep");
  });

  it("keeps stale session summaries when history is explicitly requested", () => {
    const ranked = rerankSearchHits([sessionAt("ancient", 90), makeHit({ documentId: "keep" })], {
      now: NOW,
      includeSuperseded: true,
    });
    expect(ranked.map((h) => h.documentId)).toContain("ancient");
  });

  it("does not drop a current_context doc no matter how old", () => {
    const old = makeHit({
      documentId: "old-context",
      memoryType: "current_context",
      updatedAtUnix: Math.floor((NOW - 200 * 24 * 60 * 60 * 1000) / 1000),
    });
    const ranked = rerankSearchHits([old], { now: NOW });
    expect(ranked.map((h) => h.documentId)).toContain("old-context");
  });
});
```

- [ ] **Step 2: Run it, verify failure.**
```bash
npm test -- ranking
```
Expected: FAIL — stale session summaries are not dropped today.

- [ ] **Step 3: Add the cutoff constant and gate helper to `src/domain/ranking.ts`.**

Below the `RECENCY_FLOOR` block, add:
```typescript
// Volatile types vanish from default retrieval once older than this many days.
// includeSuperseded acts as the explicit "show me history" override.
const VOLATILE_STALE_CUTOFF_DAYS: Partial<Record<MemoryType, number>> = {
  session_summary: 45,
  historical_note: 45,
};

function isStaleVolatile(hit: MemorySearchHit, now: number): boolean {
  const cutoff = VOLATILE_STALE_CUTOFF_DAYS[hit.memoryType];
  if (cutoff === undefined) return false;
  const ageDays = (now - hit.updatedAtUnix * 1000) / DAY_MS;
  return ageDays > cutoff;
}
```

- [ ] **Step 4: Add the gate to the `rerankSearchHits` filter chain.**

In `rerankSearchHits`, the existing chain is:
```typescript
  return [...hits]
    .filter((hit) => options.includeSuperseded || !hit.superseded)
    .filter((hit) => options.includeSuperseded || isRetrievableMemoryStatus(hit.status))
    .filter((hit) => {
      if (!options.excludeLayers?.length || !hit.memoryLayer) return true;
      return !options.excludeLayers.includes(hit.memoryLayer);
    })
```
Insert one more filter immediately after the status filter:
```typescript
    .filter((hit) => options.includeSuperseded || !isStaleVolatile(hit, now))
```
(`now` is already resolved at the top of `rerankSearchHits` as `const now = options.now ?? Date.now();`.)

- [ ] **Step 5: Run it, verify pass, full suite.**
```bash
npm test -- ranking
npm run typecheck && npm test
```
Expected: PASS. Re-check the pre-existing "prefers active current context over stale historical notes" test — its historical_note is exactly 45 days old (`45 > 45` is false, so it is NOT dropped, only decayed), and the assertion only checks `ranked[0] === "current"`, which still holds.

- [ ] **Step 6: Commit.**
```bash
git add src/domain/ranking.ts tests/unit/ranking.test.ts
git commit -m "feat: drop stale volatile memory types from default retrieval"
```

---

## Task 3: Entity-state authority — pure helpers + ranking penalty

**Why (RC-6):** `resolve_current_truth` computes entity states in a parallel channel that only emits warnings; it never demotes a retrieved doc that contradicts the current truth. Phase 2 routed volatile truth to entity states (the parked May deals carry a not-current `deal_stage`, e.g. `parked_legacy_not_current_pipeline`). This task builds the deterministic lever: derive which entities are flagged not-current by their ACTIVE states, mark the hits that are "about" those entities, and penalise them in ranking — so Talley's (live) outranks Fivestar/Fully Promoted/Speedy Signs (parked) in `grouped_memory`.

**Files:**
- Modify: `src/domain/memory.ts` (add `contradictedByCurrentState?` to `MemorySearchHit`)
- Create: `src/domain/entity-authority.ts`
- Modify: `src/domain/ranking.ts` (penalty in `computeRankingScore`)
- Test: `tests/unit/entity-authority.test.ts` (new), `tests/unit/ranking.test.ts` (penalty)

- [ ] **Step 1: Add the optional flag to `MemorySearchHit`.**

In `src/domain/memory.ts`, in the `MemorySearchHit` type (the block ending with `memoryLayer?: MemoryLayer | null;` / `updatedAtUnix: number;` etc.), add:
```typescript
  contradictedByCurrentState?: boolean;
```
This is optional and additive; no existing construction site needs to change.

- [ ] **Step 2: Write the failing pure-helper test.**

Create `tests/unit/entity-authority.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { deriveNotCurrentEntities, markContradictedHits } from "~/domain/entity-authority";
import type { MemorySearchHit } from "~/domain/memory";

function hit(over: Partial<MemorySearchHit>): MemorySearchHit {
  return {
    documentId: "d", snapshotId: "s", vectorId: "v", title: "T",
    path: "/memory/projects/light-lane/knowledge/entities/companies/x.md",
    project: "light-lane", namespace: "light-lane", workdriveFileId: "w",
    memoryType: "current_context", status: "active", active: true, superseded: false,
    revision: 1, headingPath: "", chunkIndex: 0, chunkText: "", score: 0.7,
    updatedAtUnix: 0, ...over,
  };
}

describe("deriveNotCurrentEntities", () => {
  it("flags entities whose active volatile state reads as not-current", () => {
    const result = deriveNotCurrentEntities([
      { entityId: "e1", names: ["Fivestar Print", "fivestar-print"], states: [
        { stateKey: "deal_stage", value: "parked_legacy_not_current_pipeline", status: "active" },
      ] },
      { entityId: "e2", names: ["Talley's Group"], states: [
        { stateKey: "deal_stage", value: "active_multi_site_evaluation", status: "active" },
      ] },
    ]);
    expect(result.map((r) => r.entityId)).toEqual(["e1"]);
  });

  it("ignores superseded states and non-volatile keys", () => {
    const result = deriveNotCurrentEntities([
      { entityId: "e3", names: ["X"], states: [
        { stateKey: "deal_stage", value: "closed_lost", status: "superseded" },
        { stateKey: "industry", value: "legacy manufacturing", status: "active" },
      ] },
    ]);
    expect(result).toEqual([]);
  });
});

describe("markContradictedHits", () => {
  const notCurrent = [{ entityId: "e1", names: ["Fivestar Print", "fivestar-print"], reason: "deal_stage=parked" }];

  it("marks a hit whose path matches the entity slug", () => {
    const marked = markContradictedHits(
      [hit({ documentId: "fivestar", path: "/memory/projects/light-lane/knowledge/entities/companies/fivestar-print.md" })],
      notCurrent,
    );
    expect(marked[0]?.contradictedByCurrentState).toBe(true);
  });

  it("marks a hit whose title equals the entity name", () => {
    const marked = markContradictedHits([hit({ documentId: "t", title: "Fivestar Print", path: "/x.md" })], notCurrent);
    expect(marked[0]?.contradictedByCurrentState).toBe(true);
  });

  it("leaves unrelated hits untouched", () => {
    const marked = markContradictedHits([hit({ documentId: "talleys", title: "Talley's Group", path: "/talleys.md" })], notCurrent);
    expect(marked[0]?.contradictedByCurrentState).toBeUndefined();
  });

  it("is a no-op when nothing is not-current", () => {
    const original = hit({ documentId: "x" });
    const marked = markContradictedHits([original], []);
    expect(marked[0]).toBe(original);
  });
});
```

- [ ] **Step 3: Run it, verify failure.**
```bash
npm test -- entity-authority
```
Expected: FAIL — module does not exist.

- [ ] **Step 4: Implement `src/domain/entity-authority.ts`.**
```typescript
import type { MemorySearchHit } from "~/domain/memory";

// Active state values that mean "this entity is not part of current truth/pipeline".
const NOT_CURRENT_VALUE_PATTERN =
  /(parked|legacy|closed|lost|inactive|archived|dormant|dead|not[_\s-]?current|on[_\s-]?hold|deprioriti[sz]ed|stale|requires[_\s-]?live[_\s-]?check)/i;

// State keys that carry volatile current-state truth.
const VOLATILE_STATE_KEYS = new Set([
  "deal_stage",
  "status",
  "pipeline_status",
  "next_action",
  "source_freshness",
  "engagement_status",
]);

export type EntityStateLike = { stateKey: string; value: unknown; status: string };
export type EntityWithStates = { entityId: string; names: string[]; states: EntityStateLike[] };
export type NotCurrentEntity = { entityId: string; names: string[]; reason: string };

export function deriveNotCurrentEntities(entities: EntityWithStates[]): NotCurrentEntity[] {
  const result: NotCurrentEntity[] = [];
  for (const entity of entities) {
    const signal = entity.states.find(
      (state) =>
        state.status === "active" &&
        VOLATILE_STATE_KEYS.has(state.stateKey) &&
        NOT_CURRENT_VALUE_PATTERN.test(String(state.value ?? "")),
    );
    if (signal) {
      result.push({
        entityId: entity.entityId,
        names: entity.names.filter((name) => Boolean(name)),
        reason: `${signal.stateKey}=${String(signal.value)}`,
      });
    }
  }
  return result;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function markContradictedHits(
  hits: MemorySearchHit[],
  notCurrent: NotCurrentEntity[],
): MemorySearchHit[] {
  if (!notCurrent.length) return hits;
  const slugs = notCurrent.flatMap((e) => e.names.map(slugify)).filter((s) => s.length > 2);
  const lowerNames = notCurrent.flatMap((e) => e.names.map((n) => n.toLowerCase())).filter((n) => n.length > 2);
  return hits.map((hit) => {
    const pathLc = hit.path.toLowerCase();
    const titleLc = hit.title.toLowerCase();
    const contradicted =
      slugs.some((slug) => pathLc.includes(slug)) ||
      lowerNames.some((name) => titleLc === name);
    return contradicted ? { ...hit, contradictedByCurrentState: true } : hit;
  });
}
```

- [ ] **Step 5: Run it, verify pass.**
```bash
npm test -- entity-authority
```
Expected: PASS.

- [ ] **Step 6: Add the penalty to `computeRankingScore` — failing test first.**

Add to `tests/unit/ranking.test.ts`:
```typescript
describe("entity-state contradiction penalty", () => {
  it("demotes a hit contradicted by current state below an equal uncontradicted hit", () => {
    const ranked = rerankSearchHits(
      [
        makeHit({ documentId: "parked", score: 0.75, contradictedByCurrentState: true }),
        makeHit({ documentId: "live", score: 0.7 }),
      ],
      { includeSuperseded: true },
    );
    expect(ranked[0]?.documentId).toBe("live");
  });
});
```

- [ ] **Step 7: Run it, verify failure, then implement.**
```bash
npm test -- ranking
```
Expected: FAIL — `parked` (0.75) still outranks `live` (0.7).

In `src/domain/ranking.ts` `computeRankingScore`, immediately after the superseded penalty line:
```typescript
  if (hit.superseded) score -= 0.25;
```
add:
```typescript
  // Current structured entity state contradicts this document -> strong demotion.
  if (hit.contradictedByCurrentState) score -= 0.6;
```

- [ ] **Step 8: Run it, verify pass, full suite, commit.**
```bash
npm test -- ranking entity-authority
npm run typecheck && npm test
git add src/domain/memory.ts src/domain/entity-authority.ts src/domain/ranking.ts tests/unit/entity-authority.test.ts tests/unit/ranking.test.ts
git commit -m "feat: entity-state authority demotes documents contradicted by current truth"
```

---

## Task 4: Wire entity-state authority into the search path (both copies)

**Why:** The pure helpers from Task 3 are inert until `searchMemoryBase` marks hits before reranking. This is the production wiring (`RetrievalService.ts`) plus the legacy `MemoryService` mirror (`src/domain/service.ts`) that the test harness exercises. There is no clean unit-test surface here (it needs the entity repo), so this task is verified live in Task 8; keep the logic thin and lean on the Task 3 unit tests for correctness.

**Files:**
- Modify: `src/service/RetrievalService.ts` (`searchMemoryBase`)
- Modify: `src/domain/service.ts` (legacy search path mirror)
- Possibly modify: `src/persistence/d1/EntityRepository.ts` (+ `repository.ts` if duplicated) — add a finder if one does not already return entities-with-active-states for a project.

- [ ] **Step 1: Find or add a repository finder for active entity states with entity names.**

Grep for how `resolveCurrentTruthInternal` fetches states:
```bash
grep -n "listEntityStatesForEntities\|searchEntityAliases\|listEntitiesByProject\|listActiveEntityStates" src/persistence/d1/EntityRepository.ts src/persistence/d1/repository.ts
```
You need, for a project, the set of `{ entityId, names: string[], states: [{stateKey, value, status}] }`. If an existing method already yields entities + their active states for a project (e.g. a combination of a list-entities call and `listEntityStatesForEntities`), reuse it. Only if nothing fits, add to `EntityRepository`:
```typescript
  async listActiveEntityStatesForProject(input: { project: string }): Promise<
    Array<{ entityId: string; stateKey: string; value: unknown; status: string }>
  > {
    const rows = await this.db
      .prepare(
        `SELECT entity_id AS entityId, state_key AS stateKey, value_json AS valueJson, status
         FROM entity_states
         WHERE project = ?1 AND status = 'active'`,
      )
      .bind(input.project)
      .all<{ entityId: string; stateKey: string; valueJson: string; status: string }>();
    return rows.results.map((row) => ({
      entityId: row.entityId,
      stateKey: row.stateKey,
      value: safeJsonParse(row.valueJson),
      status: row.status,
    }));
  }
```
Use the file's existing JSON-parse helper (grep `JSON.parse` in the repo for the established pattern; reuse it rather than adding a new one). Mirror into `src/persistence/d1/repository.ts` ONLY if that legacy file also defines entity-state methods (grep `entity_states` there; if absent, skip — the legacy `MemoryService` may reuse the same `EntityRepository`).

Entity NAMES come from the entities table / aliases. Reuse whatever `resolveCurrentTruthInternal` already loads (it builds `entities` with aliases). Prefer assembling `EntityWithStates` from data already fetched there over adding new name queries.

- [ ] **Step 2: Build not-current signals and mark hits in `RetrievalService.searchMemoryBase`.**

At the top of `RetrievalService.ts`, add to the domain imports:
```typescript
import { deriveNotCurrentEntities, markContradictedHits, type EntityWithStates } from "~/domain/entity-authority";
```

In `searchMemoryBase`, locate the rerank call:
```typescript
    ranked: applyDocumentDiversity(
      rerankSearchHits(hydratedHits, {
        includeSuperseded: input.includeSuperseded,
        project: normalizedProject,
        repo: input.repo,
        path: input.path,
        excludeLayers: deriveExcludeLayers(
          input.retrieval_intent ??
            deriveRetrievalIntent(classifyRequest(input.query), input.query),
        ),
      }),
```
Immediately BEFORE this `return`/assembly, fetch and mark:
```typescript
    const notCurrentEntities = await this.computeNotCurrentEntities(normalizedProject);
    const markedHits = markContradictedHits(hydratedHits, notCurrentEntities);
```
and change `rerankSearchHits(hydratedHits, { ... })` to `rerankSearchHits(markedHits, { ... })`.

Add the private helper on the service:
```typescript
  private async computeNotCurrentEntities(project: string) {
    try {
      const states = await this.entityRepo.listActiveEntityStatesForProject({ project });
      if (!states.length) return [];
      const entityIds = [...new Set(states.map((s) => s.entityId))];
      const entities = await this.entityRepo.getEntitiesByIds({ project, ids: entityIds });
      const nameById = new Map(
        entities.map((e) => [e.id, [e.name, ...(e.aliases ?? []), e.slug].filter(Boolean) as string[]]),
      );
      const grouped: EntityWithStates[] = entityIds.map((id) => ({
        entityId: id,
        names: nameById.get(id) ?? [],
        states: states.filter((s) => s.entityId === id).map((s) => ({ stateKey: s.stateKey, value: s.value, status: s.status })),
      }));
      return deriveNotCurrentEntities(grouped);
    } catch {
      return [];
    }
  }
```
Adjust `getEntitiesByIds` to whatever the real entity-fetch-by-id method is (grep `getEntitiesByIds\|getEntityById\|listEntitiesByIds` in `EntityRepository.ts`); if only a single-id getter exists, map over ids. The `try/catch` makes entity authority best-effort: a repo error degrades to "no demotion", never breaks search.

- [ ] **Step 3: Mirror the wiring in the legacy `MemoryService` search path.**

In `src/domain/service.ts`, grep for the legacy search method that calls `rerankSearchHits`:
```bash
grep -n "rerankSearchHits" src/domain/service.ts
```
Apply the identical pattern: build not-current entities (using the legacy class's repo handle, `this.repo` or the entity repo it holds), `markContradictedHits`, pass the marked hits into `rerankSearchHits`. If the legacy class shares the same `EntityRepository` instance, reuse `computeNotCurrentEntities` logic inline.

- [ ] **Step 4: Verify typecheck + full suite.**
```bash
npm run typecheck && npm test
```
Expected: PASS. No new unit test here (live-verified in Task 8); existing search/session tests must stay green — if a session test now sees marked hits, confirm the mark only fires for genuinely not-current entities (the test fixtures have no such states, so behaviour is unchanged).

- [ ] **Step 5: Commit.**
```bash
git add src/service/RetrievalService.ts src/domain/service.ts src/persistence/d1/EntityRepository.ts
git commit -m "feat: mark hits contradicted by current entity state before reranking"
```

---

## Task 5: Stronger project-over-shared namespace weighting

**Why (RC-9):** Raw Vectorize top hits for light-lane queries are nearly all `namespace: "shared"` session summaries. The current project `+0.18` / shared `-0.03` weighting is too weak to overcome the flood. Strengthen it so a project's own namespace decisively wins its own queries.

**Files:**
- Modify: `src/domain/ranking.ts` (`computeRankingScore`)
- Test: `tests/unit/ranking.test.ts`

- [ ] **Step 1: Write the failing test.**
```typescript
describe("namespace weighting", () => {
  it("ranks a project doc above a shared doc with a higher base score", () => {
    const ranked = rerankSearchHits(
      [
        makeHit({ documentId: "shared-strong", project: "shared", namespace: "shared", score: 0.8 }),
        makeHit({ documentId: "project-own", project: "light-lane", namespace: "light-lane", score: 0.6 }),
      ],
      { project: "light-lane", includeSuperseded: true },
    );
    expect(ranked[0]?.documentId).toBe("project-own");
  });
});
```

- [ ] **Step 2: Run it, verify failure.**
```bash
npm test -- ranking
```
Expected: FAIL — with `+0.18`/`-0.03`, `shared-strong` (0.8 - 0.03 = 0.77) still beats `project-own` (0.6 + 0.18 = 0.78)... borderline; if it passes by a hair, tighten the test base scores to 0.85 vs 0.55 to force the failure, then proceed.

- [ ] **Step 3: Strengthen the weights.**

In `computeRankingScore`, replace:
```typescript
  // Project match
  if (options.project && hit.project === options.project) score += 0.18;
  if (options.project && hit.project === "shared") score -= 0.03;
```
with:
```typescript
  // Namespace weighting: a project's own docs decisively win its own queries.
  if (options.project && hit.project === options.project) score += 0.3;
  if (options.project && hit.project === "shared" && options.project !== "shared") score -= 0.2;
```

- [ ] **Step 4: Run it, verify pass, full suite, commit.**
```bash
npm test -- ranking
npm run typecheck && npm test
git add src/domain/ranking.ts tests/unit/ranking.test.ts
git commit -m "feat: strengthen project-over-shared namespace weighting"
```

---

## Task 6: Slim the session manifest (drop the entity-stub flood)

**Why (RC-10):** The `current_context` manifest carries up to 72 alphabetical items dominated by entity stubs (192 docs for light-lane). It is the biggest single chunk of the 63KB pack and surfaces parked-deal stubs at the top. Curate it: situation first, then the genuine `context/current/*` documents and a few non-entity knowledge docs, capped at 16; entity stubs are reachable via search and do not belong in the always-loaded manifest.

**Files:**
- Modify: `src/domain/session.ts` (`MAX_MANIFEST_DOCUMENTS`, `compactCurrentContextDocuments`, add `selectCurrentContextManifest`)
- Test: `tests/unit/session-manifest.test.ts` (new)

- [ ] **Step 1: Write the failing test.**

Create `tests/unit/session-manifest.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { selectCurrentContextManifest, MAX_MANIFEST_DOCUMENTS } from "~/domain/session";
import type { ResolvedMemoryDocument } from "~/domain/memory";

function doc(over: Partial<ResolvedMemoryDocument>): ResolvedMemoryDocument {
  return {
    id: "d", workdriveFileId: "w", currentSnapshotId: null,
    path: "/memory/projects/light-lane/knowledge/entities/companies/x.md",
    title: "X", project: "light-lane", namespace: "light-lane", parentFolderId: "p",
    fileName: "x.md", permalink: null, downloadUrl: null, memoryType: "current_context",
    status: "active", canonical: true, active: true, revision: 1, tags: [],
    memoryLayer: "knowledge", ...over,
  };
}

describe("selectCurrentContextManifest", () => {
  it("puts the situation doc first, then context/current docs, before entity stubs", () => {
    const docs = [
      doc({ id: "entity1", path: "/memory/projects/light-lane/knowledge/entities/companies/fivestar.md" }),
      doc({ id: "ctx", path: "/memory/projects/light-lane/context/current/what-light-lane-is.md", memoryLayer: "knowledge" }),
      doc({ id: "sit", path: "/memory/projects/light-lane/context/current/situation.md", memoryLayer: "situation" }),
    ];
    const selected = selectCurrentContextManifest(docs);
    expect(selected.map((d) => d.id).slice(0, 2)).toEqual(["sit", "ctx"]);
  });

  it("caps at MAX_MANIFEST_DOCUMENTS", () => {
    const docs = Array.from({ length: 40 }, (_, i) =>
      doc({ id: `e${i}`, path: `/memory/projects/light-lane/knowledge/entities/companies/e${i}.md` }),
    );
    expect(selectCurrentContextManifest(docs).length).toBe(MAX_MANIFEST_DOCUMENTS);
  });
});
```

- [ ] **Step 2: Run it, verify failure.**
```bash
npm test -- session-manifest
```
Expected: FAIL — `selectCurrentContextManifest` does not exist.

- [ ] **Step 3: Implement the curator and shrink the cap.**

In `src/domain/session.ts`, replace:
```typescript
const MAX_MANIFEST_DOCUMENTS = 72;
```
with:
```typescript
export const MAX_MANIFEST_DOCUMENTS = 16;

/**
 * Curate the current-context manifest: situation first, then real context/current
 * documents, then non-entity knowledge, with entity-stub docs pushed last. Entity
 * stubs flood the manifest and are reachable via search, so they should not dominate
 * the always-loaded pack.
 */
export function selectCurrentContextManifest(
  documents: ResolvedMemoryDocument[],
  max: number = MAX_MANIFEST_DOCUMENTS,
): ResolvedMemoryDocument[] {
  const rank = (doc: ResolvedMemoryDocument): number => {
    if (doc.memoryLayer === "situation") return 0;
    if (doc.path.includes("/context/current/")) return 1;
    if (doc.path.includes("/knowledge/entities/")) return 4;
    if (doc.memoryLayer === "knowledge") return 2;
    return 3;
  };
  return [...documents]
    .map((doc, index) => ({ doc, index, rank: rank(doc) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .slice(0, max)
    .map((entry) => entry.doc);
}
```
Confirm `ResolvedMemoryDocument` is imported in `session.ts` (it is — `compactCurrentContextDocuments` already takes it).

- [ ] **Step 4: Use the curator inside `compactCurrentContextDocuments`.**

Replace:
```typescript
    items: documents.slice(0, MAX_MANIFEST_DOCUMENTS).map((document) => ({
```
with:
```typescript
    items: selectCurrentContextManifest(documents).map((document) => ({
```
Keep `document_count: documents.length` (report the true total) and update `omitted_item_count` to:
```typescript
    omitted_item_count: Math.max(0, documents.length - MAX_MANIFEST_DOCUMENTS),
```
(unchanged formula; still correct).

- [ ] **Step 5: Run it, verify pass, full suite.**
```bash
npm test -- session-manifest
npm run typecheck && npm test
```
Expected: PASS. The budget trimmers in `enforceCompactSessionBudget` that trim `current_context.items` to 36/16 now rarely fire because the manifest starts at <=16.

- [ ] **Step 6: Commit.**
```bash
git add src/domain/session.ts tests/unit/session-manifest.test.ts
git commit -m "feat: curate and cap the current-context manifest, drop entity-stub flood"
```

---

## Task 7: Dedupe repo coverage and gate live checks by intent (both copies)

**Why (RC-10):** The pack repeats the full repo-coverage block (8-repo `present`/`required` arrays) in `repo_coverage`, `context_completeness.repo_coverage`, and `source_freshness`, and demands CRM/mail/calendar/shopify "required live checks" on every turn regardless of intent. Compact the repeated repo arrays and restrict live checks to the classified intent. Target: pack well under 32KB untrimmed (`payload_budget.trimmed: false`).

**Files:**
- Modify: `src/domain/session.ts` (add `compactRepoCoverage`)
- Modify: `src/service/PlanningService.ts` (`recommendedLiveChecks` gating + repo-coverage compaction in the compact branch)
- Modify: `src/domain/service.ts` (mirror both)
- Test: `tests/unit/session-manifest.test.ts` (extend for `compactRepoCoverage`)

- [ ] **Step 1: Write the failing `compactRepoCoverage` test.**

Add to `tests/unit/session-manifest.test.ts`:
```typescript
import { compactRepoCoverage } from "~/domain/session";

describe("compactRepoCoverage", () => {
  it("reduces a full coverage block to complete + missing only", () => {
    const full = {
      required: ["a/b", "c/d", "e/f", "g/h"],
      present: ["a/b", "c/d", "e/f", "g/h"],
      missing: [],
      complete: true,
    };
    expect(compactRepoCoverage(full)).toEqual({ complete: true, missing: [] });
  });

  it("keeps the missing list when coverage is incomplete", () => {
    const full = { required: ["a/b", "c/d"], present: ["a/b"], missing: ["c/d"], complete: false };
    expect(compactRepoCoverage(full)).toEqual({ complete: false, missing: ["c/d"] });
  });
});
```

- [ ] **Step 2: Run it, verify failure.**
```bash
npm test -- session-manifest
```
Expected: FAIL — `compactRepoCoverage` does not exist.

- [ ] **Step 3: Implement `compactRepoCoverage` in `src/domain/session.ts`.**
```typescript
export function compactRepoCoverage(
  coverage: { complete?: boolean; missing?: string[] } | null | undefined,
): { complete: boolean; missing: string[] } {
  return {
    complete: Boolean(coverage?.complete),
    missing: coverage?.missing ?? [],
  };
}
```

- [ ] **Step 4: Apply repo-coverage compaction in the compact session branch (both copies).**

In `src/service/PlanningService.ts` `prepareAssistantSession`, in the `enforceCompactSessionBudget({ ... })` object, add a top-level `repo_coverage` override and drop the heavy nested `present`/`required` arrays. Add:
```typescript
  repo_coverage: compactRepoCoverage(contextCompleteness.repo_coverage),
```
and in the same compact object, replace the full `context_completeness` passthrough with a compacted one — add a small helper inline or extend `compactContextCompleteness` if one exists (grep). Minimal approach: after building the compact object, set:
```typescript
  context_completeness: {
    ...contextCompleteness,
    repo_coverage: compactRepoCoverage(contextCompleteness.repo_coverage),
  },
```
Import `compactRepoCoverage` from `~/domain/session` at the top of `PlanningService.ts`. Mirror the identical two overrides in `src/domain/service.ts` `prepareAssistantSession` compact branch.

- [ ] **Step 5: Gate `recommendedLiveChecks` by classified intent (both copies).**

In `src/service/PlanningService.ts`, change the `recommendedLiveChecks` signature to receive the request categories, and only emit external-source checks for relevant intents. Replace:
```typescript
function recommendedLiveChecks(input: {
  project: string;
  activeSources?: string[];
  entities: unknown[];
  tasks: ContextTask[];
  sourceEvents: SourceEvent[];
  warnings: string[];
  currentTruthChecks?: unknown[];
}) {
  const checks = new Set<string>();
  for (const source of input.activeSources ?? []) {
    checks.add(`Check live ${source} for fresh context before writing durable summaries.`);
  }
  if (input.tasks.some((task) => task.dueAt || task.reminderAt)) {
    checks.add("Check calendar/reminder source for due-date freshness.");
  }
  if (input.sourceEvents.length === 0) {
    checks.add("If this task depends on CRM/email/calendar/shopify state, query that live MCP before deciding.");
  }
  if (input.warnings.some((warning) => warning.includes("semantic"))) {
    checks.add("Run retrieval_diagnostics and consider reindexing before assuming memory is complete.");
  }
  for (const rawCheck of input.currentTruthChecks ?? []) {
    const check = isRecord(rawCheck) ? rawCheck : {};
    const sourceKind = typeof check.source_kind === "string" ? check.source_kind : "source";
    const reason = typeof check.reason === "string" ? check.reason : "current truth guardrail";
    checks.add(`Check live ${sourceKind} before relying on current-state recommendations: ${reason}`);
  }
  return [...checks];
}
```
with a version that takes `externalStateRelevant` and only emits the generic external-source nudge and per-source checks when the intent actually depends on external state:
```typescript
function recommendedLiveChecks(input: {
  project: string;
  activeSources?: string[];
  entities: unknown[];
  tasks: ContextTask[];
  sourceEvents: SourceEvent[];
  warnings: string[];
  currentTruthChecks?: unknown[];
  externalStateRelevant: boolean;
}) {
  const checks = new Set<string>();
  if (input.externalStateRelevant) {
    for (const source of input.activeSources ?? []) {
      checks.add(`Check live ${source} for fresh context before writing durable summaries.`);
    }
    if (input.tasks.some((task) => task.dueAt || task.reminderAt)) {
      checks.add("Check calendar/reminder source for due-date freshness.");
    }
    if (input.sourceEvents.length === 0) {
      checks.add("If this task depends on CRM/email/calendar/shopify state, query that live MCP before deciding.");
    }
  }
  if (input.warnings.some((warning) => warning.includes("semantic"))) {
    checks.add("Run retrieval_diagnostics and consider reindexing before assuming memory is complete.");
  }
  // current-truth checks always honoured — they only arise for genuine current-state queries.
  for (const rawCheck of input.currentTruthChecks ?? []) {
    const check = isRecord(rawCheck) ? rawCheck : {};
    const sourceKind = typeof check.source_kind === "string" ? check.source_kind : "source";
    const reason = typeof check.reason === "string" ? check.reason : "current truth guardrail";
    checks.add(`Check live ${sourceKind} before relying on current-state recommendations: ${reason}`);
  }
  return [...checks];
}
```
At the call site in `prepareAssistantSession`, compute `externalStateRelevant` from the request classification already built (grep for `request_classification` / `classifyRequest` / the `categories` object in this method):
```typescript
    externalStateRelevant:
      requestClassification.categories.customer_sales_business ||
      requestClassification.categories.planning_scheduling ||
      requestClassification.categories.external_source_dependent,
```
Use the actual variable name for the classification object in scope (it may be `requestClassification`, `classification`, or read off `assistantActionPlan.request_classification`). Mirror the identical signature change and call-site gating in `src/domain/service.ts`.

- [ ] **Step 6: Run the full suite.**
```bash
npm run typecheck && npm test
```
Expected: PASS. If an existing session/planning test asserts the presence of a now-gated live check for a memory-context query, update that assertion to reflect the intent gating (the check should no longer appear for non-external intents) — this is a deliberate behaviour change, document it in the commit.

- [ ] **Step 7: Commit.**
```bash
git add src/domain/session.ts src/service/PlanningService.ts src/domain/service.ts tests/unit/session-manifest.test.ts
git commit -m "feat: dedupe repo coverage and gate live checks by classified intent"
```

---

## Task 8: Verify, deploy (Fabien-gated), apply backfill, confirm acceptance

- [ ] **Step 1: Full local verification.**
```bash
npm run typecheck && npm test
```
Expected: all green (152 baseline + the new ranking/entity-authority/session-manifest tests, zero failures).

- [ ] **Step 2: Measure the untrimmed pack size locally if a harness exists; otherwise defer to live.**

If `tests/integration/assistant-session-planning.test.ts` (or similar) can assert `payload_budget.serialized_bytes`, add a temporary assertion that the light-lane-shaped pack serializes under 32KB with `trimmed: false`. If no such harness exists, this is verified live in Step 6.

- [ ] **Step 3: Ask Fabien to deploy.**

Per hard constraints, do not deploy without approval. When approved:
```bash
npm run deploy:production
```
(`deploy:production` runs typecheck + tests + remote D1 migrations + deploy. There are no new migrations in this plan; the migration step is a no-op.)

- [ ] **Step 4: Apply the Task 0 backfill against production (Fabien-gated).**

If not already applied, run Task 0 Steps 2-4 now (the code change does not require it, but the acceptance criteria do). Confirm zero NULL `memory_layer` rows.

- [ ] **Step 5: Force a fresh index of any doc whose ranking inputs changed, if needed.**

Ranking is computed at query time from D1 columns, so no re-index is required for the ranking/namespace/decay changes. The `contradictedByCurrentState` mark is computed live from `entity_states` and needs no re-index. Skip unless Step 6 shows stale `memory_layer` for a specific doc, in which case re-write that doc through its MCP tool.

- [ ] **Step 6: Re-run the three verification calls and check acceptance.**

1. `retrieval_diagnostics(query: "current deals underway Light Lane pipeline", project: "light-lane")` — still `semantic`, `vector_error: null`, `ranked_vector_hits` ~10-12, varied scores (NO Phase-1 regression).
2. `admin_status()` — `queued_reindex_jobs: 0`, `failed_reindex_jobs: 0`.
3. `prepare_assistant_session(project_or_topic: "light-lane", user_intent: "what deals are underway")`.

Acceptance (overview section 4, Phase 3):
- [ ] For the current-state query, top-5 `grouped_memory` results are all <30 days old OR durable-knowledge docs; the situation doc ranks first, and parked May-era deal stubs (Fivestar, Fully Promoted, Speedy Signs) no longer appear above it.
- [ ] Shared-namespace session summaries do not outrank project docs.
- [ ] `payload_budget.trimmed` is `false` and `serialized_bytes` is under ~32KB (was 63KB trimmed).
- [ ] No regression: situation non-null, `needs_review_tasks` still holds the dead May tasks, live `tasks` are current work.

If any acceptance check fails, treat it as a tuning loop: adjust the relevant constant (half-life, floor, cutoff, namespace weight, or contradiction penalty), re-run `npm test`, redeploy (Fabien-gated), re-verify. Do not loosen Phase 1/2 behaviour to pass.

- [ ] **Step 7: Save post-Phase-3 state and close out.**
- `finish_work_session(project: "memory-system-mcp", ...)` summarising P3-1 (decay, stale gate, entity-state authority), P3-2 (namespace, manifest, repo-coverage dedup, live-check gating), and the Task 0 backfill.
- `record_decision` for the ranking-model change (multiplicative half-life + entity-state authority) with `canonical_key: "context-os-ranking-model"`.
- Finish the branch with superpowers:finishing-a-development-branch (Fabien chose local merge + push for Phase 2).

---

## Optional / stretch (Tier-2 RC-8) — only if Fabien explicitly scopes it in

`runReconciliation` (`src/domain/queue.ts`) re-creates a failed `reindex_jobs` row for any never-indexed file every pass and never cleans up orphaned job rows or retries. A dead-letter / retry / orphan-cleanup path plus a prominent failed count is independent of ranking and is OUT of scope for Tasks 1-8. Do not bundle it into this branch unless Fabien asks.

---

## Self-review checklist (completed by plan author)

- **Spec coverage:** RC-5 → Tasks 1 (decay) + 2 (stale gate). RC-6 → Tasks 3 (helpers + penalty) + 4 (wiring). RC-9 → Task 5 (namespace). RC-10 → Tasks 6 (manifest) + 7 (repo-coverage dedup + live-check gating). Data prerequisite (memory_layer NULL) → Task 0. Acceptance → Task 8. ✓
- **No migrations:** all columns exist (`memory_layer`, `entity_states.status`, `value_json`). ✓
- **Shared vs duplicated:** ranking/session/entity-authority are shared single files (changed once); search wiring (Task 4) and pack assembly (Task 7) name BOTH `src/service/*` and `src/domain/service.ts`. ✓
- **Type consistency:** `recencyMultiplier(memoryType, ageDays)`, `isStaleVolatile(hit, now)`, `deriveNotCurrentEntities(EntityWithStates[])` → `NotCurrentEntity[]`, `markContradictedHits(hits, NotCurrentEntity[])`, `contradictedByCurrentState?: boolean`, `selectCurrentContextManifest(documents, max?)`, `compactRepoCoverage(coverage)` used consistently across tasks. ✓
- **TDD surface:** pure logic in `ranking.ts`/`entity-authority.ts`/`session.ts` is unit-tested (Tasks 1,2,3,5,6,7); untestable repo/wiring (Task 4) is live-verified in Task 8 and kept thin. ✓
- **Existing tests preserved:** Tasks note exactly why the four current `ranking.test.ts` cases still pass (fresh timestamps → multiplier ~1; 45-day historical not dropped by `>45`). ✓
- **Phase 1/2 not weakened:** no change to bind batching, degraded-mode flags, situation layer, supersede-on-write, or task lifecycle. ✓
