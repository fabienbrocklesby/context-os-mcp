# AI Memory Operating Protocol

Use the `memory` MCP server as the durable context system and source of truth for project memory.

Do not rely on Codex, ChatGPT, Claude, or app-level built-in memory as the source of truth for project facts. Durable facts, decisions, setup details, repo context, snippets, entities, tasks, reminders, source events, and session summaries must be read from and written to the `memory` MCP.

Important MCP availability check:

- This memory server exposes MCP tools, not MCP resources or resource templates.
- Empty `list_mcp_resources` or `list_mcp_resource_templates` results do not mean the memory server is unavailable.
- Check for tools such as `memory.prepare_assistant_session`, `memory.resolve_context`, `memory.search_memory`, `memory.finish_work_session`, and `memory.daily_briefing`.
- If the host UI does not show namespaced `memory.*` tools, inspect/list MCP tools rather than resources, or call `prepare_assistant_session` directly if tool calling is available.
- Codex fallback: if `memory.*` tools are not exposed as callable tools, use the global local command `~/.codex/bin/memory-mcp`. It reads `~/.codex/config.toml` and calls the same deployed MCP server over Streamable HTTP.
  - List tools: `~/.codex/bin/memory-mcp list-tools`
  - Prepare assistant session: `~/.codex/bin/memory-mcp prepare_assistant_session '{"project_or_topic":"PROJECT_OR_TOPIC","user_intent":"TASK TOPIC"}'`
  - Resolve context: `~/.codex/bin/memory-mcp resolve_context '{"project_or_topic":"PROJECT_OR_TOPIC","user_intent":"TASK TOPIC"}'`
  - Search memory: `~/.codex/bin/memory-mcp search_memory '{"project":"PROJECT_SLUG","query":"SEARCH QUERY","scope":"project"}'`
  - Finish work: `~/.codex/bin/memory-mcp finish_work_session '{"project":"PROJECT_SLUG","title":"TITLE","summary_markdown":"SUMMARY"}'`

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

During work:

- Treat WorkDrive-backed memory as canonical project context.
- Treat live external MCPs as the source of truth for volatile CRM/email/calendar/notes/GitHub/Shopify state.
- Prefer project-scoped memory over shared memory when a project is clear.
- Use shared memory only for cross-project conventions, account setup, broad operating rules, and reusable preferences.
- Do not mix projects. If the user switches projects, call `prepare_assistant_session` again for the new project or topic.
- Use `memory.upsert_initiative`, `memory.upsert_task`, `memory.save_source_event`, `memory.extract_durable_facts`, and `memory.link_memory` for structured durable context.
- Use `memory.record_decision` for durable architecture, deployment, product, operations, or workflow decisions.
- Use `memory.update_context_document` only for intentional updates to canonical current-context documents.
- Do not store raw private emails, full calendar details, private documents, large raw diffs, secrets, or sensitive personal data unless the user explicitly asks and the connector policy allows it.

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
