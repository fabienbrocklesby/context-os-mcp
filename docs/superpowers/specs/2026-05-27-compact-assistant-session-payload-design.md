# Compact Assistant Session Payload Design

## Problem

`prepare_assistant_session` is the mandatory first Context OS call for AI clients, but the production response can exhaust the client's context window before useful work begins. A Light Lane Nelson sales-meeting preparation request produced a response of about 932 KB. The largest source was `current_context`, which loaded 68 active context and decision documents with full Markdown snapshots and returned the same objects in both `items` and `grouped`.

This is a response-contract defect. The first call is intended to orient the assistant, resolve current truth, and direct any necessary retrieval or live checks. It should not export the project's complete document library by default.

## Goal

Make `prepare_assistant_session` compact and safe for AI client context windows by default while preserving full-quality access to canonical context when relevant to the user's task.

## Non-Goals

- Do not remove full document retrieval from Context OS.
- Do not weaken current-truth or live-source guardrails.
- Do not introduce a new memory store or alter retrieval ranking semantics.
- Do not migrate D1 data or rewrite existing WorkDrive content.

## Response Contract

`prepare_assistant_session` accepts an optional `response_mode`:

- `compact` is the default for AI client session setup.
- `expanded` explicitly requests the existing deep/full-material shape for diagnostic or compatibility use.

Compact mode returns:

- Compact active-project and context-resolution summaries.
- Operational context, request classification, actionability, tool plan, live-check guidance, write-back policy, and current truth.
- A `current_context` manifest with document identifiers, titles, paths, memory types, statuses, revisions, and tags. It contains no full Markdown snapshot bodies.
- Intent-ranked memory excerpts once, without a second duplicate grouped copy or raw provider diagnostics.
- Concise task, fact, and source-event summaries sufficient to decide whether deeper retrieval is required.
- A payload budget report and explicit retrieval instructions for deeper context.

Expanded mode preserves full `current_context` hydration and existing detailed result structures when deliberately requested.

## Payload Budget

Compact session setup must fit within a 64 KB serialized JSON budget for the Nelson-shaped regression scenario. The compact representation is formed at the source rather than building and discarding a massive response:

1. List current-context documents as metadata only instead of loading snapshots.
2. Summarize repeated project, task, fact, source-event, and operating-brief sections.
3. Remove duplicate grouping of already returned intent-ranked results.
4. Replace provider-level retrieval diagnostics with a small retrieval summary; detailed diagnostics remain available through `retrieval_diagnostics`.
5. If a large project still exceeds the budget, deterministically reduce optional excerpt and manifest sections while returning counts and deep-retrieval instructions, never dropping current-truth or required live-check safety guidance.

## Retrieval Quality

Quality is preserved by progressive disclosure:

- The first call keeps high-value ranked excerpts and all action/safety guidance in context.
- `search_memory` retrieves additional relevant chunks by query and scope.
- `resolve_current_truth` remains the source for volatile structured state.
- `get_current_context({ query })` retrieves focused current-context material.
- `fetch` retrieves a selected canonical full document.
- `response_mode: "expanded"` remains available when a consumer intentionally needs the legacy full payload.

This improves practical model quality because high-signal context remains available for reasoning instead of being displaced by duplicated Markdown and diagnostics.

## Components

### Session Payload Compaction

Add focused compaction helpers that summarize projects, current-context documents, ranked search output, tasks, facts, source events, and operating-brief duplication. Keep this separate from the underlying persistence and ranking logic.

### Service Assembly

Update `prepareAssistantSession` to select compact or expanded assembly. Compact mode avoids snapshot hydration at query time and builds its response from a document manifest and compacted retrieval results. Expanded mode retains current behavior.

### MCP Surface

Expose `response_mode` on `prepare_assistant_session` and document the default and opt-in behavior in the tool description.

### Client Guidance

Update agent/client documentation to tell models that session setup returns a compact context pack and to use focused retrieval tools for source material needed in the answer.

## Testing

- Unit/integration test compact mode does not return `snapshot.rawMarkdown` or duplicate grouped context.
- Unit/integration test explicit expanded mode retains full Markdown material.
- Contract test accepts `response_mode`.
- Regression test models a large current-context set and asserts compact serialized output is no greater than 64 KB while retaining required live-check and retrieval guidance.
- Verify typecheck, full test suite, and a live post-deployment Nelson-shaped request.

## Deployment

No D1 migration or binding change is required. Production completion requires commit and push to `main`, deployment to the Cloudflare Worker, `/health` smoke verification, and a live `prepare_assistant_session` check showing compact default output beneath the response budget.
