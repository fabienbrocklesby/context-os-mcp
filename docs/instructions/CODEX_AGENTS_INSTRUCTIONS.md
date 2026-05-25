# Codex AGENTS.md Instructions: Context OS Memory

Paste this into a repo-level `AGENTS.md`, or into Codex global/custom instructions where supported.

```markdown
# AI Memory Operating Protocol

Use the connected MCP server named `context-os-memory` as the durable context system and source of truth for project memory. If this environment still exposes the same server under the legacy namespace `memory`, use that namespace but treat it as Context OS Memory.

Do not rely on Codex, ChatGPT, Claude, or app-level built-in memory as the source of truth for project facts. Durable facts, decisions, setup details, repo context, snippets, entities, entity states, tasks, reminders, source events, and session summaries must be read from and written to Context OS Memory.

## Availability Check

This server exposes MCP tools, not MCP resources or resource templates. Empty resource/resource-template results do not mean the server is unavailable.

Check for tools such as:

- `prepare_assistant_session`
- `resolve_context`
- `resolve_current_truth`
- `search_memory`
- `plan_request`
- `finish_work_session`
- `daily_briefing`

In Codex, if namespaced MCP tools are not exposed, use the local fallback command:

```bash
~/.codex/bin/memory-mcp list-tools
~/.codex/bin/memory-mcp prepare_assistant_session '{"project_or_topic":"PROJECT_OR_TOPIC","user_intent":"TASK TOPIC","environment":"codex"}'
~/.codex/bin/memory-mcp search_memory '{"project":"PROJECT_SLUG","query":"SEARCH QUERY","scope":"project"}'
~/.codex/bin/memory-mcp finish_work_session '{"project":"PROJECT_SLUG","title":"TITLE","summary_markdown":"SUMMARY"}'
```

## Before Substantive Work

1. Identify the likely active project or topic from the repo, request, current directory, explicit project name, or business context.
2. Call `prepare_assistant_session` with `project_or_topic`, `user_intent`, `environment: "codex"`, `available_tools`, and `active_sources` when relevant.
3. Read and follow:
   - `context_resolution`
   - `operational_context`
   - `request_classification`
   - `actionability`
   - `tool_plan`
   - `current_truth`
   - `initiative_context`
   - `current_context`
   - `grouped_memory`
   - `entities`, `facts`, `tasks`, and `source_events`
   - `context_health.warnings`
   - `recommended_live_mcp_checks`
   - `write_back_policy`
   - `environment_tool_guidance`
   - `operating_brief`
4. If context is ambiguous, call `resolve_context`.
5. For planning, prioritization, repo work, sales priorities, or day/week plans, call `plan_request`.
6. For tool-sensitive work, call `plan_environment_tool_use` or follow `environment_tool_guidance`. Codex must execute checks marked `client_must_execute` using terminal/GitHub/Cloudflare/plugins that are actually available.
7. If more recall is needed, call `search_memory` with scope `project`, `initiative`, `entity`, or `all_related`.
8. If memory seems stale or keyword-only, call `context_health_check` and `retrieval_diagnostics`.
9. If current state matters, call `resolve_current_truth` or rely on `current_truth` from `prepare_assistant_session`.

## Current Truth Rules

For volatile state, do not use old semantic chunks as current truth. This includes active people, deal status, budget, blockers, email replies, live customer priority, calendar availability, deployment state, current repo state, and prices.

Follow this order:

1. Live tools/connectors when required by `recommended_live_mcp_checks`.
2. Structured `current_truth`, entity states, active tasks, durable facts, and recent source events.
3. Current context documents and active decisions.
4. Semantic memory chunks as background only.

If `current_truth.warnings` says active state is missing, say so and ask for or perform the required live check. For Light Lane current-state work, call `plan_light_lane_live_state_refresh` when available and use read-only Zoho live checks before recommendations. Do not recommend old stale deals, old staff, or old blockers as if they are current.

## Time And Planning

Before daily/weekly/scheduling/outreach plans, validate local date, weekday, timezone, weekend/business-day status, and actionability from `operational_context`. Do not recommend synchronous business-hour work on weekends unless the user explicitly justifies it; prefer prep, admin, review, drafting, and asynchronous work.

## During Work

- Prefer project-scoped memory over shared memory.
- Use shared memory only for cross-project conventions, account setup, broad operating rules, and reusable preferences.
- Do not mix projects. If the project changes, call `prepare_assistant_session` again.
- Follow `operating_brief.required_live_checks` and `tool_plan.required_tools` before making claims about current external state.
- Use local repo inspection when available, but still follow Context OS Memory.
- For public repo work, verify typecheck, tests, secret/private-data scans, and docs status before closeout.
- Get explicit confirmation before destructive or external write actions.
- Do not store raw private emails, full calendar details, private documents, large raw diffs, secrets, tokens, credentials, or sensitive personal data unless the user explicitly asks and connector policy allows it.
- Context OS Memory may maintain safe structured Light Lane state from read-only Zoho checks: entity states, source events, tasks, facts, observed timestamps, confidence, and source pointers. It must not mutate Zoho. For CRM updates, sending/replying to email, marking mail, or calendar edits, call `plan_zoho_external_write` when available and delegate to a separate write-capable Zoho MCP after explicit confirmation.

Use structured writes when appropriate:

- `upsert_entity_state` for current people/deals/accounts/statuses.
- `upsert_initiative` for larger workstreams.
- `upsert_task` for tasks, reminders, or follow-ups.
- `save_source_event` for durable summaries of important external/source changes.
- `extract_durable_facts` for user-approved durable facts.
- `record_decision` for architecture, deployment, product, operations, or workflow decisions.
- `save_snippet` for small reusable excerpts.
- `link_memory` to connect related items.

## End Of Meaningful Work

Call `finish_work_session` with what changed, what was verified, commands run, deployments/tests checked, decisions made, saved durable context, remaining work, and unresolved risks.

If Context OS Memory is unavailable, say so clearly and continue only from visible conversation/files.

## Light Lane Rule

For Light Lane topics, use live business tools frequently for up-to-date business context such as CRM, email, calendar, notes, and WorkDrive when available. Prefer a separate `LightLane-ReadOnly Zoho MCP` for ContextOS live-state checks. For non-Light-Lane projects, do not use Zoho business data unless the user explicitly asks or the project explicitly opts in.
```
