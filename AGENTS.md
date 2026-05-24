# AI Memory Operating Protocol

Use the connected MCP server named `context-os-memory` as the durable context system and source of truth for project memory. If this environment exposes the same server under the legacy namespace `memory`, use that namespace but treat it as Context OS Memory.

Do not rely on Codex, ChatGPT, Claude, or app-level built-in memory as the source of truth for project facts. Durable facts, decisions, setup details, repo context, snippets, entities, entity states, tasks, reminders, source events, and session summaries must be read from and written to Context OS Memory.

Important MCP availability check:

- This memory server exposes MCP tools, not MCP resources or resource templates.
- Empty `list_mcp_resources` or `list_mcp_resource_templates` results do not mean the memory server is unavailable.
- Check for tools such as `memory.prepare_assistant_session`, `memory.resolve_context`, `memory.search_memory`, `memory.finish_work_session`, and `memory.daily_briefing`.
- For Light Lane vault repair and ongoing governance, also check for `memory.analyze_light_lane_memory_recovery` and `memory.run_light_lane_memory_recovery`.
- If the host UI does not show namespaced `memory.*` tools, inspect/list MCP tools rather than resources, or call `prepare_assistant_session` directly if tool calling is available.
- Codex fallback: if `memory.*` tools are not exposed as callable tools, use the global local command `~/.codex/bin/memory-mcp`. It reads `~/.codex/config.toml` and calls the same deployed MCP server over Streamable HTTP.
  - List tools: `~/.codex/bin/memory-mcp list-tools`
  - Prepare assistant session: `~/.codex/bin/memory-mcp prepare_assistant_session '{"project_or_topic":"PROJECT_OR_TOPIC","user_intent":"TASK TOPIC"}'`
  - Resolve context: `~/.codex/bin/memory-mcp resolve_context '{"project_or_topic":"PROJECT_OR_TOPIC","user_intent":"TASK TOPIC"}'`
  - Search memory: `~/.codex/bin/memory-mcp search_memory '{"project":"PROJECT_SLUG","query":"SEARCH QUERY","scope":"project"}'`
  - Finish work: `~/.codex/bin/memory-mcp finish_work_session '{"project":"PROJECT_SLUG","title":"TITLE","summary_markdown":"SUMMARY"}'`
- Preferred local fallback auth is `bearer_token_file = "~/.codex/secrets/context_os_memory_token"` under `[mcp_servers.context_os_memory]`. Keep the token file chmod `600`; never commit bearer tokens or paste them into session summaries.
- If the fallback command cannot find a Context OS Memory MCP URL and bearer token in `~/.codex/config.toml`, treat that as a local client configuration fault. Report it, verify the deployed Worker is still healthy if possible, and configure the local MCP client rather than assuming durable memory is unavailable.

Before substantive work:

1. Identify the likely active project or topic from the repo, user request, current directory, explicit project name, or business context.
2. Call `memory.prepare_assistant_session` with `project_or_topic`, `user_intent`, and `active_sources` if relevant.
3. Read the returned session plan before making assumptions:
   - `context_resolution`: active project, candidates, related projects, and project-switching reason.
   - `initiative_context`: larger goals this work may belong to.
   - `current_context`: canonical WorkDrive-backed project context.
   - `grouped_memory`: retrieved memory grouped by type.
   - `entities`, `facts`, `tasks`, `source_events`: structured context that may affect decisions.
   - `context_health.warnings`: stale, thin, ambiguous, or keyword-only retrieval warnings.
   - `recommended_live_mcp_checks`: live MCPs to check before deciding.
   - `write_back_policy`: what may be saved durably and what must remain live-only.
4. If context is ambiguous, call `memory.resolve_context`.
5. If more recall is needed, call `memory.search_memory` using an intentional `scope`: `project`, `initiative`, `entity`, or `all_related`.
6. If canonical context is missing or thin, call `memory.bootstrap_project_context`.
7. If memory seems stale or keyword-only, call `memory.context_health_check` and `memory.retrieval_diagnostics`.
8. If repo facts are missing or stale, use:
   - `memory.github_project_repos`
   - `memory.github_search_code`
   - `memory.github_get_file`
9. When a GitHub file or code excerpt becomes useful durable context, call `memory.github_save_file_memory` or `memory.save_snippet`.
10. For Light Lane proposals, sales work, opportunity prioritization, or company positioning, call `memory.search_memory`, `memory.prepare_assistant_session`, or `memory.plan_request` with `task_profile: "sales_proposal"` when the tool supports it.

During work:

- Treat WorkDrive-backed memory as canonical project context.
- Durable markdown writes must go to the WorkDrive/Obsidian vault first through Context OS Memory tools, then be indexed into D1 and Vectorize. Do not create D1-only or vector-only durable facts/documents as a substitute for canonical markdown unless the tool is explicitly structured-only, such as entity states, tasks, source events, or facts.
- Historical session summaries and historical notes are retrievable background memory. They are lower priority than current context/entity state/live tools, but they must not be archived or hidden from search merely because they are historical.
- Treat live external MCPs as the source of truth for volatile CRM/email/calendar/notes/GitHub/Shopify state.
- Prefer project-scoped memory over shared memory when a project is clear.
- Use shared memory only for cross-project conventions, account setup, broad operating rules, and reusable preferences.
- Do not mix projects. If the user switches projects, call `prepare_assistant_session` again for the new project or topic.
- Use `memory.upsert_initiative`, `memory.upsert_task`, `memory.save_source_event`, `memory.extract_durable_facts`, and `memory.link_memory` for structured durable context.
- Use `memory.record_decision` for durable architecture, deployment, product, operations, or workflow decisions.
- Use `memory.update_context_document` only for intentional updates to canonical current-context documents.
- Do not store raw private emails, full calendar details, private documents, large raw diffs, secrets, or sensitive personal data unless the user explicitly asks and the connector policy allows it.

Light Lane memory structure rules:

- The canonical Light Lane project is `light-lane`. Do not write Light Lane business, sales, product, customer, deal, or repo context into `shared` unless it is genuinely reusable across unrelated projects.
- Light Lane current-context documents belong under `/memory/projects/light-lane/context/current/`. The required coverage is identity, offer map, full-system positioning, sales rules, objections, technical guardrails, source trust, repo map, and current sales state.
- Do not create one-off deal markdown as current context. Current deal/account/person status must be stored as structured entity state via `memory.upsert_entity_state`, with source, confidence, observed time, and live-verification warnings when appropriate.
- Old sessions, old deal notes, archived shared docs, and semantic chunks are background only. They must not be treated as current deal truth unless confirmed by live tools or fresh structured entity states/source events.
- If Light Lane docs are found under `/memory/shared/context/current/`, or if `context_health_check` warns `missing_business_brain`, `required_context_sections_missing`, or `repo_coverage_incomplete`, run `memory.analyze_light_lane_memory_recovery` first. Use `memory.run_light_lane_memory_recovery` only after the dry-run manifest is understood and apply is intended.
- The approved AI Brain vault import path is the Light Lane Sales Academy AI Brain vault. Import through `memory.import_ai_brain_vault` or `memory.run_light_lane_memory_recovery`; preserve wiki-links and write structured `memory_links`.
- The required Light Lane repos are `Light-Lane/LightLane-Site-V2`, `Light-Lane/Light-Lane-Ruida`, `Light-Lane/Light-Lane-Portal`, `Light-Lane/LightLane-App`, `Light-Lane/Light-Lane-Ruida-CLI`, `Light-Lane/LightLane-Internal-CRM`, `Light-Lane/LightLane-Website`, and `Light-Lane/LightLane-Public-Facing-Website`. If `memory.github_project_repos` does not show all eight, associate/index the missing repos before making repo-coverage claims.
- For proposals, the assistant must load the Light Lane business brain before drafting: entrypoint/identity, full-system positioning, sales rules, objections, technical guardrails, source trust, relevant use cases, current deal/account entity state, and repo context when product details matter.
- If Zoho CRM/email/calendar tools are unavailable, say so clearly and avoid presenting stale deal notes as current. Use entity state and recent source events as the fallback current layer, and mark anything unverified.

Production delivery protocol:

- Treat work on the primary branch (`main`) as unfinished until it is committed to git with a clear, specific commit message, pushed to GitHub, deployed to production, and smoke-checked against the live Worker.
- When Cloudflare Workers Git integration is enabled for `main`, pushing to GitHub is the production deployment trigger. After pushing, agents must monitor the Cloudflare build/deployment result when tooling is available and verify the live MCP endpoint before final handoff.
- If Cloudflare Git integration is not available or the build did not run, deploy directly with Wrangler after verification: run typecheck/tests, apply all pending D1 migrations with `npx wrangler d1 migrations apply DB --remote`, then run `npm run deploy`.
- If any migration files changed or new migrations exist, agents must list pending migrations and apply them to the correct remote D1 database before or as part of the production deployment. Do not leave schema changes only local.
- If runtime bindings, environment variables, secrets, OAuth redirect URLs, queues, cron triggers, Vectorize indexes, KV namespaces, D1 databases, WorkDrive/Zoho credentials, GitHub credentials, or MCP client URLs change, agents must update the production Cloudflare configuration or clearly report exactly what secret/value still needs the user to provide.
- For secondary branches, do not promote to production unless explicitly requested. Push the branch to GitHub, keep migrations deployable, and create or update the PR with clear notes about any migrations, secrets, bindings, or deployment steps needed before merge.
- Use proper commit messages: imperative mood, scoped when useful, and specific about the behavior changed, for example `Improve Light Lane proposal retrieval policy` or `Add D1 migration for memory links`.
- Do not stop at "local tests pass" for production-intended work. The final response must state the commit pushed, migrations applied or not needed, deployment status, live smoke-check result, and any remaining production risk.

At the end of meaningful work:

- Call `memory.finish_work_session` with what changed, what was verified, and what remains.
- Include commands run, tests/deployments verified, decisions made, tasks/reminders/source events/facts saved, and unresolved risks.
- Keep summaries factual and concise.
- Call `memory.record_decision` for durable architectural, setup, product, deployment, operations, workflow, or source-of-truth decisions.

Light Lane rule:

- For Light Lane topics only, use the Zoho live business MCP frequently for up-to-date business context such as calendar, email, notes, and WorkDrive.
- For non-Light-Lane projects, do not use Zoho business data unless the user explicitly asks.
- Do not transmit or summarize sensitive emails, calendar details, or private documents into memory unless the user clearly asks for that information to be recorded and connector policy allows it.

Useful default project slugs:

- `memory-system-mcp` for this repository.
- `light-lane` for Light Lane product, customer, sales, operations, and company context.

If unsure which project is active, ask a short clarification before writing memory.

If the `memory` MCP is unavailable, say so clearly and continue only from visible conversation/files. Do not use built-in memory as a substitute durable store.
