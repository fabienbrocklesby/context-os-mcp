# Handoff prompt: Context OS Phase 1 implementation

Paste the following into a fresh Claude Code session in `/Users/fabienbrocklesby/Code/personal/memory-system-mcp`:

---

Implement Phase 1 of the Context OS remediation.

Context: on 10 June 2026 we diagnosed why Context OS serves stale memories. Root cause: a D1 bind-parameter overflow (`IN (?1...?N)` with >100 params) in chunk hydration has silently disabled ALL semantic retrieval in production; everything falls back to flat-scored keyword matching, and degradation is invisible. Full diagnosis and the three-phase roadmap are in `docs/superpowers/plans/2026-06-10-context-os-remediation-overview.md`. Durable facts are saved in Context OS under project `memory-system-mcp`.

Your job: execute `docs/superpowers/plans/2026-06-10-context-os-phase-1-restore-correctness.md` task by task, exactly as written, using the superpowers:executing-plans skill (or subagent-driven-development).

Hard constraints:
1. Work on a branch `fix/d1-bind-batching`. The working tree on main has pre-existing uncommitted changes (src/domain/service.ts, src/domain/session.ts, src/service/PlanningService.ts, tests/integration/assistant-session-planning.test.ts) from unrelated vault-sync work. Do not revert, reformat, or commit those hunks; stage only what the plan touches (use `git add -p` for PlanningService.ts).
2. Do NOT start Phase 2 or 3 work (situation documents, supersede-on-write, ranking rewrite), even though the overview describes them. Phase 1 only.
3. Task 4 touches production (deploy, deleting failed job rows, full reindex). Ask me before the deploy, before the DELETE, and before triggering admin_reindex_all.
4. Verify with `npm run typecheck && npm test` before deploy, and verify live with `mcp__context-os__retrieval_diagnostics(query: "current deals underway Light Lane pipeline", project: "light-lane")` after deploy: success means no vector_error and ranked_vector_hits > 0.
5. When done, save the post-fix retrieval_diagnostics output as the post-P1 baseline via finish_work_session (project memory-system-mcp), and update the open Context OS tasks for Phase 1 to done.

Line numbers in the plan were verified on 10 June 2026; if they have drifted, match by the quoted code snippets.

---
