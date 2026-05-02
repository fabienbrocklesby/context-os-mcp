import { describe, expect, it } from "vitest";

import { buildAssistantActionPlan } from "~/domain/assistant-planning";

describe("buildAssistantActionPlan", () => {
  it("recommends prep/admin/async work for weekend customer outreach", () => {
    const plan = buildAssistantActionPlan({
      userIntent: "Plan customer calls today and follow up on account emails.",
      timezone: "Pacific/Auckland",
      now: "2026-05-01T22:30:00.000Z",
    });

    expect(plan.operational_context.weekday).toBe("Saturday");
    expect(plan.actionability.label).toBe("prep_or_async_only");
    expect(plan.actionability.recommended_now.join(" ")).toContain("Prepare outreach notes");
    expect(plan.actionability.guardrails.join(" ")).toContain("Do not recommend business calls today");
  });

  it("requires live context for latest/current status requests", () => {
    const plan = buildAssistantActionPlan({
      userIntent: "What is the latest GitHub status for the repo?",
      timezone: "UTC",
      now: "2026-05-04T10:00:00.000Z",
      activeSources: ["github"],
    });

    expect(plan.actionability.label).toBe("requires_live_context");
    expect(plan.tool_plan.required_tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tool: "github",
          timing: "before_answer",
        }),
      ]),
    );
  });

  it("requires confirmation for destructive write prompts", () => {
    const plan = buildAssistantActionPlan({
      userIntent: "Update the CRM record and send the follow-up email.",
      timezone: "UTC",
      now: "2026-05-04T10:00:00.000Z",
    });

    expect(plan.actionability.label).toBe("requires_confirmation");
    expect(plan.tool_plan.forbidden_without_confirmation.length).toBeGreaterThan(0);
  });
});
