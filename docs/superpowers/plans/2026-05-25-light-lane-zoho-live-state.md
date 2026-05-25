# Light Lane Zoho Live State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only Light Lane Zoho live-state orchestration surface to ContextOS and update agent instructions for safe live checks and delegated Zoho writes.

**Architecture:** Add a focused domain module for Light Lane live-source policy and planning, expose it through read-only MCP tools, and wire its guidance into environment capability planning. Keep the first production version free of raw Zoho secrets and direct Zoho mutation.

**Tech Stack:** TypeScript, Cloudflare Workers, MCP tool registration, Vitest, existing D1/source-event/entity-state primitives.

---

### Task 1: Domain Policy And Planner

**Files:**
- Create: `src/domain/light-lane-live-state.ts`
- Test: `tests/unit/light-lane-live-state.test.ts`

- [ ] **Step 1: Write failing tests**

Create tests that assert:

```ts
import { describe, expect, it } from "vitest";

import {
  buildLightLaneLiveStatePlan,
  buildZohoExternalWritePlan,
  isLightLaneZohoEligibleProject,
} from "~/domain/light-lane-live-state";

describe("Light Lane live state policy", () => {
  it("limits read-only Zoho maintenance to Light Lane projects", () => {
    expect(isLightLaneZohoEligibleProject("light-lane")).toBe(true);
    expect(isLightLaneZohoEligibleProject("fivestar-print")).toBe(true);
    expect(isLightLaneZohoEligibleProject("memory-system-mcp")).toBe(false);
  });

  it("plans read-only refreshes for Light Lane current-state requests", () => {
    const plan = buildLightLaneLiveStatePlan({
      project: "light-lane",
      userIntent: "What is the latest deal status and reply state?",
      availableTools: ["LightLane-ReadOnly Zoho MCP"],
    });

    expect(plan.eligible).toBe(true);
    expect(plan.mode).toBe("read_only_live_refresh");
    expect(plan.required_source_kinds).toEqual(["zoho_crm", "zoho_mail"]);
    expect(plan.allowed_durable_writes).toContain("entity_state");
    expect(plan.forbidden_actions).toContain("update_zoho_record");
    expect(plan.connector_health.available).toBe(true);
  });

  it("does not request Zoho for non-Light-Lane projects by default", () => {
    const plan = buildLightLaneLiveStatePlan({
      project: "memory-system-mcp",
      userIntent: "What is the current repo status?",
      availableTools: ["LightLane-ReadOnly Zoho MCP"],
    });

    expect(plan.eligible).toBe(false);
    expect(plan.required_source_kinds).toEqual([]);
  });

  it("delegates external Zoho writes instead of allowing ContextOS mutation", () => {
    const plan = buildZohoExternalWritePlan({
      project: "light-lane",
      requestedAction: "Update the deal stage and send a follow-up email",
    });

    expect(plan.contextos_can_execute).toBe(false);
    expect(plan.delegate_to).toBe("write_capable_zoho_mcp");
    expect(plan.confirmation_required).toBe(true);
    expect(plan.post_action_write_back).toContain("source_event");
  });
});
```

- [ ] **Step 2: Run the tests and verify red**

Run: `npx vitest run tests/unit/light-lane-live-state.test.ts`

Expected: fail because `src/domain/light-lane-live-state.ts` does not exist.

- [ ] **Step 3: Implement the minimal module**

Export `isLightLaneZohoEligibleProject`, `buildLightLaneLiveStatePlan`, and `buildZohoExternalWritePlan`. Use fixed policy data, simple intent keyword matching, safe write lists, forbidden action lists, and connector health derived from `availableTools`.

- [ ] **Step 4: Run the tests and verify green**

Run: `npx vitest run tests/unit/light-lane-live-state.test.ts`

Expected: pass.

### Task 2: Environment Capability Signals

**Files:**
- Modify: `src/domain/tool-availability.ts`
- Modify: `src/domain/environment-capabilities.ts`
- Test: `tests/unit/environment-capabilities.test.ts`

- [ ] **Step 1: Write failing tests**

Add assertions that `LightLane-ReadOnly Zoho MCP` makes CRM, mail, calendar, notebook, and WorkDrive read capabilities available, and that write-capable Zoho MCP aliases do not make ContextOS itself able to execute writes.

- [ ] **Step 2: Run the tests and verify red**

Run: `npx vitest run tests/unit/environment-capabilities.test.ts`

Expected: fail on the new availability expectations.

- [ ] **Step 3: Implement availability aliases and capability bindings**

Teach `isToolAvailable` that `lightlane_readonly_zoho_mcp`, `zoho_mcp_readonly`, and `read_only_zoho` satisfy read-only Zoho source kinds. Add default environment capability bindings for Zoho CRM/Mail/Calendar as `user_configured` connectors in Codex, Claude, ChatGPT, and generic MCP environments.

- [ ] **Step 4: Run the tests and verify green**

Run: `npx vitest run tests/unit/environment-capabilities.test.ts`

Expected: pass.

### Task 3: MCP Tool Surface

**Files:**
- Modify: `src/domain/service.ts`
- Modify: `src/mcp/tools.ts`
- Test: `tests/contract/mcp-contract.test.ts`

- [ ] **Step 1: Write failing contract tests**

Assert that the MCP server registers:

- `plan_light_lane_live_state_refresh`
- `plan_zoho_external_write`

and that both are read-only/idempotent tools.

- [ ] **Step 2: Run the contract test and verify red**

Run: `npx vitest run tests/contract/mcp-contract.test.ts`

Expected: fail because the tool names are not registered.

- [ ] **Step 3: Add service methods and MCP tool registrations**

Add service wrappers for the domain planners and register both tools with zod schemas. Return JSON text using existing `textResult`.

- [ ] **Step 4: Run the contract test and verify green**

Run: `npx vitest run tests/contract/mcp-contract.test.ts`

Expected: pass.

### Task 4: Agent Instruction Updates

**Files:**
- Modify: `docs/ASSISTANT_CONTEXT_OS.md`
- Modify: `docs/CONTEXT_OS_MEMORY_CLIENT_INSTRUCTIONS.md`
- Modify: `docs/instructions/CLAUDE_GENERAL_INSTRUCTIONS.md`
- Modify: `docs/instructions/CODEX_AGENTS_INSTRUCTIONS.md`
- Modify: `docs/instructions/CHATGPT_CUSTOM_INSTRUCTIONS.md`
- Modify: `docs/instructions/UNIVERSAL_MCP_CLIENT_INSTRUCTIONS.md`

- [ ] **Step 1: Update docs**

Add concise language covering read-only Zoho live-state maintenance, Light Lane-only scope, raw-data restrictions, and external write delegation.

- [ ] **Step 2: Search for policy drift**

Run: `rg -n "Zoho|Light Lane|read-only|write-capable|raw" docs/ASSISTANT_CONTEXT_OS.md docs/CONTEXT_OS_MEMORY_CLIENT_INSTRUCTIONS.md docs/instructions`

Expected: instructions mention the new read-only/write-delegation boundary and do not instruct ContextOS to mutate Zoho.

### Task 5: Full Verification And Production

**Files:**
- All changed files.

- [ ] **Step 1: Run focused tests**

Run:

```bash
npx vitest run tests/unit/light-lane-live-state.test.ts tests/unit/environment-capabilities.test.ts tests/contract/mcp-contract.test.ts
```

Expected: pass.

- [ ] **Step 2: Run full verification**

Run:

```bash
npm run typecheck
npm test
```

Expected: pass.

- [ ] **Step 3: Check migrations and secrets**

Run:

```bash
git diff --name-only
rg -n "zohomcp\\.com|/mcp/\\*|api[_-]?key|secret|token|password|Bearer " .
```

Expected: no new migration is needed and no secret value is committed.

- [ ] **Step 4: Commit, push, deploy, and smoke check**

Run:

```bash
git add .
git commit -m "Add Light Lane Zoho live-state planning"
git push
npm run deploy
curl -fsS https://memory-system-mcp.cloudflare-9f0.workers.dev/health
```

Expected: commit and push succeed, deploy succeeds, health endpoint returns OK JSON.
