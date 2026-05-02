# Context OS MCP

Remote MCP server that gives AI assistants a real operating layer for memory: project context, initiatives, entities, durable facts, tasks, source events, decisions, snippets, repo knowledge, and session closeout.

Instead of handing a model a pile of old notes and hoping it remembers the right thing, Context OS MCP starts each session with a server-generated context plan. It resolves the active project, pulls in linked initiatives, groups retrieved memory by type, warns when context is stale or keyword-only, recommends live MCP checks, and tells the assistant what can safely be written back.

## Why This Exists

Most AI memory setups stop at "store notes and search them later." That helps, but it still leaves the model guessing:

- Which project is active?
- Is this task part of a bigger initiative?
- Which customer, repo, deal, product, or supplier does it affect?
- Is the memory stale, missing, or only matching keywords?
- Should the assistant check CRM, email, calendar, GitHub, Shopify, or notes live before deciding?
- What should be saved durably versus kept live-only?

Context OS MCP is built to answer those questions before the assistant starts working.

## What It Does

- Stores canonical human-readable memory as Markdown in Zoho WorkDrive.
- Stores structured metadata and relationships in Cloudflare D1.
- Indexes memory chunks in Cloudflare Vectorize using Workers AI embeddings.
- Exposes a remote MCP server on Cloudflare Workers.
- Supports OAuth-backed GitHub repo inspection and durable repo memory.
- Adds a Context OS layer for initiatives, projects, entities, durable facts, tasks/reminders, source events, and links.

## Core Flow

AI clients should start meaningful work with:

```text
memory.prepare_assistant_session(project_or_topic, user_intent, active_sources?)
```

The response includes:

- active project and possible related projects
- validated date, weekday, timezone, business-day, and actionability context
- deterministic request classification and tool-use plan
- linked initiative context
- canonical current context
- grouped memory results
- entities, facts, tasks, and source events
- stale or missing context warnings
- recommended live MCP checks
- write-back policy for durable memory

Older clients can still use `prepare_work_session`, which now delegates to the richer planner internally.

## Project Scope

Memory is separated by project slug. Project-scoped retrieval searches that project plus the reserved `shared` namespace for cross-project conventions and reusable context. It never depends on hard-coded customer, company, or personal names to decide what is visible.

## Tool Highlights

- `prepare_assistant_session`
- `get_operational_context`
- `plan_assistant_action`
- `resolve_context`
- `search_memory`
- `list_initiatives`
- `get_initiative_context`
- `upsert_initiative`
- `upsert_task`
- `save_source_event`
- `extract_durable_facts`
- `link_memory`
- `daily_briefing`
- `context_health_check`
- `finish_work_session`
- `github_project_repos`
- `github_search_code`
- `github_get_file`
- `github_save_file_memory`

## Architecture

```text
AI Client
  -> Remote MCP Server on Cloudflare Workers
    -> Zoho WorkDrive for canonical Markdown memory
    -> Cloudflare D1 for structured metadata and relationships
    -> Cloudflare Vectorize for semantic retrieval
    -> Workers AI for embeddings
    -> Cloudflare Queues + Cron for reindex/reconciliation
    -> GitHub OAuth tools for live repo context
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/DEPLOYMENT_AND_OPERATIONS.md](docs/DEPLOYMENT_AND_OPERATIONS.md) for the deeper version.

## Quickstart

```bash
npm install
npm run typecheck
npm test
```

For a new deployment:

```bash
cp wrangler.example.jsonc wrangler.jsonc
cp .env.example .dev.vars
```

Then fill in Cloudflare resource IDs, Zoho credentials, GitHub OAuth credentials, and Worker secrets.

## Current Status

- Production deployment tested on Cloudflare Workers.
- Additive D1 migrations preserve existing memory data.
- Context OS v1 tools are deployed and smoke-tested.
- Automated tests and TypeScript checks pass locally.
- Known follow-up: semantic Vectorize retrieval can still fall back to keyword-only on broad conceptual queries; diagnostics now expose that clearly so it can be fixed instead of hidden.
