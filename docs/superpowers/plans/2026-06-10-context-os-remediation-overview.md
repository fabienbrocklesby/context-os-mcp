# Context OS Remediation: Overview, Diagnosis, and Phase Roadmap

> **For agentic workers:** This is the master context document for the Context OS remediation effort.
> Phase 1 has a detailed executable plan: `docs/superpowers/plans/2026-06-10-context-os-phase-1-restore-correctness.md`.
> Phases 2 and 3 are specified here at design level. Whoever picks them up must first re-run the
> verification steps at the bottom of this document (the system's behavior changes materially once
> Phase 1 lands), then write a detailed plan using the superpowers:writing-plans skill before coding.

**Goal:** Make Context OS reliably surface CURRENT state (active deals, current positioning, live priorities) across all of Fabien's projects, instead of stale months-old memories.

**Date of diagnosis:** 10 June 2026. Evidence collected live against production plus a full codebase exploration and deep architectural review.

---

## 1. The reported failure

Claude, running with Context OS as its source of truth, consistently:

- Surfaces old deals (Fivestar, Speedy Signs / Fermin, Cristy at Fully Promoted) when asked about Light Lane's pipeline, instead of the new big ones (Talley's Group multi-site enterprise evaluation, legal/accounting engagements via Duncan Cotterill).
- Misses that Light Lane massively shifted from "laser shop / software company" to enterprise "global traceability infrastructure" positioning with $50k-$5M deal economics.
- Generally does not understand "what is currently happening" across projects.

## 2. Root-cause analysis (verified, with evidence)

### RC-1 (Tier 0, outright bug): D1 bind-parameter overflow kills ALL semantic retrieval

Every production search returns `vector_error: "D1_ERROR: variable number must be between ?1 and ?100 at offset 550: SQLITE_ERROR"`. Vectorize returns plenty of raw matches (up to 300 across 5 query variants x top_k 30 x 2 namespaces), but the D1 chunk-hydration step builds a single `IN (?1...?N)` clause with one bind parameter per id. D1's hard limit is 100 bound parameters. The statement throws, the error is swallowed, `ranked_vector_hits` is always 0, and the system silently serves keyword fallback.

- `src/persistence/d1/DocumentRepository.ts:113-123` (`getChunkContentsByVectorIds`) and `:125-140` (`getDocumentsByIds`)
- Exact duplicate code in `src/persistence/d1/repository.ts:674-684` and `:686-701`
- The throw is caught at `src/service/RetrievalService.ts:746-748` and stored as a string, then execution falls through to keyword fallback.

Consequence: the ENTIRE ranking pipeline (recency boosts, layer boosts, type boosts in `src/domain/ranking.ts`) never executes in production. Every conclusion about "bad ranking" observed live is actually observing the keyword fallback path.

### RC-2 (Tier 0, silent-failure design): degradation is invisible

Keyword fallback results all get a hardcoded flat score of `0.35` (`src/service/RetrievalService.ts:801`), so output ordering is effectively arbitrary (manifest/insertion order, which favors old alphabetical entity stubs). The caller gets a 200 with populated results and no degraded signal. `contextCompleteness.warnings` are only surfaced for the light-lane project (hardcoded gate at `src/service/PlanningService.ts:1027`). This is why total semantic-search breakage survived in production unnoticed.

### RC-3 (Tier 1, missing architecture): no supersede-on-write

Frontmatter supports `supersedes` / `superseded_by` and ranking filters `superseded` docs, but NOTHING ever sets these fields automatically. Recording the new enterprise positioning does not retire the old positioning. Old facts stay `active` forever and compete with the present on equal terms. The system is append-only; a current-truth system cannot be.

### RC-4 (Tier 1, bug + architecture): situation layer is a global singleton nobody populates

`findSituationDocument` (`src/service/PlanningService.ts:769-781`, mirrored at `src/domain/service.ts:1070-1082`) only queries `project: "shared"`, `memoryLayer: "situation"`, `canonical: true`, limit 1. There is no per-project situation document. `prepare_assistant_session` for light-lane returns `situation: null`. The layer documented as "always loaded first, the most important thing in the system" is unreachable for every project.

### RC-5 (Tier 1, architecture): ranking treats time as a rounding error

`src/domain/ranking.ts:29-67`: freshness is an additive `max(0, 1 - age/30days) * 0.1`. Max +0.1, linear, flat-zero after 30 days. Layer boosts dominate (situation +0.65, current_context +0.20, knowledge +0.15). A 90-day-old doc and yesterday's doc score identically on time. No decay, no penalty, no per-type cutoff. (Currently moot because of RC-1, but becomes the live problem the moment RC-1 is fixed.)

### RC-6 (Tier 1, architecture): entity states never influence retrieval

`resolve_current_truth` (`src/service/RetrievalService.ts:932-995`) computes entity states in a parallel channel that only produces warnings. It never re-ranks, filters, or demotes contradicting semantic results. The one structured "what is true now" source has no authority over what gets surfaced.

### RC-7 (Tier 2): no task lifecycle

`listTasks` ordering is priority + due date with no auto-expiry. On 10 June, the session pack served 12 overdue "urgent" tasks from 11-26 May (including the emergency cashflow sprint that literally names Fivestar, Speedy Signs, Cristy). Dead tasks read as today's priorities.

### RC-8 (Tier 2): 22,638 failed reindex jobs, silent

`runReconciliation` (`src/domain/queue.ts:206-289`) runs jobs inline and on failure just increments a counter (keeps only first 20 errors). Failed rows accumulate forever, no retry, no dead-letter, no alerting. It is a frozen historical backlog (last cron: scanned 698, enqueued 3, completed), not active churn, BUT it likely means part of the corpus was never embedded, and some failures may have been this same bind bug on the write path.

### RC-9 (Tier 2): shared namespace floods project namespace

Raw Vectorize top hits for light-lane queries are nearly all `namespace: "shared"` session summaries and historical notes. Project boost (+0.18) and shared penalty (-0.03) in `ranking.ts:42-43` are too weak to overcome the flood once ranking comes back online.

### RC-10 (Tier 2): context pack design outsources freshness

The pack is ~64KB (hits payload budget and trims), repeats repo coverage 3+ times, includes a 191-item alphabetical manifest dominated by entity stubs, and demands 9 "required live checks" (zoho_crm, mail, calendar, github, shopify, workdrive...) every turn. The system tells the caller to resolve freshness itself instead of representing current state.

---

## 3. Fix architecture (organizing principles)

1. **Separate "current state" from "history" as a first-class distinction.** One small, mutable, authoritative per-project situation document, written on decision, trusted over anything retrieved.
2. **Supersede on write, not never.** New facts/decisions/states stamp conflicting prior records superseded. Volatile truth (deal stage, positioning) lives in structured entity states, not free-text fact files.
3. **Time is multiplicative, not additive.** Recency as a half-life multiplier on semantic score. Hard staleness cutoffs for volatile memory types (session summaries, deal status, tasks); slow/no decay for durable knowledge.
4. **Degradation must be loud.** Vector failure => explicit degraded flag in every response + warning in every project's context health. Failed jobs => retry, dead-letter, prominent count.
5. **The context pack is a tight working set,** not a dump: situation first, live entities/deals, live tasks (stale ones bucketed separately), a few reranked memories with evidence grades, recent source events, only intent-relevant live checks.

---

## 4. Phase roadmap

### Phase 1: restore correctness (detailed plan exists, ~1 day)

See `docs/superpowers/plans/2026-06-10-context-os-phase-1-restore-correctness.md`. Summary:

1. **P1-1:** Batch all unbounded `IN (?...)` D1 queries into chunks of <=90 ids (both `DocumentRepository.ts` and `repository.ts`, plus audit for other instances). This single fix reanimates semantic search and the whole ranking pipeline.
2. **P1-2:** Honest degradation: surface `vector_error` and a degraded retrieval mode in search results and context health for ALL projects (remove the light-lane-only warning gate), and replace the flat 0.35 keyword score with a score derived from `keywordFallbackScore` so ordering survives into output.
3. **P1-3:** Failed-jobs triage: inspect/purge the 22,638 stale failed jobs, re-run a full reindex now that hydration works, confirm `ranked_vector_hits > 0` live.

### Phase 2: current-state architecture (~2-4 days, the durable fix)

> Prerequisite: Phase 1 deployed and verified. Re-measure retrieval first; do not design against the broken baseline.

- **P2-1: Per-project situation documents.** Change `findSituationDocument` (both `PlanningService.ts:769` and `service.ts:1070`) to resolve `project: <active slug>` first, fall back to `shared`. Then author the light-lane situation doc capturing: traceability-infrastructure positioning, Talley's Group status, Duncan Cotterill legal engagement, accountant engagement, deal economics ($50k floor / $100k typical / $5M ceiling), current team structure. Ship code change and authored doc together (the doc is unreachable without the code change, the code change is pointless without the doc).
- **P2-2: Supersede-on-write.** On `record_decision`, `extract_durable_facts`, and `upsert_entity_state`: resolve conflicting prior records (match on entity + topic/factKey) and stamp them `superseded` + set `superseded_by`. Route volatile truth (deal stage, positioning, who-works-here) to entity states as the authority. Design note: `upsert_entity_state` is already key-value upsert semantics, so the main work is (a) fact/decision conflict resolution at write time, (b) migrating the write-path guidance so volatile facts become states.
- **P2-3: Task lifecycle.** Add a staleness rule: tasks overdue by more than N days (suggest N=14) move to a `needs_review` state (computed at read or via cron) and are EXCLUDED from the default high-priority surface in session packs. Session pack shows two buckets: "live tasks" and "overdue, confirm or close". Touch points: `listTasks` usage in `PlanningService.ts:979` and the task repository in `src/persistence/d1/EntityRepository.ts:442-478`.

Acceptance for Phase 2: `prepare_assistant_session(project_or_topic: "light-lane")` returns a non-null situation doc containing the current positioning; a query about "deals underway" surfaces Talley's before any May-era deal; no task overdue by >14 days appears in the default priority list; writing a new positioning fact marks the old one superseded (verify via `search_memory` with `include_superseded: true` vs default).

### Phase 3: ranking and payload quality (~2-3 days)

> Prerequisite: Phases 1-2 deployed. Ranking tuning before that is tuning a function that never ran against a corpus that lacks current-state structure.

- **P3-1: Time-aware reranking.** Rewrite `computeRankingScore` (`src/domain/ranking.ts:29-67`): recency as a multiplicative half-life factor (suggest half-life 21-30 days) on the semantic score rather than a +0.1 additive nudge. Per-memory-type hard recency gates: volatile types (session_summary, source events, deal-status-like facts) excluded from default retrieval past N days unless explicitly requested; durable types (knowledge, snippets, conventions) decay slowly or not at all. Inject entity-state authority: retrieved docs contradicting a current entity state get demoted or annotated. Update `tests/unit/ranking.test.ts` alongside.
- **P3-2: Namespace and payload.** Strengthen project-over-shared weighting so a project's own namespace decisively wins its own queries. Slim the session pack: situation first, drop the alphabetical entity-stub manifest flood, dedupe the repeated repo-coverage blocks, cut required live checks to only those relevant to the classified intent. Target: a useful pack well under the 64KB budget without trimming.

Acceptance for Phase 3: for a current-state query on light-lane, top-5 results are all <30 days old or durable-knowledge docs; shared-namespace session summaries do not outrank project docs; session pack under ~32KB untrimmed with zero repeated sections.

**Do not reorder phases.** Phase 3 depends on observing real (post-P1) ranking behavior, and Phase 2's situation/supersede model changes what Phase 3 needs to rank.

---

## 5. How to verify state at any time (run these before starting any phase)

1. `mcp__context-os__retrieval_diagnostics(query: "current deals underway Light Lane pipeline", project: "light-lane")`
   - Broken (pre-P1): `vector_error: "D1_ERROR: variable number must be between ?1 and ?100..."`, `ranked_vector_hits: 0`, `keyword_fallback_used: true`, all scores 0.35.
   - Fixed (post-P1): no `vector_error`, `ranked_vector_hits > 0`, varied scores.
2. `mcp__context-os__admin_status()` : check `failed_reindex_jobs` (was 22,638 on 10 June 2026).
3. `mcp__context-os__prepare_assistant_session(project_or_topic: "light-lane", user_intent: "what deals are underway")` : check `situation` (null pre-P2), tasks list for dead May tasks (pre-P2), payload size/trim flag (pre-P3).

## 6. Repo facts an implementing agent needs

- Repo: `/Users/fabienbrocklesby/Code/personal/memory-system-mcp` (Cloudflare Workers + D1 + Vectorize + Zoho WorkDrive sync, TypeScript, ESM).
- Tests: `vitest` (`npm test`), workers pool via `@cloudflare/vitest-pool-workers`. Unit tests in `tests/unit/`, integration in `tests/integration/`.
- Typecheck: `npm run typecheck`. Deploy: `npm run deploy:production` (runs typecheck + tests + remote D1 migrations + deploy).
- There are TWO repository implementations with duplicated code: `src/persistence/d1/DocumentRepository.ts` and the older `src/persistence/d1/repository.ts`. Bug fixes must land in BOTH (or the duplication consolidated, but that is a separate decision; do not block Phase 1 on it).
- Memory layers: situation > knowledge > operational > event_log. Memory types include current_context, decision, historical_note, session_summary, snippet, repo_index.
- Initiatives live in D1; the three top-level ones are light-lane, dropshipping-portfolio, software-infrastructure. This remediation work belongs to software-infrastructure, project slug `memory-system-mcp`.
- Durable facts about this diagnosis were saved to Context OS project `memory-system-mcp` on 10 June 2026.
