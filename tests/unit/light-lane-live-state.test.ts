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
