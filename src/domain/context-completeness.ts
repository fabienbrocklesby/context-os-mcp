import { slugify } from "~/domain/memory";

type CurrentContextDocument = {
  title: string;
  path?: string | null;
  tags?: string[] | null;
};

export const LIGHT_LANE_REQUIRED_REPOS = [
  "Light-Lane/LightLane-Site-V2",
  "Light-Lane/Light-Lane-Ruida",
  "Light-Lane/Light-Lane-Portal",
  "Light-Lane/LightLane-App",
  "Light-Lane/Light-Lane-Ruida-CLI",
  "Light-Lane/LightLane-Internal-CRM",
  "Light-Lane/LightLane-Website",
  "Light-Lane/LightLane-Public-Facing-Website",
];

const LIGHT_LANE_REQUIRED_SECTIONS = [
  {
    id: "identity",
    matchers: ["identity", "core-identity", "who-light-lane-is", "light-lane-entrypoint"],
  },
  {
    id: "offer_map",
    matchers: ["offer-map", "offers", "packages", "business-package"],
  },
  {
    id: "full_system_positioning",
    matchers: ["full-system-positioning", "system-positioning", "what-light-lane-is"],
  },
  {
    id: "sales_rules",
    matchers: ["sales-rules", "sales-thesis", "core-sales-thesis", "answering-rules"],
  },
  {
    id: "objections",
    matchers: ["objections", "objection-handling"],
  },
  {
    id: "technical_guardrails",
    matchers: ["technical-guardrails", "claim-boundaries", "integration-guardrails", "safety-guardrails"],
  },
  {
    id: "source_trust",
    matchers: ["source-trust", "evidence-rules", "source-of-truth"],
  },
  {
    id: "repo_map",
    matchers: ["repo-map", "repository-map", "github-repos"],
  },
  {
    id: "current_sales_state",
    matchers: ["current-sales-state", "deal-state", "opportunity-state", "crm-state"],
  },
] as const;

export type ContextCompletenessAssessment = ReturnType<typeof assessContextCompleteness>;

export function assessContextCompleteness(input: {
  project?: string;
  currentContextDocuments?: CurrentContextDocument[];
  repoFullNames?: string[];
}) {
  const project = slugify(input.project ?? "shared");
  const documents = input.currentContextDocuments ?? [];
  const repoFullNames = input.repoFullNames ?? [];

  if (project !== "light-lane") {
    return {
      project,
      required_sections: [],
      covered_sections: [],
      missing_sections: [],
      has_business_brain: documents.length > 0,
      warnings: documents.length ? [] : ["missing_current_context"],
      repo_coverage: {
        required: [],
        present: repoFullNames,
        missing: [],
        complete: true,
      },
      memory_quality_gates: {
        required_context_coverage: documents.length > 0,
        repo_coverage: true,
        business_brain_loaded: documents.length > 0,
      },
    };
  }

  const coveredSections = LIGHT_LANE_REQUIRED_SECTIONS
    .filter((section) => documents.some((document) => documentMatchesSection(document, section.matchers)))
    .map((section) => section.id);
  const missingSections = LIGHT_LANE_REQUIRED_SECTIONS
    .filter((section) => !coveredSections.includes(section.id))
    .map((section) => section.id);
  const normalizedRepos = new Set(repoFullNames.map(normalizeRepoFullName));
  const missingRepos = LIGHT_LANE_REQUIRED_REPOS.filter(
    (repo) => !normalizedRepos.has(normalizeRepoFullName(repo)),
  );
  const hasBusinessBrain = coveredSections.includes("identity")
    && coveredSections.includes("full_system_positioning")
    && coveredSections.includes("sales_rules");
  const warnings = [
    ...(hasBusinessBrain ? [] : ["missing_business_brain"]),
    ...(missingSections.length ? ["required_context_sections_missing"] : []),
    ...(missingRepos.length ? ["repo_coverage_incomplete"] : []),
  ];

  return {
    project,
    required_sections: LIGHT_LANE_REQUIRED_SECTIONS.map((section) => section.id),
    covered_sections: coveredSections,
    missing_sections: missingSections,
    has_business_brain: hasBusinessBrain,
    warnings,
    repo_coverage: {
      required: LIGHT_LANE_REQUIRED_REPOS,
      present: repoFullNames,
      missing: missingRepos,
      complete: missingRepos.length === 0,
    },
    memory_quality_gates: {
      required_context_coverage: missingSections.length === 0,
      repo_coverage: missingRepos.length === 0,
      business_brain_loaded: hasBusinessBrain,
    },
  };
}

function documentMatchesSection(
  document: CurrentContextDocument,
  matchers: readonly string[],
) {
  const haystack = [
    document.title,
    document.path ?? "",
    ...(document.tags ?? []),
  ].map(slugify);
  return matchers.some((matcher) => haystack.some((value) => value.includes(matcher)));
}

function normalizeRepoFullName(repo: string) {
  return repo.trim().toLowerCase();
}
