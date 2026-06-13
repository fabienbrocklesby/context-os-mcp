# Context OS Phase 4 Handoff: Payload Budget, Reindex Durability, Ranking Robustness

> **Status note:** The original remediation roadmap (`docs/superpowers/plans/2026-06-10-context-os-remediation-overview.md`) defined THREE phases, all now shipped, deployed, and verified. There was no planned Phase 4. This document bundles the deferred follow-ups that accumulated during Phases 1 to 3 into a single optional cleanup phase. Nothing here is blocking; the system is healthy. Pick this up only when payload size, reindex hygiene, or ranking robustness becomes worth the time.

## Documents to read first (in this order)

1. `docs/superpowers/plans/2026-06-10-context-os-remediation-overview.md` — the master design. Root causes RC-1 to RC-10 in section 2; the Tier-2 items (RC-8) and the verification routine (section 5) are the relevant parts for Phase 4.
2. `docs/superpowers/plans/2026-06-10-context-os-phase-3-ranking-payload.md` — what just shipped. Read its **Ground rules** and **File map**: the two-copy duplication, no-migration / no-D1-in-tests realities, and conventions all still apply. The **Optional / stretch (RC-8)** section at the bottom is P4-2 below.
3. Context OS, project `memory-system-mcp`: pull these at the start with `search_memory(query: "Phase 3 complete ranking payload", project: "memory-system-mcp")`:
   - session summary **"Phase 3 complete: time-aware ranking, entity-state authority, namespace + payload quality"**
   - decision **`context-os-ranking-model`** (the canonical ranking-model record)
   - open task **`251c2b82-9245-4013-a6dc-96d42e456bc2`** ("get light-lane session pack under 32KB untrimmed") — this is P4-1
   - facts **`phase-3-entity-authority-50-cap-limitation`** and **`request-classifier-deal-plural-quirk`** — these are P4-3

## Prompt for the next agent

Implement Phase 4 of the Context OS remediation: payload-budget reduction, reindex-job durability, and two small ranking-robustness fixes. Phases 1 to 3 are done, deployed (prod version `8e272200-b322-4826-b7de-d71136918a0b`), and merged to `main` (`d1f0e8d`). Re-read the overview and the Phase 3 plan fully before touching code. These three workstreams are INDEPENDENT — do them in any order, or pick only the ones that matter.

**Verify state before starting (overview section 5):**

1. `mcp__context-os__retrieval_diagnostics(query: "current deals underway Light Lane pipeline", project: "light-lane")` — must be `semantic`, `vector_error: null`, `ranked_vector_hits` ~10 to 12. If `vector_error` is set, STOP, Phase 1 regressed.
2. `mcp__context-os__admin_status()` — `queued_reindex_jobs: 0`, `failed_reindex_jobs: 0`.
3. `mcp__context-os__prepare_assistant_session(project_or_topic: "light-lane", user_intent: "what deals are underway")` — confirm Phase 2/3 held: `situation` non-null, situation doc ranks first in `grouped_memory`, parked May deals (Fivestar, Fully Promoted, Speedy Signs) absent while South Pine / MainFreight are present, `needs_review_tasks` holds the dead May tasks. Note `payload_budget.serialized_bytes` (~64.8KB) and `trimmed: true` — that is exactly P4-1's target.

### P4-1: Get the session pack under 32KB untrimmed (the explicit Phase 3 miss)

Context OS task `251c2b82`. Phase 3 hit the ranking and payload-QUALITY goals (manifest capped 72 to 16, repo-coverage deduped, live checks intent-gated), but the pack is still ~64.8KB and `trimmed: true`; the target was <32KB untrimmed. The remaining bulk is in sections Phase 3 did not touch, measured live:

- `grouped_memory` ~13KB (12 results, each carrying a full ~300-char `text` excerpt)
- `tasks` ~6KB
- `needs_review_tasks` ~5.9KB (12 dead tasks at full size)
- `operating_brief` ~4.7KB

Levers, in rough priority order:
- **Trim `grouped_memory` text in the compact pack.** The full chunk excerpt per result is the single biggest cost. Shorten to a snippet (e.g. 120 chars) or drop `text` entirely in compact mode and rely on title/path/score + `fetch` for detail. Touch point: `compactSearchMemory` in `src/domain/session.ts`.
- **Cap `needs_review_tasks`.** Surface a small head (e.g. 5) plus a count, not all 12 at full description length. `compactTasks` already caps at 12; add a dedicated tighter cap or a "+N more" summary for the review bucket.
- **Slim `operating_brief`.** It restates strategy/context already present elsewhere in the pack. Compact or reference rather than repeat.
- **Consider lowering `COMPACT_SESSION_MAX_BYTES`** (currently 64KB in `src/domain/session.ts`) so the budget enforcer trims harder — but note this only changes the trimmed ceiling; the real win is emitting less so the RAW pack is <32KB and `trimmed` comes back `false`. Acceptance is specifically `trimmed: false` with `serialized_bytes` < ~32KB.

The pack assembly + compaction lives in `src/domain/session.ts` (`compact*` helpers, `enforceCompactSessionBudget`) and the two `prepareAssistantSession` copies (`src/service/PlanningService.ts` + `src/domain/service.ts`). Both copies must stay in sync. Acceptance: light-lane session pack `< ~32KB` with `trimmed: false`, and no Phase 2/3 behaviour lost (situation still first, parked deals still demoted, needs_review still populated, repo-coverage still deduped).

### P4-2: Reindex-job durability (Tier-2 RC-8)

`runReconciliation` (`src/domain/queue.ts`) re-creates a failed `reindex_jobs` row for any never-indexed file every pass and never cleans up orphaned job rows or retries; on failure it just increments a counter (keeps the first 20 errors). It is currently a frozen historical backlog (failed count is 0 today after the Phase 2 purge), but the design has no dead-letter, no retry, and no orphan cleanup. Add: a bounded retry with backoff, a dead-letter terminal state for permanently-failing jobs, orphan-row cleanup for files that no longer exist, and a prominent failed-count surfaced in `admin_status`. This is independent of ranking and payload — keep it on its own branch/commits. The production cron runs `runReconciliation` every 30 minutes, so verify changes against a live `admin_status` after deploy. `admin_reindex_all` / `reindex_all` are admin-gated and the Claude Code principal is NOT admin.

### P4-3: Two small ranking-robustness fixes (low priority)

Both recorded as facts; neither is a live problem today.
- **Entity-authority 50-cap** (`phase-3-entity-authority-50-cap-limitation`): `computeNotCurrentEntities` (`src/domain/entity-authority.ts`) enumerates entities via `searchEntities({project, limit:50})`, repo-capped at 50 and ordered `updated_at DESC`. Parked entities have OLD `updated_at`, so if a project ever exceeds 50 entities the not-current ones (exactly the ones to demote) are the first excluded. light-lane has 20 entities today. Fix when it matters: add a states-first finder (`listActiveEntityStatesForProject` returning active states directly, then fetch names for just those entity ids) so coverage scales with entities-that-have-states, not all entities. The pure helpers (`deriveNotCurrentEntities`, `markContradictedHits`) already accept the right shape — only the fetch changes.
- **Classifier plural quirk** (`request-classifier-deal-plural-quirk`): `classifyRequest` (`src/domain/request-classification.ts`) matches `customer_sales_business` via `\bdeal\b`, which misses the plural "deals". Currently harmless (current-state queries are still covered via `isCurrentStateQuery` + the unconditional current-truth checks), but broadening the sales/deal patterns to plurals would make `requiresExternalStateChecks` fire correctly for "what deals are underway".

**Hard constraints (unchanged from Phase 3):**
1. Work on a branch (suggest `feat/phase-4-payload-durability`). `main` is clean and matches production; keep it that way.
2. Both duplicated paths stay in sync: service-layer changes land in `src/service/*` AND the legacy `src/domain/service.ts` mirror (class `MemoryService`, which the unit tests import); repository changes land in BOTH `src/persistence/d1/DocumentRepository.ts` and `repository.ts` (and `EntityRepository.ts` if you add an entity finder).
3. Tests run under `environment: node` with NO real D1. Pure logic (`session.ts` helpers, `entity-authority.ts`, `ranking.ts`, `queue.ts` partition/retry helpers if extracted pure) IS unit-testable; do real TDD there. Verify repository/data/cron behaviour live against production with `npx wrangler d1 execute DB --remote --json --command "..."` and `admin_status`.
4. Ask Fabien before any production deploy, any destructive/bulk data operation, and before changing anything that alters what existing sessions retrieve.
5. Verify with `npm run typecheck && npm test` before any deploy (baseline is 182 tests passing on `main`). Deploy with `npm run deploy:production`. After deploy, re-run the three verification calls above.
6. Match by quoted code snippets, not line numbers (Phases 1 to 3 shifted line numbers throughout `service.ts`, `PlanningService.ts`, `session.ts`, and the repositories).
7. When done: save post-P4 state via `finish_work_session` (project `memory-system-mcp`), mark task `251c2b82` done if P4-1 ships, and finish the branch with superpowers:finishing-a-development-branch (Fabien used local merge + push for Phases 2 and 3).

## Critical learnings carried from Phases 1 to 3

- **The pack is ~64.8KB because of `grouped_memory` text excerpts + the task lists + `operating_brief`, NOT the manifest.** The manifest is already capped at 16. Do not re-tune the manifest; target the excerpt/task/brief sections.
- **Two-copy duplication is real and load-bearing.** `src/service/PlanningService.ts` + `RetrievalService.ts` + `DocumentService.ts` + `EntityService.ts` are production; `src/domain/service.ts` (`MemoryService`) is the legacy mirror the tests exercise. `DocumentRepository.ts` (new) + `repository.ts` (legacy). Phase 3 consolidated `computeNotCurrentEntities` into the shared `src/domain/entity-authority.ts` to fight this — prefer extracting shared pure helpers over copy-pasting where the interface allows.
- **Ranking is query-time from D1 columns** (`memory_layer`, `updated_at_unix`, `status`, etc.) plus live `entity_states`. No re-index is needed for ranking changes. Payload changes also need no re-index.
- **`memory_layer` is fully backfilled** (knowledge 416, event_log 407, operational 119, situation 1; zero NULL). Do not re-run the backfill.
- **Phase 3 ranking model** (canonical_key `context-os-ranking-model`): multiplicative per-type half-life decay + 45-day stale-volatile gate + entity-state `-0.6` contradiction penalty + project `+0.3` / shared `-0.2` namespace. Do not weaken these; P4 is additive cleanup, not a re-tune.

## State snapshot at handoff (13 June 2026)

- `main` = `d1f0e8d`, pushed to origin; production deployed from this code (version `8e272200-b322-4826-b7de-d71136918a0b`) at 100%. 182 tests passing.
- Phases 1 to 3 live and verified: semantic retrieval healthy (`vector_error` null, `ranked_vector_hits` ~10), 0 failed / 0 queued reindex jobs, per-project situation doc reachable and ranking first, parked deals demoted out by entity-state authority, namespace weighting strong, manifest curated to 16, repo-coverage deduped, live checks intent-gated.
- **Phase 4 scope (all optional):** P4-1 payload <32KB untrimmed (task `251c2b82`); P4-2 reindex dead-letter/retry/orphan-cleanup (RC-8, `src/domain/queue.ts`); P4-3 entity-authority 50-cap + classifier plural quirk (low priority).
- **Do not** weaken Phase 1 (D1 bind batching, loud degradation), Phase 2 (situation layer, supersede-on-write, task lifecycle), or Phase 3 (ranking model, payload quality) behaviour.
