# Compact Assistant Session Payload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `prepare_assistant_session` and `plan_request` compact by default so AI clients receive bounded, high-signal context packs rather than duplicated full documents or planning material.

**Architecture:** Keep persistence and search quality unchanged, but introduce a compact response assembly boundary for session setup. Compact mode reads current-context metadata only, summarizes repeated material, references top-level task/tool details instead of copying them into the operating brief, and enforces a 64 KB budget with focused retrieval instructions; explicit expanded mode retains the full diagnostic/compatibility response.

**Tech Stack:** TypeScript, Cloudflare Workers MCP server, Vitest, D1/Vectorize-backed existing memory service.

---

### Task 1: Regression Tests For Compact And Expanded Sessions

**Files:**
- Modify: `tests/integration/assistant-session-planning.test.ts`
- Modify: `tests/contract/mcp-contract.test.ts`

- [ ] **Step 1: Write failing integration tests**

Add large current-context fixtures and tests equivalent to:

```ts
const compact = await service.prepareAssistantSession({
  projectOrTopic: "light-lane",
  userIntent: "Prepare for Nelson sales meetings tomorrow.",
  taskProfile: "sales_proposal",
});

expect(compact.response_mode).toBe("compact");
expect(JSON.stringify(compact)).not.toContain("full context body");
expect(compact.current_context.items[0]).not.toHaveProperty("snapshot");
expect(compact.grouped_memory).not.toHaveProperty("grouped");
expect(compact.payload_budget.serialized_bytes).toBeLessThanOrEqual(64 * 1024);
expect(JSON.stringify(compact, null, 2).length).toBeLessThanOrEqual(64 * 1024);
expect(compact.retrieval_guidance.tools).toContain("fetch");

const expanded = await service.prepareAssistantSession({
  projectOrTopic: "light-lane",
  userIntent: "Prepare for Nelson sales meetings tomorrow.",
  responseMode: "expanded",
});

expect(expanded.current_context.items[0].snapshot.rawMarkdown).toContain("full context body");
```

- [ ] **Step 2: Write failing planning and MCP contract tests**

Add a test asserting legacy `prepareWorkSession` still returns full snapshot material for compatibility. Add large task/source-event fixtures for `planRequest` and assert the default planning response, including an indented client rendering, is compact and bounded under 64 KB. Call both `prepare_assistant_session` and `plan_request` using `response_mode: "expanded"` and assert the service receives/returns the expanded response marker, proving the wire-level options exist.

- [ ] **Step 3: Run the focused tests to verify red**

Run:

```bash
npx vitest run tests/integration/assistant-session-planning.test.ts tests/contract/mcp-contract.test.ts
```

Expected: failures because `response_mode`, compact session data, payload budgeting, and MCP schema support do not yet exist.

### Task 2: Compact Session Assembly

**Files:**
- Create: `src/domain/session-payload.ts`
- Modify: `src/domain/service.ts`
- Test: `tests/integration/assistant-session-planning.test.ts`

- [ ] **Step 1: Implement compact representation helpers**

Create exports for the constants and shaping operations used by session setup:

```ts
export const COMPACT_SESSION_MAX_BYTES = 64 * 1024;
export type AssistantSessionResponseMode = "compact" | "expanded";

export function compactCurrentContextDocuments(documents: MemoryDocument[]) { /* metadata only */ }
export function compactSearchMemory(memory: unknown) { /* ranked excerpts once, summary diagnostics */ }
export function compactOperatingBrief(brief: unknown) { /* no copied full arrays/records */ }
export function enforceCompactSessionBudget(session: Record<string, unknown>) { /* budget readable JSON; retain safety fields */ }
```

Implement deterministic optional-section trimming only when serialized compact output exceeds the fixed budget. `current_truth`, required live checks, actionability, and write-back guardrails must survive trimming.

- [ ] **Step 2: Assemble compact mode without loading full snapshots**

Update `MemoryService.prepareAssistantSession` and `MemoryService.planRequest` to accept:

```ts
responseMode?: AssistantSessionResponseMode;
```

Default it to `"compact"`. In compact session mode call `repo.listCurrentContextDocuments(project)` and return the metadata manifest; do not invoke `getCurrentContext()` and therefore do not hydrate snapshots. Continue to use full search/ranking internally for relevant excerpts, but return `compactSearchMemory(groupedMemory)`. In compact planning mode summarize resolution, ranked memory, task lists, strategy, and operating-brief duplication while retaining the request plan. In expanded mode keep the prior detailed structures, and make the legacy `prepareWorkSession` wrapper explicitly invoke expanded mode.

- [ ] **Step 3: Return budget and retrieval guidance**

Compact session and planning responses must include:

```ts
{
  response_mode: "compact",
  payload_budget: { max_bytes: 65536, serialized_bytes: number, trimmed: boolean },
  retrieval_guidance: {
    message: string,
    tools: ["search_memory", "resolve_current_truth", "get_current_context", "fetch"],
    expanded_session_opt_in: { response_mode: "expanded" }
  }
}
```

- [ ] **Step 4: Run the focused integration tests to verify green**

Run:

```bash
npx vitest run tests/integration/assistant-session-planning.test.ts
```

Expected: compact and expanded response tests pass.

### Task 3: MCP Contract And Public Guidance

**Files:**
- Modify: `src/mcp/tools.ts`
- Modify: `README.md`
- Modify: `docs/ASSISTANT_CONTEXT_OS.md`
- Modify: `docs/CONTEXT_OS_MEMORY_CLIENT_INSTRUCTIONS.md`
- Modify: `docs/instructions/CLAUDE_GENERAL_INSTRUCTIONS.md`
- Modify: `docs/instructions/CODEX_AGENTS_INSTRUCTIONS.md`
- Modify: `docs/instructions/CHATGPT_CUSTOM_INSTRUCTIONS.md`
- Modify: `docs/instructions/UNIVERSAL_MCP_CLIENT_INSTRUCTIONS.md`
- Test: `tests/contract/mcp-contract.test.ts`

- [ ] **Step 1: Expose compact and expanded MCP modes**

Add the schema field to `prepare_assistant_session` and `plan_request`:

```ts
response_mode: z.enum(["compact", "expanded"]).optional()
```

Pass it into the matching service method, and state in both descriptions that compact mode is the default while expanded mode is deliberate detailed retrieval.

- [ ] **Step 2: Serialize JSON results without formatting-only expansion**

Add a contract test asserting JSON text does not contain indentation-only newlines, then change `textResult` to use `JSON.stringify(value)` so the compact budget represents the tool content delivered to an AI client.

- [ ] **Step 3: Update agent guidance**

Document this required client pattern:

```text
prepare_assistant_session and plan_request return compact context packs by default. Read them first, then use
search_memory, resolve_current_truth, get_current_context with a query, or fetch for relevant
full source material. Request response_mode="expanded" only for deliberate diagnostics or
compatibility needs, not normal session startup.
```

- [ ] **Step 4: Run MCP contract tests to verify green**

Run:

```bash
npx vitest run tests/contract/mcp-contract.test.ts
```

Expected: MCP contract tests pass, including response-mode exposure.

### Task 4: Full Verification And Production Delivery

**Files:**
- Review all changed files.

- [ ] **Step 1: Run typecheck and complete automated tests**

Run:

```bash
npm run typecheck
npm test
```

Expected: both exit successfully with zero failing tests.

- [ ] **Step 2: Run safety and configuration checks**

Run:

```bash
git diff --check
git diff --name-only --diff-filter=ACM | xargs rg -n "api[_-]?key|secret|token|password|Bearer " || true
npx wrangler --version
```

Expected: no accidentally introduced secret material; Wrangler v4 is available.

- [ ] **Step 3: Commit and push the production change**

Run:

```bash
git add docs src tests
git commit -m "Compact assistant session payloads"
git push origin main
```

Expected: `main` is pushed successfully.

- [ ] **Step 4: Deploy and smoke-test production**

No migration files are changed, so no D1 migration is required. Deploy and execute health/session checks:

```bash
npm run deploy
curl -fsS https://memory-system-mcp.cloudflare-9f0.workers.dev/health
~/.codex/bin/memory-mcp prepare_assistant_session '{"project_or_topic":"Light Lane - Nelson sales meetings prep","user_intent":"Prepare for 5 Nelson sales meetings tomorrow booked by Christchurch BDR team (Xiarn). 4 meetings tomorrow 9am-5:30pm Port Nelson to Annesbrook. Need TODO list for tonight: review CRM deal notes, review emails from Xiarn, prep for handheld/manufacturing laser conversations. Will work between meetings from coffee shop.","environment":"claude","active_sources":["zoho_crm","zoho_mail","zoho_calendar"],"task_profile":"sales_proposal","timezone":"Pacific/Auckland"}' > /tmp/context-os-compact-session.json
~/.codex/bin/memory-mcp plan_request '{"project_or_topic":"Light Lane - Nelson sales meetings prep","user_intent":"Prepare for 5 Nelson sales meetings tomorrow booked by Christchurch BDR team (Xiarn). 4 meetings tomorrow 9am-5:30pm Port Nelson to Annesbrook. Need TODO list for tonight: review CRM deal notes, review emails from Xiarn, prep for handheld/manufacturing laser conversations. Will work between meetings from coffee shop.","environment":"claude","active_sources":["zoho_crm","zoho_mail","zoho_calendar"],"task_profile":"sales_proposal","timezone":"Pacific/Auckland"}' > /tmp/context-os-compact-plan.json
wc -c /tmp/context-os-compact-session.json
wc -c /tmp/context-os-compact-plan.json
```

Expected: health request succeeds and both live compact responses are no greater than 64 KB serialized JSON payload content.
