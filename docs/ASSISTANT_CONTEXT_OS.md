# Assistant Context OS Behavior

Assistant Context OS is the orchestration layer on top of durable memory. It helps AI clients answer four questions before they respond or act:

- What world, project, initiative, and strategy am I in?
- What live sources must I check before making claims?
- Which client environment am I in, and which tools can this client actually use?
- What can I safely do now, and what should be deferred or confirmed?
- What should be written back after the work?

## Standard Client Flow

1. Start meaningful work with `prepare_assistant_session`, including `environment`, `available_tools`, and `active_sources` when the client knows them.
2. For planning, prioritization, repo work, day/week plans, or "what should I do next?" requests, call `plan_request`.
3. Follow `operating_brief.environment_tool_guidance` and `operating_brief.required_live_checks`.
4. Answer or act only after required checks are complete, explicitly unavailable, or user-approved to skip.
5. Close meaningful work with `finish_work_session` and structured writes when useful.

## Operating Brief Fields

Every modern client should read `operating_brief`:

- `context_resolution`: active project, candidates, related projects, branch-project state, and ambiguity warnings.
- `time_actionability`: date, weekday, timezone, weekend/business-day status, safe actions, deferrals, and guardrails.
- `strategic_alignment`: active goals, initiatives, milestones, branch constraints, and alignment assessment.
- `relevant_assets`: reusable assets/resources and whether they need live-source checks.
- `current_tasks_milestones`: open, due, blocked, high-priority, and overdue work.
- `source_freshness`: stale, missing, keyword-only, vector, project-health, and repo-index signals.
- `required_live_checks`: concrete tool names, source kinds, availability, blocking status, and fallback behavior.
- `risks`: strategy, missing-tool, privacy, stale-context, actionability, and confirmation risks.
- `recommended_next_actions`: before-answer, before-action, before-write, safe-now, defer-until, and confirmation-needed steps.
- `environment_tool_guidance`: resolved client environment, available/unavailable capabilities, client-vs-ContextOS checks, confirmation gates, fallback plan, and write-back policy.
- `write_back_plan`: recommended durable memory writes and forbidden raw/private content.

## Environment-Aware Tool Use

ContextOS is a control plane, not a hard-coded adapter bus for every live system.

- `plan_environment_tool_use` accepts `environment`, `user_intent`, `project_or_topic`, `available_tools`, `active_sources`, and optional `proposed_action`.
- It returns which checks ContextOS can execute directly, which checks the AI client must execute with its own tools, what requires confirmation, what is unavailable, and how to write back safely.
- `prepare_assistant_session` and `plan_request` embed the same guidance in `environment_tool_guidance`.
- If a host lacks GitHub, CRM, email, calendar, Shopify, Cloudflare, terminal, or other live tools, the assistant must say what was not checked and reduce confidence.

## Project-Specific Live State

Some business projects may opt into a limited read-only live-state loop. ContextOS may plan read-through checks and maintain safe structured current state from a separate read-only external MCP connection when that connection is configured by the client.

- Use the project-specific live-state planner for deal, account, customer, email, calendar, proposal, or current-state questions when `current_truth` is missing or stale.
- Store only structured `entity_state`, `source_event`, `task`, `fact`, and `decision` records from safe summaries.
- Do not store raw CRM payloads, full email bodies, attachments, full attendee lists, private notes, credentials, or broad dumps of external data.
- Do not use business connectors for projects that have not opted in unless the user explicitly asks.
- Do not mutate external systems from ContextOS. For updates, sends, deletes, or calendar edits, use the external-write planner; the assistant must use a separate write-capable MCP after explicit confirmation and then write back only a concise durable summary.

## Fake Example

```json
{
  "project_or_topic": "example-project",
  "user_intent": "What should I do next in owner/example-repo this week?",
  "environment": "codex",
  "available_tools": ["Context OS Memory", "terminal", "calendar"]
}
```

The response may include:

```json
{
  "operating_brief": {
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
        "timing": "before_answer",
        "required": true,
        "available": false,
        "blocking": true,
        "fallback": "Do not make live repo claims; proceed only from visible/local files and say GitHub was unavailable."
      },
      {
        "tool": "calendar",
        "source_kind": "calendar",
        "timing": "before_answer",
        "required": true,
        "available": true,
        "blocking": false,
        "fallback": "Make only tentative scheduling recommendations and say calendar availability was not checked."
      }
    ],
    "source_freshness": {
      "retrieval_mode": "keyword_fallback_only",
      "warnings": [
        "Retrieval is keyword-only for this request; semantic recall did not produce results."
      ]
    },
    "write_back_plan": {
      "recommendations": [
        {
          "tool": "finish_work_session",
          "when": "After meaningful work.",
          "save_policy": "durable_summary"
        }
      ],
      "forbidden_content": [
        "secrets or credentials",
        "raw private email bodies",
        "large raw diffs"
      ]
    },
    "environment_tool_guidance": {
      "environment": { "slug": "codex" },
      "client_must_execute": ["github_live"],
      "contextos_can_execute": ["contextos_memory"],
      "unavailable_required_capabilities": [
        {
          "capability": "github_live",
          "fallback": "Ask the client/user to check github, or proceed with a clear unverified-source warning."
        }
      ]
    }
  }
}
```

## Client Instructions

### Claude

- Call `prepare_assistant_session` before substantive work.
- Call `plan_request` for planning and next-step questions.
- Follow `operating_brief.required_live_checks` before current-state claims.
- Call `finish_work_session` after meaningful work.

### ChatGPT

- Treat ChatGPT built-in memory as non-authoritative for project facts.
- Use the connected memory app for durable project context.
- Use `plan_request` for planning, prioritization, repo work, and scheduling.
- Warn clearly when memory, GitHub, calendar, CRM, email, or commerce tools are unavailable.

### Codex

- Use local repo inspection when available, while still following the memory operating brief.
- For public repo work, verify typecheck, tests, secret/private-data scans, and docs status before closeout.
- Do not overwrite unrelated dirty worktree changes.
- Close meaningful sessions with `finish_work_session`.

### Universal MCP Clients

- Start with `prepare_assistant_session`.
- Use `plan_request` for "How do I achieve X?" and "What should I do next?"
- Perform required live checks before answering or acting.
- If a required tool is unavailable, say which tool is unavailable and downgrade to visible context.
- Use `finish_work_session` and structured write tools for durable summaries, decisions, tasks, facts, source events, snippets, and links.

## Public Data Safety

Examples in this repository must stay generic. Use fake projects such as `example-project`, fake repos such as `owner/example-repo`, fake account names such as `Acme Demo`, and fake source URLs such as `https://example.com/doc/123`.

Do not add real customer data, private WorkDrive IDs, tenant IDs, emails, calendar payloads, CRM payloads, secrets, access tokens, private strategy, or raw private documents to public docs, tests, or fixtures.
