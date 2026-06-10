import { loadConfig } from "~/config/env";
import { assessContextCompleteness } from "~/domain/context-completeness";
import {
  buildLogicalPath,
  isRetrievableMemoryStatus,
  normalizeProject,
  slugify,
  type AssistantSearchScope,
  type EntityAlias,
  type EntityState,
  type MemoryLayer,
  type MemoryPrincipal,
  type MemorySearchFilters,
  type MemorySearchHit,
  type ResolvedMemoryDocument,
} from "~/domain/memory";
import { computeNotCurrentEntities, markContradictedHits } from "~/domain/entity-authority";
import { rerankSearchHits } from "~/domain/ranking";
import { classifyRequest, deriveRetrievalIntent, type RetrievalIntent } from "~/domain/request-classification";
import {
  applyDocumentDiversity,
  buildRequiredContextPack,
  inferTaskProfile,
  type TaskProfile,
} from "~/domain/retrieval-policy";
import { isVisibleInProjectScope } from "~/domain/scope";
import { embedTexts } from "~/integrations/workers-ai/embeddings";
import {
  queryMemoryIndexWithDiagnostics,
} from "~/integrations/vectorize/client";
import type { DocumentRepository } from "~/persistence/d1/DocumentRepository";
import type { EntityRepository } from "~/persistence/d1/EntityRepository";
import type { InitiativeRepository } from "~/persistence/d1/InitiativeRepository";
import type { ProjectRepository } from "~/persistence/d1/ProjectRepository";

// ── Local types ──────────────────────────────────────────────────────────────

type SearchResultItem = {
  id: string;
  title: string;
  path: string;
  url: string;
  text: string;
  score: number;
  memory_type: string;
  status: string;
  project: string;
  repo?: string;
  repo_path?: string;
  source?: string;
  tags?: string[];
  heading_path: string;
  evidence_grade?: string;
  current_truth_warning?: string;
};

// ── Module-level helpers ─────────────────────────────────────────────────────

function deriveExcludeLayers(intent: RetrievalIntent): MemoryLayer[] {
  if (intent === "historical") return [];
  if (intent === "knowledge") return ["event_log"];
  if (intent === "planning" || intent === "general" || intent === "status") return ["event_log"];
  return ["event_log"];
}

function uniqueProjects(projects: Array<string | null | undefined>) {
  const normalized = projects.map((project) => normalizeProject(project)).filter(Boolean);
  return [...new Set(normalized)];
}

function buildQueryVariants(query: string) {
  return {
    intent: query,
    entities: `people companies accounts deals stores products suppliers related to ${query}`,
    initiatives: `initiatives goals blockers milestones outcomes ${query}`,
    projects: `projects repositories workstreams context ${query}`,
    recent_activity: `recent decisions tasks source events session summaries ${query}`,
  };
}

function uniqueQueryVariants(query: string) {
  const variants = buildQueryVariants(query);
  const seen = new Set<string>();
  return Object.entries(variants)
    .map(([label, variantQuery]) => ({
      label,
      query: variantQuery.trim(),
    }))
    .filter((variant) => {
      const key = variant.query.toLowerCase();
      if (!key || seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}

function semanticCandidateLimit(limit?: number) {
  return Math.max(12, Math.min((limit ?? 8) * 3, 50));
}

function dedupeSearchHitsByBestScore(hits: MemorySearchHit[]) {
  const byVectorId = new Map<string, MemorySearchHit>();
  for (const hit of hits) {
    const existing = byVectorId.get(hit.vectorId);
    if (!existing || hit.score > existing.score) {
      byVectorId.set(hit.vectorId, hit);
    }
  }

  const byDocumentHeading = new Map<string, MemorySearchHit>();
  for (const hit of byVectorId.values()) {
    const key = `${hit.documentId}:${hit.headingPath}`;
    const existing = byDocumentHeading.get(key);
    if (!existing || hit.score > existing.score) {
      byDocumentHeading.set(key, hit);
    }
  }
  return [...byDocumentHeading.values()];
}

function keywordFallbackScore(
  document: { project: string; memoryType: string; active: boolean; canonical: boolean; status: string },
  project: string,
) {
  let score = 0;
  if (document.project === project) {
    score += 4;
  }
  if (document.project === "shared") {
    score -= 1;
  }
  if (document.memoryType === "current_context") {
    score += 3;
  }
  if (document.memoryType === "decision") {
    score += 2;
  }
  if (document.active) {
    score += 1;
  }
  if (document.canonical) {
    score += 1;
  }
  if (document.status === "superseded" || document.status === "archived") {
    score -= 10;
  }
  return score;
}

// Maps keywordFallbackScore (roughly -11..+11) into a bounded 0.05..0.6
// relevance so keyword fallback results keep their relative order in
// emitted scores but never outrank strong semantic hits (which score
// higher once vector retrieval is healthy).
function keywordFallbackRelevance(
  document: { project: string; memoryType: string; active: boolean; canonical: boolean; status: string },
  project: string,
) {
  const raw = keywordFallbackScore(document, project);
  return Math.min(0.6, Math.max(0.05, 0.35 + raw * 0.02));
}

function groupSearchResults(results: SearchResultItem[]) {
  return results.reduce<Record<string, SearchResultItem[]>>((grouped, result) => {
    const key = result.memory_type;
    grouped[key] ??= [];
    grouped[key].push(result);
    return grouped;
  }, {});
}

function mergeQueryVariantDiagnostics(
  variants: Array<{ label: string; query: string; vector_hits: number }>,
) {
  const merged = new Map<string, { label: string; query: string; vector_hits: number }>();
  for (const variant of variants) {
    const existing = merged.get(variant.label);
    if (existing) {
      existing.vector_hits += variant.vector_hits;
    } else {
      merged.set(variant.label, { ...variant });
    }
  }
  return [...merged.values()];
}

function mergeCurrentTruths<
  T extends {
    guardrails: {
      current_state_required: boolean;
      exact_entity_match: boolean;
      semantic_memory_may_be_stale: boolean;
    };
    matched_aliases: unknown[];
    entities: unknown[];
    warnings: string[];
    required_live_checks: unknown[];
  },
>(truths: T[], project: string, query: string) {
  if (truths.length === 0) {
    return {
      project,
      query,
      guardrails: {
        current_state_required: isCurrentStateQuery(query),
        exact_entity_match: false,
        semantic_memory_may_be_stale: isCurrentStateQuery(query),
      },
      matched_aliases: [],
      entities: [],
      warnings: [],
      required_live_checks: [],
    };
  }
  return {
    project,
    query,
    guardrails: {
      current_state_required: truths.some((truth) => truth.guardrails.current_state_required),
      exact_entity_match: truths.some((truth) => truth.guardrails.exact_entity_match),
      semantic_memory_may_be_stale: truths.some((truth) => truth.guardrails.semantic_memory_may_be_stale),
    },
    matched_aliases: truths.flatMap((truth) => truth.matched_aliases),
    entities: truths.flatMap((truth) => truth.entities),
    warnings: [...new Set(truths.flatMap((truth) => truth.warnings))],
    required_live_checks: truths.flatMap((truth) => truth.required_live_checks),
  };
}

function statesByKey(states: EntityState[]) {
  return Object.fromEntries(
    states.map((state) => [
      state.stateKey,
      {
        id: state.id,
        value: state.value,
        status: state.status,
        confidence: state.confidence,
        source: state.source,
        source_id: state.sourceId,
        source_event_id: state.sourceEventId,
        observed_at: state.observedAt,
        valid_from: state.validFrom,
        valid_until: state.validUntil,
        updated_at: state.updatedAt,
      },
    ]),
  );
}

function isCurrentStateQuery(query: string) {
  const normalized = query.toLowerCase();
  return [
    "current",
    "latest",
    "today",
    "now",
    "quick",
    "money",
    "deal",
    "opportunity",
    "pipeline",
    "status",
    "stage",
    "blocker",
    "next action",
    "replying",
    "responding",
    "close",
    "priority",
    "left",
    "joined",
  ].some((keyword) => normalized.includes(keyword));
}

function buildCurrentTruthWarnings(input: {
  query: string;
  currentStateRequired: boolean;
  entities: Array<{ id: string; name: string }>;
  states: EntityState[];
}) {
  if (!input.currentStateRequired) {
    return [];
  }
  if (input.entities.length === 0) {
    return [
      "No exact entity alias or structured entity matched this current-state query; check live sources before making recommendations.",
    ];
  }
  const statesByEntity = new Map<string, EntityState[]>();
  for (const state of input.states) {
    statesByEntity.set(state.entityId, [...(statesByEntity.get(state.entityId) ?? []), state]);
  }
  return input.entities
    .filter(
      (entity) =>
        (statesByEntity.get(entity.id) ?? []).filter((state) => state.status === "active").length === 0,
    )
    .map(
      (entity) =>
        `No active current-state records were found for ${entity.name}; treat semantic memory as historical until live sources are checked.`,
    );
}

function currentTruthLiveChecks(query: string) {
  const reason = `Current-state query needs live verification before recommendations: ${query}`;
  return [
    {
      source_kind: "zoho_crm",
      timing: "before_recommendation",
      required: true,
      reason,
    },
    {
      source_kind: "zoho_mail",
      timing: "before_recommendation",
      required: true,
      reason,
    },
  ];
}

function documentEvidenceGrade(
  hit: Pick<MemorySearchHit, "memoryType" | "status" | "active">,
  currentTruth: {
    guardrails: { current_state_required: boolean };
    entities: Array<{ evidence_grade: string }>;
  },
) {
  if (currentTruth.guardrails.current_state_required) {
    return "historical_document";
  }
  if (!hit.active || hit.status !== "active") {
    return "historical_document";
  }
  if (hit.memoryType === "current_context" || hit.memoryType === "decision") {
    return "current_document";
  }
  return "background_document";
}

function dedupeEntities<T extends { id: string }>(entities: T[]) {
  const seen = new Set<string>();
  return entities.filter((entity) => {
    if (seen.has(entity.id)) {
      return false;
    }
    seen.add(entity.id);
    return true;
  });
}

function isPresent<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

function classifyRetrievalMode(result: unknown) {
  const diagnostics =
    result &&
    typeof result === "object" &&
    "diagnostics" in result &&
    result.diagnostics &&
    typeof result.diagnostics === "object"
      ? (result.diagnostics as Record<string, unknown>)
      : result && typeof result === "object"
        ? (result as Record<string, unknown>)
        : {};
  const vectorHits = Number(diagnostics.vector_hits ?? 0);
  const rankedVectorHits = Number(diagnostics.ranked_vector_hits ?? 0);
  const keywordHits = Number(diagnostics.keyword_hits ?? 0);
  const vectorError = diagnostics.vector_error;
  if (vectorError) {
    return "vector_error";
  }
  if (vectorHits === 0 && keywordHits > 0) {
    return "keyword_fallback_only";
  }
  if (vectorHits > 0 && rankedVectorHits === 0) {
    return "filtered_out";
  }
  if (rankedVectorHits > 0) {
    return "semantic";
  }
  return "no_hits";
}

function retrievalLikelyCauses(
  result: {
    diagnostics?: {
      vector_hits?: number;
      ranked_vector_hits?: number;
      keyword_hits?: number;
      vector_error?: string | null;
    };
  },
  stats: { document_count: number; chunk_count: number },
) {
  const causes: string[] = [];
  if (stats.document_count > 0 && stats.chunk_count === 0) {
    causes.push("Project has documents but no indexed chunks; run reindex or inspect indexing jobs.");
  }
  if (result.diagnostics?.vector_error) {
    causes.push(`Vector query failed: ${result.diagnostics.vector_error}`);
  }
  if ((result.diagnostics?.vector_hits ?? 0) === 0 && stats.chunk_count > 0) {
    causes.push(
      "Vectorize returned no semantic matches despite indexed chunks; check namespace, metadata filters, and embedding compatibility.",
    );
  }
  if (
    (result.diagnostics?.vector_hits ?? 0) > 0 &&
    (result.diagnostics?.ranked_vector_hits ?? 0) === 0
  ) {
    causes.push("Vector hits were filtered after hydration or project-scope checks.");
  }
  if (
    (result.diagnostics?.keyword_hits ?? 0) > 0 &&
    (result.diagnostics?.vector_hits ?? 0) === 0
  ) {
    causes.push(
      "Keyword fallback is carrying this query; broad conceptual recall may be weak.",
    );
  }
  return causes;
}

function truncate(text: string, maxLength: number) {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 1)}…`;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error(`Timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

// ── RetrievalService ─────────────────────────────────────────────────────────

export class RetrievalService {
  constructor(
    private readonly env: Env,
    private readonly principal: MemoryPrincipal,
    private readonly projectRepo: ProjectRepository,
    private readonly documentRepo: DocumentRepository,
    private readonly entityRepo: EntityRepository,
    private readonly initiativeRepo: InitiativeRepository,
  ) {}

  async searchMemory(input: {
    query: string;
    project?: string;
    limit?: number;
    includeSuperseded?: boolean;
    memoryTypes?: MemorySearchFilters["memoryTypes"];
    statuses?: MemorySearchFilters["statuses"];
    activeOnly?: boolean;
    authoritative?: boolean;
    repo?: string;
    path?: string;
    source?: string;
    tags?: string[];
    scope?: AssistantSearchScope;
    initiative?: string;
    entityId?: string;
    taskProfile?: TaskProfile;
    retrieval_intent?: RetrievalIntent;
  }) {
    const scope = input.scope ?? "project";
    if (scope === "project") {
      return this.searchMemoryBase(input);
    }

    const normalizedProject = normalizeProject(input.project);
    const relatedProjects = await this.resolveSearchScopeProjects({
      project: normalizedProject,
      scope,
      initiative: input.initiative,
      entityId: input.entityId,
    });
    const projectResults = await Promise.all(
      relatedProjects.map((project) =>
        this.searchMemoryBase({
          ...input,
          project,
          scope: "project",
          limit: input.limit ?? 8,
        }),
      ),
    );
    const seen = new Set<string>();
    const results = projectResults
      .flatMap((result) => result.results)
      .sort((left, right) => right.score - left.score)
      .filter((item) => {
        const key = `${item.id}:${item.heading_path}`;
        if (seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      })
      .slice(0, input.limit ?? 8);
    const currentTruths = projectResults
      .map((result) => ("current_truth" in result ? result.current_truth : null))
      .filter(isPresent);
    const taskProfile = input.taskProfile ?? inferTaskProfile(input.query);
    const requiredContextPack = buildRequiredContextPack({
      project: normalizedProject,
      taskProfile,
      userIntent: input.query,
    });
    const contextCompleteness = await this.assessContextCompletenessSafely(normalizedProject);
    const anyVectorError = projectResults.some((result) => result.diagnostics?.vector_error);
    const anyRankedHits = projectResults.some(
      (result) => (result.diagnostics?.ranked_vector_hits ?? 0) > 0,
    );

    return {
      task_profile: taskProfile,
      required_context_pack: requiredContextPack,
      degraded: anyVectorError,
      retrieval_mode: anyVectorError
        ? "keyword_fallback_degraded"
        : anyRankedHits
          ? "semantic"
          : "keyword_fallback",
      context_completeness: contextCompleteness,
      repo_coverage: contextCompleteness.repo_coverage,
      memory_quality_gates: contextCompleteness.memory_quality_gates,
      results,
      grouped: groupSearchResults(results),
      documents: projectResults.flatMap((result) => result.documents ?? []),
      current_truth: mergeCurrentTruths(currentTruths, normalizedProject, input.query),
      diagnostics: {
        vector_hits: projectResults.reduce(
          (sum, result) => sum + (result.diagnostics?.vector_hits ?? 0),
          0,
        ),
        ranked_vector_hits: projectResults.reduce(
          (sum, result) => sum + (result.diagnostics?.ranked_vector_hits ?? 0),
          0,
        ),
        keyword_hits: projectResults.reduce(
          (sum, result) => sum + (result.diagnostics?.keyword_hits ?? 0),
          0,
        ),
        vector_error:
          projectResults.find((result) => result.diagnostics?.vector_error)?.diagnostics
            ?.vector_error ?? null,
        namespaces: [
          ...new Set(projectResults.flatMap((result) => result.diagnostics?.namespaces ?? [])),
        ],
        query_variants: mergeQueryVariantDiagnostics(
          projectResults.flatMap((result) => result.diagnostics?.query_variants ?? []),
        ),
        keyword_fallback_used: projectResults.some(
          (result) => result.diagnostics?.keyword_fallback_used,
        ),
        keyword_fallback_due_to_empty_semantic: projectResults.some(
          (result) => result.diagnostics?.keyword_fallback_due_to_empty_semantic,
        ),
        scope,
        searched_projects: relatedProjects,
      },
    };
  }

  private async searchMemoryBase(input: {
    query: string;
    project?: string;
    limit?: number;
    includeSuperseded?: boolean;
    memoryTypes?: MemorySearchFilters["memoryTypes"];
    statuses?: MemorySearchFilters["statuses"];
    activeOnly?: boolean;
    authoritative?: boolean;
    repo?: string;
    path?: string;
    source?: string;
    tags?: string[];
    scope?: AssistantSearchScope;
    taskProfile?: TaskProfile;
    retrieval_intent?: RetrievalIntent;
  }) {
    const normalizedProject = normalizeProject(input.project);
    const taskProfile = input.taskProfile ?? inferTaskProfile(input.query);
    const requiredContextPack = buildRequiredContextPack({
      project: normalizedProject,
      taskProfile,
      userIntent: input.query,
    });
    const currentTruth = await this.resolveCurrentTruthInternal({
      project: normalizedProject,
      query: input.query,
      includeSuperseded: input.includeSuperseded,
    }).catch((error) => ({
      project: normalizedProject,
      query: input.query,
      guardrails: {
        current_state_required: isCurrentStateQuery(input.query),
        exact_entity_match: false,
        semantic_memory_may_be_stale: isCurrentStateQuery(input.query),
      },
      matched_aliases: [] as EntityAlias[],
      entities: [] as Array<{
        entity: NonNullable<EntityAlias["entity"]>;
        matched_aliases: EntityAlias[];
        evidence_grade: string;
        states: Record<string, unknown>;
      }>,
      warnings: [
        `Current truth resolution failed: ${error instanceof Error ? error.message : String(error)}`,
      ],
      required_live_checks: isCurrentStateQuery(input.query) ? currentTruthLiveChecks(input.query) : [],
    }));
    const namespaces =
      normalizedProject === "shared" ? ["shared"] : ["shared", normalizedProject];
    let hits: MemorySearchHit[] = [];
    let ranked: MemorySearchHit[] = [];
    let vectorError: string | null = null;
    const queryVariants = uniqueQueryVariants(input.query);
    let queryVariantDiagnostics: Array<{ label: string; query: string; vector_hits: number }> =
      queryVariants.map((variant) => ({ ...variant, vector_hits: 0 }));
    const vectorProviderDiagnostics: unknown[] = [];
    const unfilteredVectorDiagnostics: unknown[] = [];
    try {
      const activeOnly = input.activeOnly ?? !input.includeSuperseded;
      const vectorResult = await withTimeout(
        (async () => {
          const embeddings = await embedTexts(
            this.env,
            queryVariants.map((variant) => variant.query),
          );
          const variantResults = await Promise.all(
            queryVariants.map(async (variant, index) => {
              const result = await queryMemoryIndexWithDiagnostics(
                this.env,
                embeddings[index],
                namespaces,
                {
                  project: normalizedProject,
                  includeSuperseded: input.includeSuperseded,
                  memoryTypes: input.memoryTypes,
                  statuses: input.statuses,
                  activeOnly,
                  repo: input.repo,
                  path: input.path,
                  source: input.source,
                  tags: input.tags,
                  limit: input.limit,
                  candidateLimit: semanticCandidateLimit(input.limit),
                },
              );
              vectorProviderDiagnostics.push({
                label: variant.label,
                filtered: true,
                ...result.diagnostics,
              });
              return { ...variant, hits: result.hits, embedding: embeddings[index] };
            }),
          );
          if (variantResults.every((variant) => variant.hits.length === 0)) {
            const unfilteredResults = await Promise.all(
              variantResults.map(async (variant) => {
                const result = await queryMemoryIndexWithDiagnostics(
                  this.env,
                  variant.embedding,
                  namespaces,
                  {
                    project: normalizedProject,
                    includeSuperseded: input.includeSuperseded,
                    limit: input.limit,
                    candidateLimit: semanticCandidateLimit(input.limit),
                    filtered: false,
                  },
                );
                unfilteredVectorDiagnostics.push({
                  label: variant.label,
                  filtered: false,
                  ...result.diagnostics,
                });
                return { ...variant, hits: result.hits };
              }),
            );
            for (let index = 0; index < variantResults.length; index += 1) {
              variantResults[index] = unfilteredResults[index]!;
            }
          }
          queryVariantDiagnostics = variantResults.map((variant) => ({
            label: variant.label,
            query: variant.query,
            vector_hits: variant.hits.length,
          }));
          const rawVectorHits = variantResults.flatMap((variant) => variant.hits);
          const vectorHits = dedupeSearchHitsByBestScore(rawVectorHits);

          const chunkTextByVectorId = await this.documentRepo.getChunkContentsByVectorIds(
            vectorHits.map((hit) => hit.vectorId),
          );
          const documentsById = await this.documentRepo.getDocumentsByIds(
            vectorHits.map((hit) => hit.documentId),
          );
          const hydratedHits = vectorHits
            .map((hit) => ({
              ...hit,
              ...(documentsById.get(hit.documentId)
                ? {
                    title: documentsById.get(hit.documentId)!.title,
                    path: documentsById.get(hit.documentId)!.path,
                    project: documentsById.get(hit.documentId)!.project,
                    memoryType: documentsById.get(hit.documentId)!.memoryType,
                    status: documentsById.get(hit.documentId)!.status,
                    active: documentsById.get(hit.documentId)!.active,
                    superseded: documentsById.get(hit.documentId)!.status === "superseded",
                    repo: documentsById.get(hit.documentId)!.repo ?? undefined,
                    repoPath: documentsById.get(hit.documentId)!.repoPath ?? undefined,
                    tags: documentsById.get(hit.documentId)!.tags,
                    source: documentsById.get(hit.documentId)!.source ?? undefined,
                    confidence: documentsById.get(hit.documentId)!.confidence ?? undefined,
                    usefulness: documentsById.get(hit.documentId)!.usefulness ?? undefined,
                    url: documentsById.get(hit.documentId)!.permalink ?? hit.url,
                  }
                : {}),
              chunkText: chunkTextByVectorId.get(hit.vectorId) ?? hit.chunkText,
            }))
            .filter((hit) => isVisibleInProjectScope(hit, normalizedProject));

          const notCurrentEntities = await computeNotCurrentEntities(this.entityRepo, normalizedProject);
          const markedHits = markContradictedHits(hydratedHits, notCurrentEntities);
          return {
            hits: rawVectorHits,
            ranked: applyDocumentDiversity(
              rerankSearchHits(markedHits, {
                includeSuperseded: input.includeSuperseded,
                project: normalizedProject,
                repo: input.repo,
                path: input.path,
                excludeLayers: deriveExcludeLayers(
                  input.retrieval_intent ??
                    deriveRetrievalIntent(classifyRequest(input.query), input.query),
                ),
              }),
              {
                maxChunksPerDocument: 2,
                limit: input.limit ?? 8,
              },
            ),
          };
        })(),
        8_000,
      );
      hits = vectorResult.hits;
      ranked = vectorResult.ranked;
    } catch (error) {
      vectorError = error instanceof Error ? error.message : String(error);
    }

    const keywordMatches = await this.documentRepo.searchDocumentsKeyword({
      query: input.query,
      project: normalizedProject,
      limit: input.limit,
      includeSuperseded: input.includeSuperseded,
      memoryTypes: input.memoryTypes,
      repo: input.repo,
      path: input.path,
      source: input.source,
    });
    const rankedDocumentIds = new Set(ranked.map((hit) => hit.documentId));
    const keywordResults = keywordMatches
      .filter((document) => isVisibleInProjectScope(document, normalizedProject))
      .filter((document) => !rankedDocumentIds.has(document.id))
      .sort(
        (left, right) =>
          keywordFallbackScore(right, normalizedProject) -
          keywordFallbackScore(left, normalizedProject),
      )
      .slice(0, Math.max(0, (input.limit ?? 8) - ranked.length));

    const contextCompleteness = await this.assessContextCompletenessSafely(normalizedProject);
    const currentTruthWarning = currentTruth.warnings[0];
    const results = ranked
      .map((hit) => ({
        id: hit.documentId,
        title: hit.title,
        path: hit.path,
        url: hit.url ?? hit.path,
        text: truncate(hit.chunkText, 300),
        score: hit.score,
        memory_type: hit.memoryType,
        status: hit.status,
        project: hit.project,
        repo: hit.repo,
        repo_path: hit.repoPath,
        source: hit.source,
        tags: hit.tags,
        heading_path: hit.headingPath,
        evidence_grade: documentEvidenceGrade(hit, currentTruth),
        current_truth_warning: currentTruth.guardrails.current_state_required
          ? currentTruthWarning
          : undefined,
      }))
      .concat(
        keywordResults.map((document) => ({
          id: document.id,
          title: document.title,
          path: document.path,
          url: document.permalink ?? document.path,
          text: `Keyword match: ${document.title}`,
          score: keywordFallbackRelevance(document, normalizedProject),
          memory_type: document.memoryType,
          status: document.status,
          project: document.project,
          repo: document.repo ?? undefined,
          repo_path: document.repoPath ?? undefined,
          source: document.source ?? undefined,
          tags: document.tags,
          heading_path: "",
          evidence_grade: "historical_document",
          current_truth_warning: currentTruth.guardrails.current_state_required
            ? currentTruthWarning
            : undefined,
        })),
      );

    return {
      task_profile: taskProfile,
      required_context_pack: requiredContextPack,
      degraded: Boolean(vectorError),
      retrieval_mode: vectorError
        ? "keyword_fallback_degraded"
        : ranked.length > 0
          ? "semantic"
          : "keyword_fallback",
      context_completeness: contextCompleteness,
      repo_coverage: contextCompleteness.repo_coverage,
      memory_quality_gates: contextCompleteness.memory_quality_gates,
      results,
      grouped: groupSearchResults(results),
      documents: [] as ResolvedMemoryDocument[],
      current_truth: currentTruth,
      diagnostics: {
        vector_hits: hits.length,
        ranked_vector_hits: ranked.length,
        keyword_hits: keywordMatches.length,
        vector_error: vectorError,
        namespaces,
        query_variants: queryVariantDiagnostics,
        vector_provider: vectorProviderDiagnostics,
        unfiltered_vector_provider: unfilteredVectorDiagnostics,
        d1_chunk_count_for_project: await this.projectRepo
          .getProjectStats(normalizedProject)
          .then((stats) => stats.chunk_count)
          .catch(() => null),
        keyword_fallback_used: keywordResults.length > 0,
        keyword_fallback_due_to_empty_semantic: hits.length === 0 && keywordResults.length > 0,
        current_truth: {
          current_state_required: currentTruth.guardrails.current_state_required,
          exact_entity_match: currentTruth.guardrails.exact_entity_match,
          warnings: currentTruth.warnings,
          required_live_checks: currentTruth.required_live_checks,
        },
      },
    };
  }

  async retrievalDiagnostics(input: {
    query: string;
    project?: string;
    repo?: string;
    path?: string;
  }) {
    const project = normalizeProject(input.project);
    const namespaces = project === "shared" ? ["shared"] : ["shared", project];
    const stats = await this.projectRepo.getProjectStats(project);
    const result = await this.searchMemory({
      query: input.query,
      project,
      repo: input.repo,
      path: input.path,
      limit: 10,
    });
    return {
      query: input.query,
      project,
      namespaces,
      filters: {
        include_superseded: false,
        repo: input.repo,
        path: input.path,
      },
      storage_health: {
        document_count: stats.document_count,
        chunk_count: stats.chunk_count,
        likely_not_indexed: stats.document_count > 0 && stats.chunk_count === 0,
      },
      diagnostics: result.diagnostics,
      diagnostic_classification: classifyRetrievalMode(result),
      likely_causes: retrievalLikelyCauses(result, stats),
      top_results: result.results.map((item) => ({
        id: item.id,
        title: item.title,
        project: item.project,
        memory_type: item.memory_type,
        score: item.score,
        repo: item.repo,
        path: item.path,
      })),
      expanded_queries: buildQueryVariants(input.query),
      ranking_rules: [
        "exact project is boosted over shared memory",
        "current_context and decisions are boosted",
        "superseded content is excluded by default",
        "recent, useful, and confident documents receive small boosts",
        "assistant sessions expand broad requests into intent, entity, initiative, project, and recent activity queries",
      ],
    };
  }

  private async resolveSearchScopeProjects(input: {
    project: string;
    scope: AssistantSearchScope;
    initiative?: string;
    entityId?: string;
  }) {
    if (input.scope === "entity" && input.entityId) {
      const entity = await this.entityRepo.getEntity(input.entityId);
      return uniqueProjects([entity?.project, input.project]);
    }
    if (input.scope === "initiative" && input.initiative) {
      const initiative =
        (await this.initiativeRepo.getInitiativeBySlug(slugify(input.initiative))) ??
        (await this.initiativeRepo.getInitiativeById(input.initiative));
      if (initiative) {
        const projects = await this.initiativeRepo.listInitiativeProjects(initiative.id);
        return uniqueProjects([
          input.project,
          ...projects.map((project) => project.projectSlug),
        ]);
      }
    }
    if (input.scope === "all_related") {
      const related = await this.projectRepo.listRelatedProjects(input.project);
      return uniqueProjects([input.project, ...related.map((project) => project.slug)]);
    }
    return [input.project];
  }

  private async resolveCurrentTruthInternal(input: {
    project?: string;
    query: string;
    includeSuperseded?: boolean;
    limit?: number;
  }) {
    const project = normalizeProject(input.project);
    const currentStateRequired = isCurrentStateQuery(input.query);
    const aliasMatches = await this.entityRepo.searchEntityAliases({
      project,
      query: input.query,
      limit: input.limit ?? 12,
    });
    const entities = dedupeEntities([
      ...aliasMatches.map((alias) => alias.entity).filter(isPresent),
      ...(aliasMatches.length
        ? []
        : await this.entityRepo.searchEntities({
            project,
            query: input.query,
            limit: input.limit ?? 12,
          })),
    ]);
    const states = await this.entityRepo.listEntityStatesForEntities({
      project,
      entityIds: entities.map((entity) => entity.id),
      includeSuperseded: input.includeSuperseded,
    });
    const entityPayloads = entities.map((entity) => {
      const entityStates = states.filter((state) => state.entityId === entity.id);
      return {
        entity,
        matched_aliases: aliasMatches.filter((alias) => alias.entityId === entity.id),
        evidence_grade: entityStates.some((state) => state.status === "active")
          ? "current_structured"
          : "unknown",
        states: statesByKey(entityStates),
      };
    });
    const warnings = buildCurrentTruthWarnings({
      query: input.query,
      currentStateRequired,
      entities,
      states,
    });
    return {
      project,
      query: input.query,
      guardrails: {
        current_state_required: currentStateRequired,
        exact_entity_match: aliasMatches.length > 0,
        semantic_memory_may_be_stale: currentStateRequired,
      },
      matched_aliases: aliasMatches,
      entities: entityPayloads,
      warnings,
      required_live_checks:
        currentStateRequired && (warnings.length > 0 || entityPayloads.length === 0)
          ? currentTruthLiveChecks(input.query)
          : [],
    };
  }

  private async resolveCurrentTruthEntities(project: string, query: string) {
    const aliases = await this.entityRepo.searchEntityAliases({ project, query, limit: 12 });
    if (aliases.length > 0) {
      return dedupeEntities(
        aliases
          .map((alias) => alias.entity)
          .filter(
            (entity): entity is NonNullable<EntityAlias["entity"]> => Boolean(entity),
          ),
      );
    }
    return this.entityRepo.searchEntities({ project, query, limit: 12 });
  }

  async assessContextCompletenessSafely(
    input:
      | {
          project: string;
          currentContextDocuments?: Array<{
            title: string;
            path?: string | null;
            tags?: string[] | null;
          }>;
          repoFullNames?: string[];
        }
      | string,
  ) {
    const project = typeof input === "string" ? input : input.project;
    const currentContextDocuments =
      typeof input === "string" ? undefined : input.currentContextDocuments;
    const repoFullNames = typeof input === "string" ? undefined : input.repoFullNames;
    const [documents, repos] = await Promise.all([
      currentContextDocuments
        ? Promise.resolve(currentContextDocuments)
        : this.listCurrentContextDocumentsSafely(project),
      repoFullNames
        ? Promise.resolve(repoFullNames)
        : this.listProjectRepoFullNamesSafely(project),
    ]);
    return assessContextCompleteness({
      project,
      currentContextDocuments: documents,
      repoFullNames: repos,
    });
  }

  private async listCurrentContextDocumentsSafely(project: string) {
    try {
      const documents = await this.documentRepo.listCurrentContextDocuments(project);
      return documents.map((document) => ({
        title: document.title,
        path: document.path,
        tags: document.tags,
      }));
    } catch {
      return [];
    }
  }

  private async listProjectRepoFullNamesSafely(project: string) {
    try {
      const repos = await this.projectRepo.listProjectGithubRepos(project);
      return repos.map((repo) => repo.repoFullName);
    } catch {
      return [];
    }
  }
}
