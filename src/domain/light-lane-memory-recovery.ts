import { LIGHT_LANE_REQUIRED_REPOS } from "~/domain/context-completeness";
import { slugify } from "~/domain/memory";

export type LightLaneRecoveryDocumentInput = {
  id: string;
  project: string;
  title: string;
  path: string;
  memoryType: string;
  status?: string | null;
  tags?: string[] | null;
};

export type LightLaneRecoveryAiBrainInput = {
  counts?: Partial<{
    markdown_files: number;
    wiki_links: number;
    current_context: number;
    snippets: number;
    load_first: number;
    high_priority: number;
  }>;
};

export type LightLaneKnownDealUpdate = {
  entityName: string;
  source: string;
  confidence?: number;
  summary?: string;
  states: Record<string, string | number | boolean | null>;
};

export type LightLaneRecoveryInput = {
  documents?: LightLaneRecoveryDocumentInput[];
  aiBrainAnalysis?: LightLaneRecoveryAiBrainInput | null;
  associatedRepos?: string[];
  knownDealUpdates?: LightLaneKnownDealUpdate[];
};

export type LightLaneRecoveryCurrentContextDocument = {
  section_id: string;
  title: string;
  target_path: string;
  tags: string[];
  source_stable_ids: string[];
  markdown: string;
};

export type LightLaneDealStateAction = {
  entity_name: string;
  state_key: string;
  value: string | number | boolean | null;
  write_target: "entity_state";
  source: string;
  confidence: number;
  summary?: string;
  requires_live_verification: boolean;
};

export type LightLaneArchiveAction = {
  document_id: string;
  from_path: string;
  to_path: string;
  action: "archive_shared_current_context_original";
  replacement_project: "light-lane";
  replacement_target: "current_context" | "entity_state";
};

export const LIGHT_LANE_CANONICAL_CONTEXT_SECTIONS = [
  {
    id: "identity",
    title: "Light Lane Identity",
    fileName: "identity.md",
    tags: ["light-lane", "business-brain", "identity"],
    sourceNotes: [
      { title: "Core Identity", stableId: "ll-ai-core-identity" },
      { title: "What Light Lane Is", stableId: "ll-ai-what-light-lane-is" },
      { title: "llm-entrypoint", stableId: "ll-ai-llm-entrypoint" },
    ],
    body:
      "Canonical identity, audience, operating model, and boundaries for how assistants should understand Light Lane.",
  },
  {
    id: "offer_map",
    title: "Light Lane Offer Map",
    fileName: "offer-map.md",
    tags: ["light-lane", "business-brain", "offer-map", "business-package"],
    sourceNotes: [
      { title: "What Light Lane Is", stableId: "ll-ai-what-light-lane-is" },
      { title: "Full System Positioning", stableId: "ll-ai-full-system-positioning" },
    ],
    body:
      "Canonical offer map for Light Lane packages, system components, outcomes, and where individual products fit.",
  },
  {
    id: "full_system_positioning",
    title: "Light Lane Full System Positioning",
    fileName: "full-system-positioning.md",
    tags: ["light-lane", "business-brain", "full-system-positioning", "sales-positioning"],
    sourceNotes: [
      { title: "Full System Positioning", stableId: "ll-ai-full-system-positioning" },
      {
        title: "Why Laser Technology Is A Major Selling Point",
        stableId: "ll-ai-why-laser-technology-is-a-major-selling-point",
      },
    ],
    body:
      "Canonical positioning for selling the full Light Lane system first, with device, app, operations, enablement, and implementation framed as one outcome.",
  },
  {
    id: "sales_rules",
    title: "Light Lane Sales Rules",
    fileName: "sales-rules.md",
    tags: ["light-lane", "business-brain", "sales-rules", "proposal-rules"],
    sourceNotes: [
      { title: "How To Answer As Light Lane", stableId: "ll-ai-how-to-answer-as-light-lane" },
      {
        title: "Retrieval Instructions For Vector Databases",
        stableId: "ll-ai-retrieval-instructions-for-vector-databases",
      },
    ],
    body:
      "Rules for proposals, follow-up, sales angle selection, confidence, qualification, and avoiding shy or generic drafting.",
  },
  {
    id: "objections",
    title: "Light Lane Objections",
    fileName: "objections.md",
    tags: ["light-lane", "business-brain", "objections", "sales-enablement"],
    sourceNotes: [
      { title: "What Not To Claim", stableId: "ll-ai-what-not-to-claim" },
      { title: "Source Trust Levels", stableId: "ll-ai-source-trust-levels" },
    ],
    body:
      "Objection handling, risk framing, buyer concerns, and the evidence needed before making commercial claims.",
  },
  {
    id: "technical_guardrails",
    title: "Light Lane Technical Guardrails",
    fileName: "technical-guardrails.md",
    tags: ["light-lane", "business-brain", "technical-guardrails", "claim-boundaries"],
    sourceNotes: [
      { title: "What Not To Claim", stableId: "ll-ai-what-not-to-claim" },
      { title: "Public LLM Sources", stableId: "ll-ai-public-llm-sources" },
      { title: "Source Trust Levels", stableId: "ll-ai-source-trust-levels" },
    ],
    body:
      "Safety, integration, material, manufacturing, software, deployment, and timeline guardrails for Light Lane recommendations and proposals.",
  },
  {
    id: "source_trust",
    title: "Light Lane Source Trust",
    fileName: "source-trust.md",
    tags: ["light-lane", "business-brain", "source-trust", "evidence-rules"],
    sourceNotes: [
      { title: "Source Trust Levels", stableId: "ll-ai-source-trust-levels" },
      { title: "Public LLM Sources", stableId: "ll-ai-public-llm-sources" },
    ],
    body:
      "Source hierarchy for current truth, public facts, user-approved context, volatile CRM/email/calendar data, and old semantic memory.",
  },
  {
    id: "repo_map",
    title: "Light Lane Repo Map",
    fileName: "repo-map.md",
    tags: ["light-lane", "business-brain", "repo-map", "github"],
    sourceNotes: [],
    body:
      "Associated Light Lane repositories, roles, indexing status, and which repo to inspect for product, portal, website, CRM, or Ruida work.",
  },
  {
    id: "current_sales_state",
    title: "Light Lane Current Sales State",
    fileName: "current-sales-state.md",
    tags: ["light-lane", "business-brain", "current-sales-state", "deals"],
    sourceNotes: [{ title: "Source Trust Levels", stableId: "ll-ai-source-trust-levels" }],
    body:
      "Current deal state must be assembled from live CRM/email/calendar where available, then entity states and recent source events. Legacy deal notes are background only.",
  },
] as const;

export function analyzeLightLaneMemoryRecovery(input: LightLaneRecoveryInput = {}) {
  const documents = input.documents ?? [];
  const misplacedSharedDocuments = documents.filter(isMisplacedSharedLightLaneDocument);
  const sharedDealDocuments = misplacedSharedDocuments.filter(isDealDocument);
  const currentContextDocuments = LIGHT_LANE_CANONICAL_CONTEXT_SECTIONS.map((section) =>
    buildCanonicalContextDocument(section),
  );
  const archiveActions = misplacedSharedDocuments.map((document): LightLaneArchiveAction => ({
    document_id: document.id,
    from_path: document.path,
    to_path: `/memory/projects/light-lane/context/history/recovered-shared/${fileNameFromPath(document.path)}`,
    action: "archive_shared_current_context_original",
    replacement_project: "light-lane",
    replacement_target: isDealDocument(document) ? "entity_state" : "current_context",
  }));
  const dealStateActions = [
    ...sharedDealDocuments.map((document): LightLaneDealStateAction => ({
      entity_name: normalizeDealEntityName(document.title),
      state_key: "source_freshness",
      value: "legacy_shared_current_context_requires_live_check",
      write_target: "entity_state",
      source: "legacy_shared_current_context",
      confidence: 0.55,
      summary: `Legacy shared current-context note ${document.path} must not be treated as live deal truth.`,
      requires_live_verification: true,
    })),
    ...(input.knownDealUpdates ?? []).flatMap((update) =>
      Object.entries(update.states).map(([stateKey, value]): LightLaneDealStateAction => ({
        entity_name: update.entityName,
        state_key: stateKey,
        value,
        write_target: "entity_state",
        source: update.source,
        confidence: update.confidence ?? 0.75,
        summary: update.summary,
        requires_live_verification: true,
      })),
    ),
  ];
  const repoActions = buildRepoActions(input.associatedRepos ?? []);
  const aiBrainLoaded = isAiBrainLoaded(input.aiBrainAnalysis);
  const requiredContextPlanned =
    currentContextDocuments.length === LIGHT_LANE_CANONICAL_CONTEXT_SECTIONS.length;
  const staleDealsRoutedToEntityState = sharedDealDocuments.every((document) =>
    dealStateActions.some((action) => action.entity_name === normalizeDealEntityName(document.title)),
  );
  const repoCoveragePlanned = repoActions.associate.length === repoActions.missing.length
    && repoActions.index_overview.length === LIGHT_LANE_REQUIRED_REPOS.length;
  const blockers = [
    ...(aiBrainLoaded ? [] : ["ai_brain_vault_not_loaded"]),
    ...(requiredContextPlanned ? [] : ["required_current_context_not_planned"]),
    ...(staleDealsRoutedToEntityState ? [] : ["stale_deals_not_routed_to_entity_state"]),
    ...(repoCoveragePlanned ? [] : ["repo_coverage_not_planned"]),
  ];

  return {
    migration_slug: "light-lane-memory-recovery",
    project: "light-lane",
    misplaced_shared_documents: misplacedSharedDocuments,
    current_context_documents: currentContextDocuments,
    deal_state_actions: dealStateActions,
    archive_actions: archiveActions,
    repo_actions: repoActions,
    apply_order: [
      "dry_run_ai_brain_import",
      "apply_ai_brain_import",
      "write_canonical_light_lane_current_context",
      "upsert_deal_entity_states",
      "archive_shared_current_context_originals",
      "associate_and_index_light_lane_repos",
      "run_health_and_retrieval_evals",
    ],
    quality_gates: {
      ai_brain_loaded: aiBrainLoaded,
      required_context_planned: requiredContextPlanned,
      stale_deals_routed_to_entity_state: staleDealsRoutedToEntityState,
      repo_coverage_planned: repoCoveragePlanned,
      ready_to_apply: blockers.length === 0,
      blockers,
      warnings: [
        "live_crm_email_calendar_must_be_checked_before_treating_deal_state_as_current",
        "legacy_shared_deal_notes_are_background_only_after_recovery",
      ],
    },
  };
}

function buildCanonicalContextDocument(
  section: (typeof LIGHT_LANE_CANONICAL_CONTEXT_SECTIONS)[number],
): LightLaneRecoveryCurrentContextDocument {
  const targetPath = `/memory/projects/light-lane/context/current/${section.fileName}`;
  const sourceLines = section.sourceNotes.length
    ? section.sourceNotes.map((note) => `- [[${note.title}]] (\`${note.stableId}\`)`).join("\n")
    : "- GitHub repo associations and repo-index documents";
  const stableIds = section.sourceNotes.map((note) => note.stableId);
  return {
    section_id: section.id,
    title: section.title,
    target_path: targetPath,
    tags: [...section.tags],
    source_stable_ids: stableIds,
    markdown: [
      "---",
      `title: ${section.title}`,
      "project: light-lane",
      "memory_type: current_context",
      "status: active",
      "canonical: true",
      "tags:",
      ...section.tags.map((tag) => `  - ${tag}`),
      "source: light-lane-memory-recovery",
      "source_stable_ids:",
      ...(stableIds.length ? stableIds.map((stableId) => `  - ${stableId}`) : ["  - github-repo-index"]),
      "---",
      "",
      `# ${section.title}`,
      "",
      section.body,
      "",
      "## Source Anchors",
      "",
      sourceLines,
      "",
      "## Operating Rule",
      "",
      section.id === "current_sales_state"
        ? "Use live Zoho CRM/email/calendar first when available. If live tools are unavailable, say so and rely only on structured entity states and recent source events."
        : "Keep this document project-scoped under light-lane and update it only with user-approved durable context.",
      "",
    ].join("\n"),
  };
}

function buildRepoActions(associatedRepos: string[]) {
  const presentSet = new Set(associatedRepos.map(normalizeRepo));
  const present = LIGHT_LANE_REQUIRED_REPOS.filter((repo) => presentSet.has(normalizeRepo(repo)));
  const missing = LIGHT_LANE_REQUIRED_REPOS.filter((repo) => !presentSet.has(normalizeRepo(repo)));
  return {
    required: LIGHT_LANE_REQUIRED_REPOS,
    present,
    missing,
    associate: missing.map((repo) => ({ project: "light-lane", repo })),
    index_overview: LIGHT_LANE_REQUIRED_REPOS.map((repo) => ({ project: "light-lane", repo })),
  };
}

function isMisplacedSharedLightLaneDocument(document: LightLaneRecoveryDocumentInput) {
  if (slugify(document.project) !== "shared") {
    return false;
  }
  if ((document.status ?? "active") !== "active") {
    return false;
  }
  if (!document.path.includes("/memory/shared/context/current/")) {
    return false;
  }
  const haystack = slugify(`${document.title} ${document.path} ${(document.tags ?? []).join(" ")}`);
  return [
    "light-lane",
    "fivestar",
    "five-star",
    "fully-promoted",
    "speedy-signs",
    "product-offering",
    "supplier-strategy",
    "icp",
    "target",
    "sales-enablement",
  ].some((needle) => haystack.includes(needle));
}

function isDealDocument(document: LightLaneRecoveryDocumentInput) {
  const haystack = slugify(`${document.title} ${document.path}`);
  return ["fivestar", "five-star", "fully-promoted", "speedy-signs", "deal", "opportunity"].some(
    (needle) => haystack.includes(needle),
  );
}

function normalizeDealEntityName(title: string) {
  if (/fully promoted/i.test(title)) {
    return "Fully Promoted Nelson";
  }
  if (/fivestar|five star/i.test(title)) {
    return "Fivestar Print";
  }
  if (/speedy signs/i.test(title)) {
    return "Speedy Signs Nelson";
  }
  return title.trim();
}

function isAiBrainLoaded(analysis?: LightLaneRecoveryAiBrainInput | null) {
  const counts = analysis?.counts;
  return Boolean(
    counts
      && (counts.markdown_files ?? 0) >= 63
      && (counts.wiki_links ?? 0) >= 218
      && (counts.current_context ?? 0) >= 13
      && (counts.load_first ?? 0) >= 12
      && (counts.high_priority ?? 0) >= 1,
  );
}

function normalizeRepo(repo: string) {
  return repo.trim().toLowerCase();
}

function fileNameFromPath(path: string) {
  return path.split("/").pop() ?? `${slugify(path)}.md`;
}
