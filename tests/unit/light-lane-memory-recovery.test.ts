import { describe, expect, it } from "vitest";

import {
  analyzeLightLaneMemoryRecovery,
  LIGHT_LANE_CANONICAL_CONTEXT_SECTIONS,
} from "~/domain/light-lane-memory-recovery";

const aiBrainAnalysis = {
  counts: {
    markdown_files: 63,
    wiki_links: 218,
    current_context: 13,
    snippets: 50,
    load_first: 12,
    high_priority: 1,
  },
};

describe("analyzeLightLaneMemoryRecovery", () => {
  it("routes Light Lane business docs and stale deal docs out of shared current context", () => {
    const analysis = analyzeLightLaneMemoryRecovery({
      documents: [
        {
          id: "shared-fully-promoted",
          project: "shared",
          title: "Fully Promoted Nelson (Cristy Aydon)",
          path: "/memory/shared/context/current/fully-promoted-cristy-aydon.md",
          memoryType: "current_context",
          status: "active",
        },
        {
          id: "shared-five-star",
          project: "shared",
          title: "Fivestar Print",
          path: "/memory/shared/context/current/fivestar-print.md",
          memoryType: "current_context",
          status: "active",
        },
        {
          id: "shared-product-offering",
          project: "shared",
          title: "Product Offering",
          path: "/memory/shared/context/current/product-offering.md",
          memoryType: "current_context",
          status: "active",
        },
        {
          id: "ruida-only",
          project: "light-lane",
          title: "Ruida Driver Current Context",
          path: "/memory/projects/light-lane/context/current/ruida-driver-current-context.md",
          memoryType: "current_context",
          status: "active",
        },
      ],
      aiBrainAnalysis,
      associatedRepos: ["Light-Lane/Light-Lane-Ruida"],
      knownDealUpdates: [
        {
          entityName: "Fully Promoted Nelson",
          source: "user_report",
          confidence: 0.8,
          states: {
            budget_status: "no_budget",
            timing: "delayed_to_next_year",
            next_action: "park_until_next_budget_cycle",
          },
          summary:
            "Cristy said there is no budget now; opportunity is delayed until next year and should not be treated as ready to move.",
        },
      ],
    });

    expect(analysis.misplaced_shared_documents.map((doc) => doc.path)).toEqual([
      "/memory/shared/context/current/fully-promoted-cristy-aydon.md",
      "/memory/shared/context/current/fivestar-print.md",
      "/memory/shared/context/current/product-offering.md",
    ]);
    expect(analysis.current_context_documents).toHaveLength(
      LIGHT_LANE_CANONICAL_CONTEXT_SECTIONS.length,
    );
    expect(analysis.current_context_documents.map((doc) => doc.section_id)).toEqual([
      "identity",
      "offer_map",
      "full_system_positioning",
      "sales_rules",
      "objections",
      "technical_guardrails",
      "source_trust",
      "repo_map",
      "current_sales_state",
    ]);
    expect(analysis.current_context_documents.every((doc) =>
      doc.target_path.startsWith("/memory/projects/light-lane/context/current/"),
    )).toBe(true);
    expect(analysis.deal_state_actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entity_name: "Fully Promoted Nelson",
          state_key: "budget_status",
          value: "no_budget",
          write_target: "entity_state",
          requires_live_verification: true,
        }),
        expect.objectContaining({
          entity_name: "Fully Promoted Nelson",
          state_key: "timing",
          value: "delayed_to_next_year",
          write_target: "entity_state",
          requires_live_verification: true,
        }),
      ]),
    );
    expect(analysis.archive_actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          document_id: "shared-fully-promoted",
          action: "archive_shared_current_context_original",
          replacement_project: "light-lane",
        }),
      ]),
    );
    expect(analysis.repo_actions.missing).toEqual(
      expect.arrayContaining([
        "Light-Lane/LightLane-Site-V2",
        "Light-Lane/Light-Lane-Portal",
        "Light-Lane/LightLane-App",
        "Light-Lane/Light-Lane-Ruida-CLI",
        "Light-Lane/LightLane-Internal-CRM",
        "Light-Lane/LightLane-Website",
        "Light-Lane/LightLane-Public-Facing-Website",
      ]),
    );
    expect(analysis.quality_gates).toMatchObject({
      ai_brain_loaded: true,
      required_context_planned: true,
      stale_deals_routed_to_entity_state: true,
      repo_coverage_planned: true,
      ready_to_apply: true,
    });
  });

  it("blocks apply when the AI Brain vault has not been supplied or already imported", () => {
    const analysis = analyzeLightLaneMemoryRecovery({
      documents: [],
      associatedRepos: [],
    });

    expect(analysis.quality_gates.ai_brain_loaded).toBe(false);
    expect(analysis.quality_gates.ready_to_apply).toBe(false);
    expect(analysis.quality_gates.blockers).toContain("ai_brain_vault_not_loaded");
    expect(analysis.current_context_documents).toHaveLength(
      LIGHT_LANE_CANONICAL_CONTEXT_SECTIONS.length,
    );
  });
});
