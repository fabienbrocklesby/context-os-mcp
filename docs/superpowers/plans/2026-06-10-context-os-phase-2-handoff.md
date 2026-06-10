# Context OS Phase 2 Handoff (post Phase 1, 10 June 2026)

> Paste-able handoff prompt for the next agent. Phase 1 is DONE, deployed, verified, and merged to main. This document is the single entry point for continuing the remediation.

## Prompt for the next agent

Implement Phase 2 of the Context OS remediation, plus one small data fix left over from Phase 1.

Context: on 10 June 2026 Phase 1 of the remediation shipped and was verified live. The D1 bind-parameter overflow that disabled all semantic retrieval is fixed (chunkForBinding, batch 90, applied in DocumentRepository.ts, repository.ts, and EntityRepository.ts), degraded retrieval is now loud (top-level `degraded` and `retrieval_mode` fields, DEGRADED warning for all projects), and the 22,680-row failed-job backlog was purged. Everything is merged to main and deployed. Full diagnosis and the Phase 2/3 design are in `docs/superpowers/plans/2026-06-10-context-os-remediation-overview.md`. The post-P1 baseline and durable facts are saved in Context OS under project `memory-system-mcp` (session summary "Phase 1 complete: D1 bind batching fix restored semantic retrieval in production").

Verify state before starting (overview section 5):
1. `mcp__context-os__retrieval_diagnostics(query: "current deals underway Light Lane pipeline", project: "light-lane")` should show no `vector_error`, `ranked_vector_hits` around 10 to 12, classification `semantic`, varied scores. If it shows `vector_error`, STOP, something regressed; debug that first.
2. `mcp__context-os__admin_status()` should show `queued_reindex_jobs: 0` and `failed_reindex_jobs: 42` (or a multiple of 42; see task 0 below). Anything else failing is new and needs investigation.
3. `mcp__context-os__prepare_assistant_session(project_or_topic: "light-lane", user_intent: "what deals are underway")` will show the known Phase 2 gaps: `situation: null`, dead May tasks listed as urgent, old facts still active. Those gaps are your job.

Your job, in order:

**Task 0 (quick win, do first): fix the 42 rejected brain files.**
Context OS task id `ebc9ce1c-8a8d-40ad-a3a3-53ee98b3f748`. 42 files under `/memory/projects/light-lane/knowledge/brain/` carry `memory_type: business_knowledge`, which `memoryTypeSchema` (src/domain/memory.ts) rejects, so they fail ingest on every 30-minute reconciliation cron (exactly 42 failed jobs per pass) and the synced brain copy has never been indexed. They were written by an external vault export, not by this repo. The files are mirrored locally at `~/Library/CloudStorage/ZohoWorkDriveTrueSync-LightLane/My Folders/memory/projects/light-lane/knowledge/brain/` (TrueSync writes back to WorkDrive; the Zoho WorkDrive MCP download tool does NOT work, DC mismatch). Two options: extend the enum with a durable knowledge type, or rewrite the 42 files' frontmatter to an existing type. Before choosing, check whether the same content already exists in memory under other paths (the business brain was imported earlier via the ai-brain-vault import; `has_business_brain` is already true), because duplicating 42 knowledge docs would pollute retrieval. Ask Fabien one question with your recommendation before writing anything. After the fix, confirm a cron pass produces 0 failed jobs via `admin_status`.

**Task 1: write the Phase 2 plan.** Use the superpowers:writing-plans skill. Source design: overview section 4, Phase 2 (P2-1 per-project situation documents, P2-2 supersede-on-write, P2-3 task lifecycle). Re-read the overview fully first. Key design notes that must survive into the plan:
- P2-1 ships code and content together: change `findSituationDocument` (both `src/service/PlanningService.ts` and the legacy mirror in `src/domain/service.ts`) to resolve the active project first with shared fallback, AND author the light-lane situation doc (traceability-infrastructure positioning, Talley's Group status, Duncan Cotterill legal engagement, accountant engagement, deal economics $50k floor / $100k typical / $5M ceiling, current team structure). Source the content from Context OS facts and source events, then have Fabien confirm it before it becomes canonical.
- P2-2: on `record_decision`, `extract_durable_facts`, and `upsert_entity_state`, resolve conflicting prior records and stamp them superseded. Volatile truth routes to entity states.
- P2-3: tasks overdue more than 14 days move to a needs_review bucket and leave the default priority surface.
- Acceptance criteria are spelled out in the overview (situation non-null with current positioning, Talley's ranks above May deals, no >14-day-overdue task in default list, superseded facts verifiable via include_superseded).

**Task 2: execute the plan** with superpowers:executing-plans (or subagent-driven-development), task by task.

Hard constraints:
1. Work on a branch (suggest `feat/phase-2-current-state`). main is clean; keep it that way.
2. Do NOT start Phase 3 (ranking rewrite, namespace weighting, payload slimming). The overview explicitly orders the phases.
3. Both duplicated code paths must stay in sync: service-layer changes land in `src/service/*` AND the legacy `src/domain/service.ts` mirror where the same logic exists (the unit-test harness exercises the legacy copy). Same for the two repository classes.
4. Ask Fabien before any production deploy, any destructive data operation, and before making the authored situation document canonical.
5. `admin_reindex_all` / `reindex_all` are admin-gated and the Claude Code principal is not admin. You do not need them: the production cron runs the identical `runReconciliation` every 30 minutes. For D1 inspection use `npx wrangler d1 execute DB --remote --json --command "..."`.
6. Verify with `npm run typecheck && npm test` before any deploy. After deploy, re-run the three verification calls above; Phase 2 success is measured against the acceptance criteria in the overview.
7. When done: save the post-P2 state via `finish_work_session` (project `memory-system-mcp`), mark Context OS tasks `task-phase-2-current-state` AND its duplicate `4ecc6b5e-1e63-4fa2-b665-b1d6e55e595c` done, and mark `ebc9ce1c-8a8d-40ad-a3a3-53ee98b3f748` done if task 0 landed.

Repo facts: Cloudflare Workers + D1 + Vectorize + Zoho WorkDrive sync, TypeScript ESM, vitest (140 tests, all passing on main). Deploy with `npm run deploy:production`. Line numbers in the overview were verified 10 June 2026 pre-Phase-1; Phase 1 shifted some of them, so match by quoted code snippets, not line numbers.

## State snapshot at handoff (10 June 2026, ~07:15 UTC)

- main = `356e2e0` merged and pushed; production deployed from this code at 06:33 UTC (version 5c721ce9-449d-405f-865f-01d8ddda56cc).
- Live retrieval: semantic, vector_error null, ranked_vector_hits 10 to 12, varied scores, June material ranking above May.
- Failed jobs: 42 per cron pass, all the brain files above, nothing else failing.
- Known remaining gaps (Phase 2 scope): situation null, dead May tasks surface as urgent, old facts active, no supersede-on-write.
- Phase 3 gaps (do not touch): additive recency, shared-namespace flood, 64KB trimmed payload.
