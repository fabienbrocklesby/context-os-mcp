import { describe, expect, it } from "vitest";

import { assessContextCompleteness } from "~/domain/context-completeness";

const LIGHT_LANE_REPOS = [
  "Light-Lane/LightLane-Site-V2",
  "Light-Lane/Light-Lane-Ruida",
  "Light-Lane/Light-Lane-Portal",
  "Light-Lane/LightLane-App",
  "Light-Lane/Light-Lane-Ruida-CLI",
  "Light-Lane/LightLane-Internal-CRM",
  "Light-Lane/LightLane-Website",
  "Light-Lane/LightLane-Public-Facing-Website",
];

describe("assessContextCompleteness", () => {
  it("warns when Light Lane only has repo-specific current context", () => {
    const assessment = assessContextCompleteness({
      project: "light-lane",
      currentContextDocuments: [
        {
          title: "Ruida Driver Current Context",
          path: "/memory/projects/light-lane/context/current/ruida-driver.md",
          tags: ["repo", "ruida"],
        },
      ],
      repoFullNames: ["Light-Lane/Light-Lane-Ruida"],
    });

    expect(assessment.warnings).toContain("missing_business_brain");
    expect(assessment.warnings).toContain("repo_coverage_incomplete");
    expect(assessment.missing_sections).toEqual(
      expect.arrayContaining(["identity", "offer_map", "full_system_positioning", "sales_rules"]),
    );
    expect(assessment.repo_coverage.missing).toContain("Light-Lane/LightLane-App");
    expect(assessment.memory_quality_gates.required_context_coverage).toBe(false);
  });

  it("passes Light Lane coverage when the business brain sections and repos are present", () => {
    const assessment = assessContextCompleteness({
      project: "light-lane",
      currentContextDocuments: [
        { title: "Light Lane Core Identity", path: "identity.md", tags: ["identity"] },
        { title: "Light Lane Offer Map", path: "offer-map.md", tags: ["offer-map"] },
        {
          title: "Full System Positioning",
          path: "full-system-positioning.md",
          tags: ["full-system-positioning"],
        },
        { title: "Sales Rules and Core Thesis", path: "sales-rules.md", tags: ["sales-rules"] },
        { title: "Objections and Answers", path: "objections.md", tags: ["objections"] },
        {
          title: "Technical Guardrails and Claim Boundaries",
          path: "technical-guardrails.md",
          tags: ["technical-guardrails", "claim-boundaries"],
        },
        { title: "Source Trust and Evidence Rules", path: "source-trust.md", tags: ["source-trust"] },
        { title: "Light Lane Repo Map", path: "repo-map.md", tags: ["repo-map"] },
        { title: "Current Sales State", path: "current-sales-state.md", tags: ["current-sales-state"] },
      ],
      repoFullNames: LIGHT_LANE_REPOS,
    });

    expect(assessment.warnings).not.toContain("missing_business_brain");
    expect(assessment.missing_sections).toEqual([]);
    expect(assessment.repo_coverage.complete).toBe(true);
    expect(assessment.memory_quality_gates.required_context_coverage).toBe(true);
  });
});
