# Context OS MCP

Remote MCP server that gives AI assistants a real operating layer for memory: project context, strategic goals, initiatives, assets, milestones, entities, durable facts, tasks, source events, decisions, snippets, repo knowledge, and session closeout.

Instead of handing a model a pile of old notes and hoping it remembers the right thing, Context OS MCP starts each session with a server-generated operating brief. It resolves the active project, pulls in linked initiatives, groups retrieved memory by type, warns when context is stale or keyword-only, recommends live MCP checks, and tells the assistant what can safely be written back.

## Why This Exists

Most AI memory setups stop at "store notes and search them later." That helps, but it still leaves the model guessing:

- Which project is active?
- Is this task part of a bigger vision, pillar, initiative, or milestone?
- Is this work strategically aligned, a useful experiment, a distraction risk, or a conflict?
- Which assets or resources should the assistant use?
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
- Adds a Context OS layer for visions, pillars, outcomes, initiatives, projects, milestones, assets, branch projects, entities, durable facts, tasks/reminders, source events, and links.
- Plans environment-aware tool use so Claude, ChatGPT, Codex, generic MCP clients, and local CLI clients can use the tools available in their own host environment.

## Core Flow

AI clients should start meaningful work with:

```text
memory.prepare_assistant_session(project_or_topic, user_intent, environment?, active_sources?, available_tools?)
```

This remains backward-compatible and now includes a normalized `operating_brief` with:

- active project and possible related projects
- validated date, weekday, timezone, business-day, and actionability context
- deterministic request classification and tool-use plan
- linked initiative context
- compact strategic context, including visions, pillars, outcomes, milestones, assets, and branch-project warnings
- canonical current context
- grouped memory results
- entities, facts, tasks, and source events
- stale or missing context warnings
- required live checks, including unavailable-tool warnings
- environment-specific tool guidance for the current AI client
- safe next actions and confirmation guardrails
- write-back plan for durable memory

For "How do I achieve X?", "What should I do next?", weekly/day planning, repo work, prioritization, and strategy decisions, use:

```text
memory.plan_request(project_or_topic, user_intent, environment?, active_sources?, available_tools?)
```

`plan_request` returns the same operating brief plus a request-specific plan with the objective, tool sequence, recommended scope, next actions, and write-back plan.

Clients can also call:

```text
memory.plan_environment_tool_use(environment?, user_intent, project_or_topic?, available_tools?, active_sources?)
```

ContextOS does not try to own every connector directly. It resolves the project/topic, identifies the current AI environment, compares required capabilities with available host tools, then returns precise instructions for what the client should check itself, what ContextOS can check directly, what requires confirmation, and what should be written back durably.

Example public-safe shape:

```json
{
  "operating_brief": {
    "context_resolution": {
      "active_project": { "slug": "example-project" }
    },
    "time_actionability": {
      "local_date": "2026-05-02",
      "weekday": "Saturday",
      "timezone": "Pacific/Auckland",
      "actionability_label": "prep_or_async_only"
    },
    "required_live_checks": [
      {
        "tool": "github_project_repos",
        "source_kind": "github",
        "required": true,
        "available": false,
        "blocking": true,
        "fallback": "Do not make live repo claims; proceed only from visible/local files and say GitHub was unavailable."
      }
    ],
    "source_freshness": {
      "retrieval_mode": "keyword_fallback_only",
      "warnings": ["Retrieval is keyword-only for this request; semantic recall did not produce results."]
    },
    "write_back_plan": {
      "recommendations": [
        { "tool": "finish_work_session", "when": "After meaningful work." }
      ]
    },
    "environment_tool_guidance": {
      "environment": { "slug": "codex" },
      "client_must_execute": ["cloudflare_live"],
      "contextos_can_execute": ["contextos_memory", "github_live"],
      "unavailable_required_capabilities": []
    }
  }
}
```

Older clients can still use `prepare_work_session`, which now delegates to the richer planner internally.

## Project Scope

Memory is separated by project slug. Project-scoped retrieval searches that project plus the reserved `shared` namespace for cross-project conventions and reusable context. It never depends on hard-coded customer, company, or personal names to decide what is visible.

## Tool Highlights

- `prepare_assistant_session`
- `get_operational_context`
- `plan_assistant_action`
- `plan_environment_tool_use`
- `list_client_environments`
- `list_tool_capabilities`
- `list_environment_capabilities`
- `resolve_context`
- `search_memory`
- `list_initiatives`
- `get_initiative_context`
- `upsert_initiative`
- `upsert_vision`
- `list_visions`
- `get_strategy_context`
- `upsert_asset`
- `list_assets`
- `link_asset`
- `upsert_milestone`
- `create_branch_project`
- `check_alignment`
- `plan_request`
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
- `analyze_memory_migration`
- `run_memory_migration`
- `get_migration_audit`
- `retrieval_diagnostics`

## Strategic World Model

Phase 2 adds first-class strategic planning primitives without hard-coding anyone's private strategy into the public repo.

- Visions, north stars, strategic pillars, and outcomes live as project-scoped strategy nodes in D1.
- Assets/resources store safe pointers and usage guidance, not raw private payloads or secrets.
- Milestones are strategic checkpoints above executable tasks.
- Branch projects/experiments require a parent initiative, reason, hypothesis, timebox, success metric, parent risk, merge-back condition, kill condition, and risk level.
- Alignment planning classifies work as `directly_advances`, `indirectly_supports`, `neutral_experiment`, `distraction_risk`, `conflicts`, or `unknown_until_more_context`.

Fixtures and examples must stay generic. Real customer data, secrets, private WorkDrive IDs, emails, and personal strategy belong in memory data or live connectors, not in source code.

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

See [docs/ASSISTANT_CONTEXT_OS.md](docs/ASSISTANT_CONTEXT_OS.md), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), and [docs/DEPLOYMENT_AND_OPERATIONS.md](docs/DEPLOYMENT_AND_OPERATIONS.md) for the deeper version.

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
- Vectorize diagnostics expose provider metadata mode, filters, namespace behavior, raw/rejected hit counts, unfiltered fallback behavior, and D1 chunk counts for broad-query regression checks.
