# Light Lane Zoho Live State Design

## Goal

Make Context OS Memory smarter about Light Lane's current business state by adding a careful, limited, read-only Zoho live-state orchestration layer. ContextOS may maintain structured memory state from live Zoho reads, but it must not mutate Zoho records, send mail, change calendar events, or expose raw private payloads.

## Operating Boundary

ContextOS remains the durable memory and orchestration control plane. It can:

- Decide that Light Lane work needs live Zoho checks.
- Read from an explicitly read-only Zoho MCP connection when configured.
- Maintain structured `entity_states`, `source_events`, facts, and tasks from safe summaries.
- Report live-source health, freshness, observed timestamps, and confidence.
- Tell an assistant which external write-capable MCP should be used for edits.

ContextOS must not:

- Store raw CRM payloads, full email bodies, attachments, or full calendar details.
- Use broad semantic vectors as current deal truth.
- Perform Zoho writes itself.
- Use Zoho for non-Light-Lane projects unless the project explicitly opts in.
- Treat "tool exists" as "tool is authenticated and healthy."

## Recommended Architecture

Use a hybrid read-through and limited background-maintenance model.

1. A separate `LightLane-ReadOnly` Zoho MCP server should be configured in Zoho MCP with only list/search/get/read tools for CRM, Mail, Calendar, Notebook, and WorkDrive.
2. The existing broad `LightLane` Zoho MCP can remain available to assistants for confirmed edits, but ContextOS should only point to it as a delegated write path.
3. ContextOS exposes read-only planning and policy tools that explain which live checks are needed, which read-only tools are allowed, which writes are forbidden, and what durable write-back is safe.
4. Background maintenance should run only for Light Lane and only write safe structured state. The first production version should ship the orchestration and policy surface; actual scheduled live ingestion can follow once the read-only Zoho MCP URL/key is configured as a secret.

## Components

### Live Source Policy

Add a small domain module that returns the Light Lane live-source policy:

- Scope: `light-lane` and opted-in related Light Lane customer projects.
- Read connector: `LightLane-ReadOnly` Zoho MCP.
- Write connector: delegated external Zoho MCP only.
- Allowed durable write types: `entity_state`, `source_event`, `task`, `fact`, `decision`.
- Forbidden durable content: raw payloads, full emails, attachments, full attendee lists, private notes, credentials.

### Refresh Planner

Add a read-only planner that answers:

- Whether the request/project should use Zoho.
- Which source kinds must be checked.
- Which state keys should be refreshed.
- What staleness window applies.
- What safe write-back is allowed after a read.
- What to do if the read-only Zoho MCP is unavailable.

This planner does not call Zoho directly in the first version. It returns concrete guidance for clients and future scheduler code.

### Write Delegation Planner

Add a read-only planner for actions like "update deal," "send email," or "move meeting":

- Classify the action as external write.
- Refuse to perform it inside ContextOS.
- Require explicit user confirmation and live context.
- Point the assistant to the configured write-capable Zoho MCP.
- Recommend saving only a post-action durable summary/source event after the external write completes.

### Agent Instructions

Update all agent instruction Markdown files to tell clients:

- For Light Lane, use ContextOS first, then read-only Zoho live checks when the operating brief requires them.
- ContextOS may maintain current structured Light Lane state from read-only Zoho reads.
- External Zoho writes must happen through a separate write-capable Zoho MCP and require confirmation.
- Non-Light-Lane projects must not use Zoho business data unless explicitly requested or opted in.

## Data Flow

For a Light Lane current-state query:

1. Assistant calls `prepare_assistant_session` or `plan_request`.
2. ContextOS resolves project and current truth.
3. If current state is required and structured state is missing/stale, ContextOS returns read-only Zoho live checks and the refresh planner.
4. Client executes available read-only Zoho tools, or reports unavailability.
5. Assistant writes back safe summaries using existing ContextOS tools such as `save_source_event` and `upsert_entity_state`.

For an external write:

1. Assistant asks ContextOS for write guidance.
2. ContextOS returns a delegated write plan and refuses direct mutation.
3. Assistant uses the write-capable Zoho MCP only after confirmation.
4. Assistant writes back a concise durable summary/source event, not raw payloads.

## Testing

Add unit tests for:

- Light Lane projects produce read-only Zoho refresh guidance.
- Non-Light-Lane projects do not trigger Zoho maintenance by default.
- External write actions are delegated, not executed.
- Environment capability planning recognizes read-only Zoho MCP availability signals.
- MCP contract exposes the new read-only tools.

## Deployment

Production completion requires:

- Typecheck and tests.
- Secret scan of changed files.
- D1 migrations applied if any are added.
- Commit, push to GitHub, deploy or confirm Git-triggered deploy.
- Live `/health` smoke check and MCP tool smoke check.
