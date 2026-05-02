import { describe, expect, it } from "vitest";

import { classifyRequest } from "~/domain/request-classification";
import { buildToolPlan } from "~/domain/tool-policy";

describe("buildToolPlan", () => {
  it("requires operational context for planning requests", () => {
    const plan = buildToolPlan({
      classification: classifyRequest("Plan today and tomorrow."),
    });

    expect(plan.required_tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tool: "get_operational_context",
          timing: "before_answer",
        }),
      ]),
    );
  });

  it("requires GitHub tools for code and repo requests", () => {
    const plan = buildToolPlan({
      classification: classifyRequest("Review the repo diff and failing CI."),
    });

    expect(plan.required_tools.map((tool) => tool.tool)).toEqual(
      expect.arrayContaining(["github_project_repos", "github_search_code"]),
    );
  });

  it("gates destructive writes behind confirmation", () => {
    const plan = buildToolPlan({
      classification: classifyRequest("Delete the old task and push the commit."),
    });

    expect(plan.forbidden_without_confirmation.map((item) => item.action)).toEqual(
      expect.arrayContaining([
        "delete, archive, cancel, purchase, deploy, push, or commit",
      ]),
    );
  });

  it("returns generic connector policy defaults", () => {
    const plan = buildToolPlan({
      classification: classifyRequest("Check the latest Shopify order status."),
      activeSources: ["shopify"],
    });

    expect(plan.connector_policy_defaults.shopify).toMatchObject({
      save_policy: "durable_summary",
      live_only: ["raw order payloads"],
    });
  });
});
