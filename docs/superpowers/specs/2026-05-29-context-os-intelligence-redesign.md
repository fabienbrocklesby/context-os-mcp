# Context OS — Intelligence Redesign

**Date:** 2026-05-29  
**Status:** Approved  
**Author:** Claude (Sonnet 4.6)

---

## Problem

The system stores documents and retrieves them by semantic similarity. It has no concept of what is currently actionable, what your real situation is, or whether a query asks for a plan versus knowledge versus history. The result is that old, dense session content outranks current truth — stale deals surface as priorities, old workers appear as current team, and the AI gives advice without knowing your actual constraints today.

The root causes, confirmed by codebase audit:

1. **All queries use the same retrieval path.** A "what should I push this week" query and a "explain the module architecture" query both hit semantic search identically. The system cannot distinguish planning intent from knowledge lookup.

2. **No actionability model.** Entities (deals, projects, tasks) have no machine-readable field expressing whether they are actionable right now. A blocked deal and a hot deal look identical to the retrieval layer.

3. **Session summaries are retrievable forever.** `historical` status is retrievable. Old dense sessions about FiveStar Print rank higher than the sparse `current-sales-state.md` placeholder because they contain more specific matching text.

4. **No situational awareness.** The AI has no persistent record of your current constraints: cash position, location, top priorities across all initiatives this week. Without this, it cannot reason across initiatives.

5. **The codebase is a maintenance liability.** `service.ts` is 6,765 lines. `tools.ts` is 2,853 lines. `repository.ts` is 3,875 lines. Hard-coded Light Lane logic is scattered across domain files. Nothing is testable in isolation.

6. **Obsidian graph is dead.** Files use YAML `supersedes: [id]` to express relationships. Obsidian's graph only reads `[[wiki links]]` in file bodies. Almost no files have them. Every node is isolated.

---

## Design

### Four-Layer Memory Model

Documents and entity states are classified by layer. Layer determines retrieval priority and filtering rules.

```
situation   — your current state across all initiatives; always read first
knowledge   — stable, durable facts; preferenced for "tell me about X" queries
operational — active deals, tasks, recent decisions; filtered by actionability for planning queries
event_log   — session summaries and history; excluded from default retrieval; explicit fetch only
```

The `memory_layer` field is added to `memory_documents` in D1 and to document frontmatter. The backfill rules by existing memory_type:

| memory_type       | canonical | → memory_layer |
|-------------------|-----------|----------------|
| current_context   | true      | knowledge (or situation for the personal awareness doc) |
| current_context   | false     | operational    |
| decision          | any       | knowledge      |
| snippet           | any       | knowledge      |
| repo_index        | any       | knowledge      |
| session_summary   | any       | event_log      |
| historical_note   | any       | event_log      |

The situational awareness document is a single `current_context` document with `memory_layer: situation` and a well-known path (`shared/context/current/situation.md`). It is read before any other retrieval. Without it, cross-initiative intelligence is impossible.

A `situation` document is a single active `current_context` document per user (not per project) that the AI maintains. It contains your current financial position, location, top priorities this week, and key constraints. It is read before any other retrieval. Without it, cross-initiative intelligence is impossible.

---

### Actionability Model

Two new columns on `entity_states`:

```sql
actionability TEXT NOT NULL DEFAULT 'unknown'
  -- values: active | ready | waiting | blocked | unknown
resolve_after TEXT
  -- ISO date: when to re-evaluate this state
```

A deal waiting on a finance partner: `actionability = 'blocked'`, `resolve_after = '2026-08-01'`.  
A deal ready for a proposal: `actionability = 'ready'`.  
A deal actively being worked: `actionability = 'active'`.

Retrieval for planning queries filters: `actionability IN ('active', 'ready') OR resolve_after IS NULL OR resolve_after <= today`. Blocked items with a future `resolve_after` do not appear in planning results but remain fully available via direct lookup.

This does not archive or hide old deals. It makes the actionability machine-readable so retrieval can apply it.

---

### Retrieval Intent Classification

The existing `classifyRequest` function returns a primary category used for time/actionability assessment. We extend this to also produce a `RetrievalIntent` that the retrieval layer uses to filter and rank results.

```typescript
type RetrievalIntent =
  | 'planning'     // "what should I push / focus / work on"
  | 'knowledge'    // "explain / tell me about / how does"
  | 'status'       // "what is the status of / what happened with"
  | 'historical'   // "history of / what happened / walk me through"
  | 'general'
```

**planning:** Query entity_states filtered by actionability. Layer 1 (situation) first, then Layer 3 (operational, actionable only). Layer 4 (event_log) excluded.

**knowledge:** `knowledge` layer documents first. Entity profiles, decisions, snippets, repo indexes. Session summaries excluded — but decisions and current_context canonical docs are included.

**status:** Layer 3 entity states first. If entity state is stale or missing, surface a live-check recommendation. Layer 4 falls through only if no entity state exists.

**historical:** Layer 4 included. Returns full session history for the named entity/project.

**general:** Layers 1-3 in priority order. Layer 4 excluded.

---

### Obsidian Wiki Links

Every document written by the MCP includes a `## Related` section at the bottom with `[[wiki links]]` to connected entities. The `finish_work_session` tool generates these links by:

1. Scanning mentioned entity slugs/names in the written document
2. Resolving them against known entities in D1
3. Appending a `## Related` section with `[[Entity Name]]` links

Entity profile documents link to:
- Their parent initiative: `[[Initiative Name]]`
- Related people: `[[Person Name]]`
- Related concepts: `[[Concept Name]]`

This creates real edges in the Obsidian graph. Over time, the graph becomes navigable — you can follow a deal to the company, from the company to the contact, from the contact to related decisions.

The portability of the knowledge layer also becomes visible in Obsidian: Light Lane entities link to each other but not to personal financial documents.

---

### Code Architecture

The codebase has one god class (`MemoryService`, 6,765 lines), one god tools file (2,853 lines), and one monolithic repository (3,875 lines). This makes everything hard to read, test, and change. The refactor separates concerns without adding new abstractions.

**Target structure:**

```
src/
  domain/
    types.ts              # All shared types and schemas. No logic.
    retrieval.ts          # Search, ranking, intent classification, actionability filter
    planning.ts           # Operating brief and session assembly
    time.ts               # Time context and actionability assessment
    chunking.ts           # (unchanged)
    frontmatter.ts        # (unchanged)
    scope.ts              # (unchanged)
  service/
    ProjectService.ts     # Project CRUD, folder management, aliases
    DocumentService.ts    # Document create/update/index, wiki link generation
    EntityService.ts      # Entities, entity states with actionability
    RetrievalService.ts   # Search with intent classification and filtering
    PlanningService.ts    # Session prep, operating brief, plan_request
    InitiativeService.ts  # Initiatives, strategy nodes, milestones, assets
  tools/
    project-tools.ts      # MCP tools: ensure_project, update_project_profile, ...
    document-tools.ts     # MCP tools: save_snippet, update_context_document, fetch, ...
    entity-tools.ts       # MCP tools: upsert_entity_state, get_entity_current_state, ...
    retrieval-tools.ts    # MCP tools: search_memory, resolve_current_truth, ...
    planning-tools.ts     # MCP tools: prepare_assistant_session, plan_request, finish_work_session, upsert_situation
    initiative-tools.ts   # MCP tools: upsert_initiative, upsert_vision, ...
    admin-tools.ts        # MCP tools: reindex, reconcile, migration tools, ...
  persistence/
    d1/
      types.ts            # DB row types only
      ProjectRepository.ts
      DocumentRepository.ts
      EntityRepository.ts
      InitiativeRepository.ts
      AdminRepository.ts  # Reindex jobs, sync runs, migration manifests
  integrations/
    github/client.ts      # (unchanged)
    vectorize/client.ts   # (unchanged)
    workers-ai/embeddings.ts  # (unchanged)
    workdrive/client.ts   # Renamed from zoho/client.ts; unchanged internally
  mcp/
    server.ts             # Wire services and tool groups. No logic.
  index.ts                # Cloudflare Worker entry. No logic.
```

Rules for the refactor:
- Each service file handles exactly one domain. No cross-service calls except through explicit inputs.
- Services do not call each other directly. The MCP layer composes them.
- No class inheritance. Services are classes with constructor injection (env, principal).
- No customer-specific domain files. `light-lane-memory-recovery.ts` moves to admin-tools.ts (it is a one-off recovery script, not core domain). `light-lane-live-state.ts` is renamed to `zoho-planning.ts` and contains the general Zoho external write and live-state planning tools — not Light Lane specific.
- `session-payload.ts` is deleted. Compaction logic moves inline to `PlanningService` where it is used.
- The `types.ts` domain file is the single source of type truth. Other files import from it.

---

### Database Schema Changes

Two additive migrations. No existing columns modified. No data deleted.

**Migration 0009: actionability fields on entity_states**

```sql
ALTER TABLE entity_states ADD COLUMN actionability TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE entity_states ADD COLUMN resolve_after TEXT;

CREATE INDEX IF NOT EXISTS idx_entity_states_actionability
  ON entity_states(project, entity_id, actionability, resolve_after)
  WHERE status = 'active';
```

**Migration 0010: memory_layer on documents**

```sql
ALTER TABLE documents ADD COLUMN memory_layer TEXT;

CREATE INDEX IF NOT EXISTS idx_documents_memory_layer
  ON documents(project, memory_layer, status, active);
```

Existing documents default to NULL (treated as `operational`). A backfill tool sets:
- `session_summary` and `historical_note` → `event_log`
- `current_context` with `canonical = 1` → `knowledge` (or `situation` for the personal situation doc)
- everything else → `operational`

---

### New MCP Tools

**`upsert_situation`**  
Creates or updates the cross-initiative situational awareness document. Accepts: financial_position, location, top_priorities (array), key_constraints (array), active_initiatives (array). Writes to a well-known path and always sets `memory_layer: situation, canonical: true`. The AI is expected to call this at the start of significant planning sessions and after life changes.

**`set_entity_actionability`**  
Updates `actionability` and optionally `resolve_after` on an entity state without replacing the full state. Accepts: entity_slug, state_key, actionability, resolve_after, reason. This is the tool to call when a deal is blocked — not archiving, just marking it non-actionable.

---

### Vault Migration Strategy

No vault files are deleted. The migration is additive:

1. Run D1 migrations (schema only, no data change)
2. Run `backfill_memory_layers` admin tool: updates `memory_layer` on existing documents based on `memory_type` and `canonical` flag
3. Run `reindex_all` to rebuild Vectorize chunks with the new `memory_layer` metadata
4. Mark stale entity states as blocked: FiveStar, Fully Promoted, any deal/project with a known blocker — using `set_entity_actionability`
5. Create the situational awareness document via `upsert_situation`
6. Create the initiative hierarchy via `upsert_initiative` for: Light Lane, Dropshipping Portfolio, Software Infrastructure, Personal
7. Associate existing projects to their initiatives

All existing documents remain. The reconciliation cron continues to sync WorkDrive. Nothing is deleted.

---

### Tools Removed (Cleanup)

Tools that exist today but are dead weight or too specific to one customer:

- `analyze_light_lane_memory_recovery` / `run_light_lane_memory_recovery` — one-off recovery operations; data is recovered; remove.
- `import_ai_brain_vault` — one-off import from an old Obsidian vault; data is imported; remove.
- `analyze_workdrive_canonicalization` / `run_workdrive_canonicalization` — one-off canonicalization; done; remove.
- `analyze_memory_migration` / `run_memory_migration` — one-off migration; done; remove.
- `analyze_context_truth_migration` / `run_context_truth_migration` — superseded by the new actionability model; remove.
- `plan_light_lane_live_state_refresh` — rename to `plan_live_state_refresh` and make project-agnostic; remove the Light Lane hard-coding.

Removing these shrinks the tools API surface meaningfully and removes ~500 lines of hard-coded customer logic from the domain layer.

---

## Out of Scope

- Vector database replacement (Cloudflare Vectorize is fine)
- WorkDrive replacement (fine as canonical storage)
- Authentication changes
- New live integrations beyond what exists today

---

## Success Criteria

1. Planning queries do not surface deals with `actionability = 'blocked'` and a future `resolve_after` date
2. Each service file is under 400 lines
3. `service.ts` and `repository.ts` do not exist in the final codebase
4. Every document written by the MCP includes a `## Related` section with at least one `[[wiki link]]` where entities are known
5. The Obsidian graph shows recognizable clusters: Light Lane entities connected to each other, Dropshipping entities connected to each other
6. TypeScript strict mode passes with no errors
7. All existing tests pass
