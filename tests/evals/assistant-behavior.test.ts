import { describe, expect, it } from "vitest";

import { buildAssistantActionPlan } from "~/domain/assistant-planning";

describe("Assistant Context OS reliability evals", () => {
  it("does not recommend business calls today on Saturday", () => {
    const plan = buildAssistantActionPlan({
      userIntent: "Make me a day plan for customer calls today.",
      timezone: "Pacific/Auckland",
      now: "2026-05-01T22:30:00.000Z",
    });

    expect(plan.operational_context.weekday).toBe("Saturday");
    expect(plan.actionability.label).toBe("prep_or_async_only");
    expect(plan.actionability.recommended_now.join(" ").toLowerCase()).not.toContain(
      "call businesses today",
    );
  });

  it("allows weekday business-hour outreach only with required live checks", () => {
    const plan = buildAssistantActionPlan({
      userIntent: "Plan customer calls today from the current CRM and email status.",
      timezone: "Pacific/Auckland",
      now: "2026-05-03T22:30:00.000Z",
      activeSources: ["zoho_crm", "zoho_mail"],
    });

    expect(plan.operational_context.weekday).toBe("Monday");
    expect(plan.actionability.label).toBe("requires_live_context");
    expect(plan.tool_plan.required_tools.map((tool) => tool.tool)).toEqual(
      expect.arrayContaining(["zoho_crm", "zoho_mail"]),
    );
  });

  it("requires repo inspection for code requests", () => {
    const plan = buildAssistantActionPlan({
      userIntent: "Fix the failing test in the repo.",
      timezone: "UTC",
      now: "2026-05-04T10:00:00.000Z",
    });

    expect(plan.request_classification.primary_category).toBe("code_repo");
    expect(plan.tool_plan.required_tools.map((tool) => tool.tool)).toEqual(
      expect.arrayContaining(["github_project_repos", "github_search_code"]),
    );
  });
});
