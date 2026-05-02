import { describe, expect, it } from "vitest";

import { classifyRequest } from "~/domain/request-classification";

describe("classifyRequest", () => {
  it("classifies planning and scheduling requests", () => {
    const result = classifyRequest("Plan my next week and prioritize due tasks.");

    expect(result.primary_category).toBe("planning_scheduling");
    expect(result.categories.planning_scheduling).toBe(true);
    expect(result.matched_rules).toContain("planning/scheduling terms");
  });

  it("classifies code and repo requests", () => {
    const result = classifyRequest("Inspect the repo branch and failing CI test in `src/domain/service.ts`.");

    expect(result.primary_category).toBe("code_repo");
    expect(result.categories.code_repo).toBe(true);
  });

  it("classifies customer and external-source-dependent requests", () => {
    const result = classifyRequest("What is the latest CRM status for this customer deal before I call?");

    expect(result.primary_category).toBe("customer_sales_business");
    expect(result.categories.customer_sales_business).toBe(true);
    expect(result.categories.external_source_dependent).toBe(true);
    expect(result.risk_level).toBe("medium");
  });

  it("flags destructive or write actions as high risk", () => {
    const result = classifyRequest("Update the account and send the email.");

    expect(result.categories.destructive_write_action).toBe(true);
    expect(result.risk_level).toBe("high");
  });
});
