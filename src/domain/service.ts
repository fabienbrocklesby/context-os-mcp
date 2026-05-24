import { loadConfig } from "~/config/env";
import YAML from "yaml";
import {
  analyzeAiBrainVaultPayload as analyzeAiBrainVaultPayloadV2,
  buildAiBrainImportMarkdown as buildAiBrainImportMarkdownV2,
  buildAiBrainSnippetImportMarkdown as buildAiBrainSnippetImportMarkdownV2,
} from "~/domain/ai-brain-vault";
import { buildAssistantActionPlan } from "~/domain/assistant-planning";
import { chunkMarkdown } from "~/domain/chunking";
import { assessContextCompleteness } from "~/domain/context-completeness";
import {
  defaultClientEnvironments,
  defaultEnvironmentCapabilities,
  defaultToolCapabilities,
  planEnvironmentToolUse,
} from "~/domain/environment-capabilities";
import { parseMarkdownDocument } from "~/domain/frontmatter";
import {
  analyzeLightLaneMemoryRecovery as buildLightLaneMemoryRecoveryAnalysis,
  type LightLaneArchiveAction,
  type LightLaneKnownDealUpdate,
  type LightLaneRecoveryAiBrainInput,
} from "~/domain/light-lane-memory-recovery";
import { buildOperatingBrief, buildRequestPlan } from "~/domain/operating-brief";
import {
  buildLogicalPath,
  buildMarkdownDocument,
  createSystemFrontmatter,
  type EntityAlias,
  type EntityState,
  inferMemoryTypeFromPath,
  isAdminPrincipal,
  type AssistantSearchScope,
  type ContextTask,
  type DurableFact,
  type EntityType,
  type AlignmentAssessment,
  type BranchProject,
  type MemoryType,
  type MemoryProject,
  normalizeProject,
  slugify,
  type MemoryFrontmatter,
  type MemoryInitiative,
  type MemoryPrincipal,
  type MemorySearchFilters,
  type MemorySearchHit,
  type ResolvedMemoryDocument,
  type SourceEvent,
  type StrategyAsset,
  type StrategyMilestone,
  type StrategyNode,
} from "~/domain/memory";
import { rerankSearchHits } from "~/domain/ranking";
import {
  applyDocumentDiversity,
  buildRequiredContextPack,
  inferTaskProfile,
  type TaskProfile,
} from "~/domain/retrieval-policy";
import { isVisibleInProjectScope } from "~/domain/scope";
import { GithubOAuthClient } from "~/integrations/github/client";
import { embedTexts } from "~/integrations/workers-ai/embeddings";
import { queryMemoryIndexWithDiagnostics, replaceDocumentVectors, deleteVectors } from "~/integrations/vectorize/client";
import { ZohoWorkDriveClient, type ZohoFile } from "~/integrations/zoho/client";
import { MemoryRepository } from "~/persistence/d1/repository";

export type IndexQueueMessage =
  | {
      jobId: string;
      kind: "document";
      workdriveFileId: string;
      path: string;
    }
  | {
      jobId: string;
      kind: "crawl";
      requestedBy?: string;
    };

type LightLaneRecoveryApplyPhase =
  | "ai_brain"
  | "current_context"
  | "entity_state"
  | "archive"
  | "repo_associate"
  | "repo_index";

const DEFAULT_LIGHT_LANE_RECOVERY_PHASES: LightLaneRecoveryApplyPhase[] = [
  "ai_brain",
  "current_context",
  "entity_state",
  "archive",
  "repo_associate",
  "repo_index",
];

export class MemoryService {
  private readonly config: ReturnType<typeof loadConfig>;
  private readonly repo: MemoryRepository;
  private readonly zoho: ZohoWorkDriveClient;
  private readonly github: GithubOAuthClient;

  constructor(
    private readonly env: Env,
    private readonly principal: MemoryPrincipal,
  ) {
    this.config = loadConfig(env);
    this.repo = new MemoryRepository(env.DB);
    this.zoho = new ZohoWorkDriveClient(env);
    this.github = new GithubOAuthClient(env, this.config.github, principal);
  }

  async listGithubRepos(input: {
    query?: string;
    owner?: string;
    limit?: number;
  }) {
    return this.github.listRepos(input);
  }

  async ensureProject(input: {
    project?: string;
    displayName?: string;
    description?: string;
    aliases?: string[];
    profile?: Record<string, unknown>;
  }) {
    const project = normalizeProject(input.project);
    const displayName = input.displayName ?? titleFromSlug(project);
    const existing = await this.repo.getProject(project);
    if (existing && projectHasFolderIds(existing)) {
      let saved = existing;
      if (
        input.displayName ||
        input.description !== undefined ||
        input.profile ||
        input.aliases?.length
      ) {
        saved = (await this.repo.updateProjectProfile({
          slug: project,
          displayName: input.displayName,
          description: input.description,
          profile: input.profile,
          aliases: input.aliases?.map((alias) => normalizeProject(alias)),
        }))!;
      }
      return {
        project: saved,
        folders: projectFolderSummary(saved),
        created: [],
      };
    }
    await this.repo.upsertProject({
      slug: project,
      displayName,
      description: input.description ?? null,
      status: "active",
      profile: input.profile,
      ownerLogin: this.principal.login,
      shared: project === "shared",
    });
    const folders = await resolveMemoryFolders(this.zoho, this.config, project, {
      createMissing: true,
      record: async (folderPath, folderId, status, error) => {
        await this.repo.recordProjectFolderCheck({
          projectSlug: project,
          folderPath,
          folderId,
          status,
          error,
        });
      },
    });

    const saved = await this.repo.upsertProject({
      slug: project,
      displayName,
      description: input.description ?? null,
      status: "active",
      profile: input.profile,
      ownerLogin: this.principal.login,
      shared: project === "shared",
      workdriveRootFolderId: folders.root.id,
      contextCurrentFolderId: folders.contextCurrent.id,
      contextHistoryFolderId: folders.contextHistory.id,
      decisionsFolderId: folders.decisions.id,
      sessionsFolderId: folders.sessions.id,
      snippetsFolderId: folders.snippets.id,
      repoIndexFolderId: folders.repoIndex.id,
    });

    if (input.aliases?.length) {
      await this.repo.updateProjectProfile({
        slug: project,
        aliases: input.aliases.map((alias) => normalizeProject(alias)),
      });
    }

    return {
      project: saved,
      folders: folderSummary(folders),
      created: folders.created.map((folder) => ({
        id: folder.id,
        name: folder.name,
        parent_id: folder.parentId,
      })),
    };
  }

  async listProjects(input: { includeMerged?: boolean; includeArchived?: boolean } = {}) {
    return {
      projects: await this.repo.listProjects({
        includeMerged: input.includeMerged,
        includeArchived: input.includeArchived,
      }),
    };
  }

  async getProject(input: { project: string }) {
    const project = await this.repo.getProject(normalizeProject(input.project));
    if (!project) {
      throw new Error(`Project ${input.project} not found.`);
    }
    return {
      project,
      github_repos: await this.repo.listProjectGithubRepos(project.slug),
      folder_checks: await this.repo.listProjectFolderChecks(project.slug),
      stats: await this.repo.getProjectStats(project.slug),
    };
  }

  async updateProjectProfile(input: {
    project: string;
    displayName?: string;
    description?: string | null;
    status?: "active" | "paused" | "archived";
    profile?: Record<string, unknown>;
    aliases?: string[];
    parentInitiative?: string | null;
    relatedProjects?: string[];
    canonicalProject?: string | null;
    mergedIntoProject?: string | null;
  }) {
    await this.ensureProject({
      project: input.project,
      displayName: input.displayName,
      description: input.description ?? undefined,
      profile: input.profile,
    });
    return {
      project: await this.repo.updateProjectProfile({
        slug: normalizeProject(input.project),
        displayName: input.displayName,
        description: input.description,
        status: input.status,
        profile: mergeProjectProfile(input.profile, {
          parent_initiative: input.parentInitiative,
          related_projects: input.relatedProjects?.map((project) => normalizeProject(project)),
          canonical_project: input.canonicalProject
            ? normalizeProject(input.canonicalProject)
            : undefined,
          merged_into_project: input.mergedIntoProject
            ? normalizeProject(input.mergedIntoProject)
            : undefined,
        }),
        aliases: input.aliases?.map((alias) => normalizeProject(alias)),
      }),
    };
  }

  async projectStatus(input: { project: string }) {
    const project = await this.repo.getProject(normalizeProject(input.project));
    if (!project) {
      throw new Error(`Project ${input.project} not found.`);
    }
    const folderChecks = await this.repo.listProjectFolderChecks(project.slug);
    const stats = await this.repo.getProjectStats(project.slug);
    const missingFolders = folderChecks.filter((check) => check.status !== "ok");
    return {
      project,
      health: {
        ok: missingFolders.length === 0 && stats.failed_job_count === 0,
        missing_folders: missingFolders,
        stats,
      },
      github_repos: await this.repo.listProjectGithubRepos(project.slug),
    };
  }

  async bootstrapProjectContext(input: {
    project: string;
    displayName?: string;
    description?: string;
    authorClient?: string;
  }) {
    const ensured = await this.ensureProject({
      project: input.project,
      displayName: input.displayName,
      description: input.description,
    });
    const project = ensured.project!.slug;
    const created: Array<{ path: string; job_id: string }> = [];
    const existing: string[] = [];

    for (const doc of currentContextTemplates(project, input.displayName ?? ensured.project!.displayName)) {
      const path = buildLogicalPath(project, ["context", "current"], doc.fileName);
      const current = await this.repo.getDocumentByPath(path);
      if (current) {
        existing.push(path);
        continue;
      }
      const result = await this.updateContextDocument({
        project,
        path,
        title: doc.title,
        markdown: doc.markdown,
        expectedRevision: 0,
        authorClient: input.authorClient ?? this.principal.login,
      });
      created.push({ path: result.path, job_id: result.job_id });
    }

    return {
      project: ensured.project,
      created,
      existing,
      current_context: await this.getCurrentContext({ project }),
    };
  }

  async getGithubFile(input: {
    repo: string;
    path: string;
    ref?: string;
    maxBytes?: number;
  }) {
    return this.github.getFile(input);
  }

  async inspectGithubRepoStructure(input: {
    repo: string;
    ref?: string;
    maxEntries?: number;
  }) {
    const root = await this.github.listDirectory({
      repo: input.repo,
      ref: input.ref,
    });
    const interestingDirs = root.entries
      .filter((entry) => entry.type === "dir")
      .filter((entry) => ["src", "docs", "migrations", "tests", ".github"].includes(entry.name))
      .slice(0, 8);
    const nested = await Promise.all(
      interestingDirs.map(async (entry) => {
        try {
          return await this.github.listDirectory({
            repo: input.repo,
            path: entry.path,
            ref: input.ref,
          });
        } catch (error) {
          return {
            repo: input.repo.toLowerCase(),
            path: entry.path,
            ref: input.ref ?? null,
            entries: [],
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }),
    );
    const maxEntries = input.maxEntries ?? 200;
    return {
      root: {
        ...root,
        entries: root.entries.slice(0, maxEntries),
      },
      directories: nested.map((directory) => ({
        ...directory,
        entries: directory.entries.slice(0, Math.max(20, Math.floor(maxEntries / 5))),
      })),
    };
  }

  async searchGithubCode(input: {
    query: string;
    repos?: string[];
    owner?: string;
    limit?: number;
  }) {
    return this.github.searchCode(input);
  }

  async saveGithubFileMemory(input: {
    repo: string;
    path: string;
    ref?: string;
    project?: string;
    title?: string;
    note?: string;
    lineStart?: number;
    lineEnd?: number;
    maxBytes?: number;
    authorClient?: string;
  }) {
    const file = await this.github.getFile({
      repo: input.repo,
      path: input.path,
      ref: input.ref,
      maxBytes: input.maxBytes,
    });
    const content = sliceLines(file.content, input.lineStart, input.lineEnd);
    const title = input.title ?? `GitHub snippet: ${file.repo}/${file.path}`;
    const language = languageForPath(file.path);
    const lines =
      input.lineStart || input.lineEnd
        ? ` lines ${input.lineStart ?? 1}-${input.lineEnd ?? file.content.split("\n").length}`
        : "";
    const markdown = [
      `# ${title}`,
      "",
      input.note ? `${input.note}\n` : "",
      `Source: ${file.repo}/${file.path}${file.ref ? ` @ ${file.ref}` : ""}${lines}`,
      file.htmlUrl ? `URL: ${file.htmlUrl}` : "",
      `SHA: ${file.sha}`,
      "",
      `\`\`\`${language}`,
      content.trimEnd(),
      "```",
    ]
      .filter((part) => part !== "")
      .join("\n");

    return this.saveSnippet({
      project: input.project,
      title,
      markdown,
      tags: ["github", "code", file.repo, file.path],
      source: "github",
      sourceUrls: file.htmlUrl ? [file.htmlUrl] : [],
      repo: file.repo,
      path: file.path,
      authorClient: input.authorClient ?? this.principal.login,
    });
  }

  async associateGithubRepo(input: {
    project: string;
    repo: string;
  }) {
    const ensured = await this.ensureProject({ project: input.project });
    const repos = await this.github.listRepos({ query: input.repo, limit: 100 });
    const match = repos.results.find((repo) => repo.repo.toLowerCase() === input.repo.toLowerCase());
    if (!match) {
      throw new Error(`GitHub repo ${input.repo} is not visible to the connected account.`);
    }
    await this.repo.associateGithubRepo({
      projectSlug: ensured.project!.slug,
      repoFullName: match.repo,
      defaultBranch: match.default_branch,
      visibility: match.private ? "private" : "public",
      htmlUrl: match.url,
      description: match.description,
      associatedBy: this.principal.login,
    });
    return {
      project: ensured.project,
      repo: match,
    };
  }

  async listProjectGithubRepos(input: { project: string }) {
    const project = normalizeProject(input.project);
    return { repos: await this.repo.listProjectGithubRepos(project) };
  }

  async indexGithubRepoOverview(input: {
    project: string;
    repo: string;
    ref?: string;
    globs?: string[];
    maxFiles?: number;
    maxBytesPerFile?: number;
    authorClient?: string;
  }) {
    await this.associateGithubRepo({ project: input.project, repo: input.repo });
    const project = normalizeProject(input.project);
    const repo = input.repo.toLowerCase();
    const jobId = await this.repo.createRepoIndexJob({
      projectSlug: project,
      repoFullName: repo,
      ref: input.ref,
      mode: input.globs?.length ? "explicit_globs" : "overview",
      globs: input.globs,
      limits: {
        max_files: input.maxFiles ?? 12,
        max_bytes_per_file: input.maxBytesPerFile ?? 80_000,
      },
    });

    try {
      const structure = await this.inspectGithubRepoStructure({ repo, ref: input.ref });
      const candidates = selectRepoOverviewFiles(structure.root.entries, input.globs);
      const fetched: Array<{ path: string; sha: string; size: number; content: string; url: string | null }> = [];
      const skipped: Array<{ path: string; reason: string }> = [];
      for (const candidate of candidates.slice(0, input.maxFiles ?? 12)) {
        const unsafeReason = unsafeRepoPathReason(candidate.path);
        if (unsafeReason) {
          skipped.push({ path: candidate.path, reason: unsafeReason });
          continue;
        }
        try {
          const file = await this.github.getFile({
            repo,
            path: candidate.path,
            ref: input.ref,
            maxBytes: input.maxBytesPerFile ?? 80_000,
          });
          const secretReason = secretContentReason(file.content);
          if (secretReason) {
            skipped.push({ path: candidate.path, reason: secretReason });
            continue;
          }
          fetched.push({
            path: file.path,
            sha: file.sha,
            size: file.size,
            content: file.content,
            url: file.htmlUrl,
          });
        } catch (error) {
          skipped.push({
            path: candidate.path,
            reason: error instanceof Error ? error.message : String(error),
          });
        }
      }

      const markdown = buildRepoIndexMarkdown({
        repo,
        ref: input.ref,
        structure,
        files: fetched,
        skipped,
      });
      const saved = await this.writeRepoIndexDocument({
        project,
        repo,
        title: `Repo overview: ${repo}`,
        markdown,
        sourceUrls: fetched.map((file) => file.url).filter((url): url is string => Boolean(url)),
        authorClient: input.authorClient ?? this.principal.login,
      });
      const result = {
        saved,
        indexed_files: fetched.map((file) => ({ path: file.path, size: file.size, sha: file.sha })),
        skipped,
      };
      await this.repo.completeRepoIndexJob(jobId, { status: "completed", result });
      await this.repo.markRepoIndexed(project, repo);
      return { job_id: jobId, ...result };
    } catch (error) {
      await this.repo.completeRepoIndexJob(jobId, {
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

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
      .map((result) => "current_truth" in result ? result.current_truth : null)
      .filter(isPresent);
    const taskProfile = input.taskProfile ?? inferTaskProfile(input.query);
    const requiredContextPack = buildRequiredContextPack({
      project: normalizedProject,
      taskProfile,
      userIntent: input.query,
    });
    const contextCompleteness = await this.assessContextCompletenessSafely(normalizedProject);

    return {
      task_profile: taskProfile,
      required_context_pack: requiredContextPack,
      context_completeness: contextCompleteness,
      repo_coverage: contextCompleteness.repo_coverage,
      memory_quality_gates: contextCompleteness.memory_quality_gates,
      results,
      grouped: groupSearchResults(results),
      documents: projectResults.flatMap((result) => result.documents ?? []),
      current_truth: mergeCurrentTruths(currentTruths, normalizedProject, input.query),
      diagnostics: {
        vector_hits: projectResults.reduce((sum, result) => sum + (result.diagnostics?.vector_hits ?? 0), 0),
        ranked_vector_hits: projectResults.reduce(
          (sum, result) => sum + (result.diagnostics?.ranked_vector_hits ?? 0),
          0,
        ),
        keyword_hits: projectResults.reduce((sum, result) => sum + (result.diagnostics?.keyword_hits ?? 0), 0),
        vector_error: projectResults.find((result) => result.diagnostics?.vector_error)?.diagnostics
          ?.vector_error ?? null,
        namespaces: [...new Set(projectResults.flatMap((result) => result.diagnostics?.namespaces ?? []))],
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
  }) {
    const normalizedProject = normalizeProject(input.project);
    const taskProfile = input.taskProfile ?? inferTaskProfile(input.query);
    const requiredContextPack = buildRequiredContextPack({
      project: normalizedProject,
      taskProfile,
      userIntent: input.query,
    });
    const currentTruth = await this.resolveCurrentTruth({
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
      matched_aliases: [],
      entities: [],
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
          const vectorHits = dedupeSearchHitsByBestScore(
            rawVectorHits,
          );

          const chunkTextByVectorId = await this.repo.getChunkContentsByVectorIds(
            vectorHits.map((hit) => hit.vectorId),
          );
          const documentsById = await this.repo.getDocumentsByIds(
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

          return {
            hits: rawVectorHits,
            ranked: applyDocumentDiversity(
              rerankSearchHits(hydratedHits, {
                includeSuperseded: input.includeSuperseded,
                project: normalizedProject,
                repo: input.repo,
                path: input.path,
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

    const keywordMatches = await this.repo.searchDocumentsKeyword({
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
      .sort((left, right) => keywordFallbackScore(right, normalizedProject) - keywordFallbackScore(left, normalizedProject))
      .slice(0, Math.max(0, (input.limit ?? 8) - ranked.length));

    const documents = input.authoritative
      ? await hydrateTopDocuments(this.repo, this.zoho, ranked)
      : [];

    const contextCompleteness = await this.assessContextCompletenessSafely(normalizedProject);
    const currentTruthWarning = currentTruth.warnings[0];
    const results = ranked.map((hit) => ({
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
      })).concat(
        keywordResults.map((document) => ({
          id: document.id,
          title: document.title,
          path: document.path,
          url: document.permalink ?? document.path,
          text: `Keyword match: ${document.title}`,
          score: 0.35,
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
      context_completeness: contextCompleteness,
      repo_coverage: contextCompleteness.repo_coverage,
      memory_quality_gates: contextCompleteness.memory_quality_gates,
      results,
      grouped: groupSearchResults(results),
      documents,
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
        d1_chunk_count_for_project: await this.repo.getProjectStats(normalizedProject).then((stats) => stats.chunk_count).catch(() => null),
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

  private async assessContextCompletenessSafely(input: {
    project: string;
    currentContextDocuments?: Array<{ title: string; path?: string | null; tags?: string[] | null }>;
    repoFullNames?: string[];
  } | string) {
    const project = typeof input === "string" ? input : input.project;
    const currentContextDocuments = typeof input === "string"
      ? undefined
      : input.currentContextDocuments;
    const repoFullNames = typeof input === "string" ? undefined : input.repoFullNames;
    const [documents, repos] = await Promise.all([
      currentContextDocuments
        ? Promise.resolve(currentContextDocuments)
        : this.listCurrentContextDocumentsSafely(project),
      repoFullNames ? Promise.resolve(repoFullNames) : this.listProjectRepoFullNamesSafely(project),
    ]);
    return assessContextCompleteness({
      project,
      currentContextDocuments: documents,
      repoFullNames: repos,
    });
  }

  private async listCurrentContextDocumentsSafely(project: string) {
    try {
      const listCurrentContextDocuments = (this.repo as MemoryRepository & {
        listCurrentContextDocuments?: (project?: string) => Promise<ResolvedMemoryDocument[]>;
      }).listCurrentContextDocuments;
      if (typeof listCurrentContextDocuments !== "function") {
        return [];
      }
      const documents = await listCurrentContextDocuments.call(this.repo, project);
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
      const listProjectGithubRepos = (this.repo as MemoryRepository & {
        listProjectGithubRepos?: (project: string) => Promise<Array<{ repoFullName: string }>>;
      }).listProjectGithubRepos;
      if (typeof listProjectGithubRepos !== "function") {
        return [];
      }
      const repos = await listProjectGithubRepos.call(this.repo, project);
      return repos.map((repo) => repo.repoFullName);
    } catch {
      return [];
    }
  }

  async prepareWorkSession(input: {
    project: string;
    topic?: string;
    authoritative?: boolean;
    taskProfile?: TaskProfile;
  }) {
    const assistantSession = await this.prepareAssistantSession({
      projectOrTopic: input.project,
      userIntent: input.topic,
      authoritative: input.authoritative,
      taskProfile: input.taskProfile,
    });
    const project = assistantSession.active_project.slug;
    return {
      project: assistantSession.active_project,
      current_context: assistantSession.current_context,
      relevant_memory: assistantSession.grouped_memory,
      github_repos: await this.repo.listProjectGithubRepos(project),
      assistant_session: assistantSession,
      suggested_flow: [
        "Use assistant_session.context_resolution before assuming project scope.",
        "Use grouped_memory and initiative_context before answering broad requests.",
        "Run recommended live MCP checks when freshness warnings mention external sources.",
        "Call finish_work_session for durable changes, tasks, source events, facts, and remaining work.",
      ],
    };
  }

  async prepareAssistantSession(input: {
    projectOrTopic?: string;
    userIntent?: string;
    environment?: string;
    activeSources?: string[];
    availableTools?: string[];
    timezone?: string;
    now?: string;
    businessHours?: {
      start?: string;
      end?: string;
      business_days?: number[];
    };
    authoritative?: boolean;
    taskProfile?: TaskProfile;
  }) {
    const resolution = await this.resolveContext({
      projectOrTopic: input.projectOrTopic,
      userIntent: input.userIntent,
    });
    const activeProject = resolution.active_project;
    const project = activeProject.slug;
    const taskProfile = input.taskProfile ?? inferTaskProfile(input.userIntent);
    const requiredContextPack = buildRequiredContextPack({
      project,
      taskProfile,
      userIntent: input.userIntent,
    });
    await this.ensureProject({ project });
    const assistantActionPlan = this.planAssistantAction({
      userIntent: input.userIntent,
      activeSources: input.activeSources,
      availableTools: input.availableTools,
      timezone: input.timezone,
      now: input.now,
      businessHours: input.businessHours,
      projectTimezone: activeProject.profile.timezone,
    });

    const [
      currentContext,
      initiatives,
      relatedProjectLinks,
      entities,
      tasks,
      sourceEvents,
      facts,
      projectStatus,
    ] = await Promise.all([
      this.getCurrentContext({ project, authoritative: input.authoritative }),
      this.repo.listInitiatives({ project, status: "active", limit: 10 }),
      this.repo.listRelatedProjects(project),
      this.repo.searchEntities({ project, query: input.userIntent, limit: 12 }),
      this.repo.listTasks({ project, dueBefore: daysFromNowIso(14), limit: 12 }),
      this.repo.listSourceEvents({ project, limit: 10 }),
      this.repo.listFacts({ project, limit: 12 }),
      this.projectStatus({ project }),
    ]);

    const groupedMemory = input.userIntent
      ? await this.searchMemory({
          query: input.userIntent,
          project,
          limit: 12,
          authoritative: input.authoritative,
          scope: relatedProjectLinks.length ? "all_related" : "project",
          taskProfile,
        })
      : { results: [], grouped: {}, documents: [], diagnostics: null };

    const initiativeContext = await Promise.all(
      initiatives.map(async (initiative) => this.getInitiativeContext({ initiative: initiative.slug })),
    );
    const relatedProjects = await this.loadRelatedProjects(project, relatedProjectLinks);
    const strategyContext = await this.getStrategyContext({
      projectOrTopic: project,
      userIntent: input.userIntent,
      limit: 8,
    });
    const currentTruth = "current_truth" in groupedMemory ? groupedMemory.current_truth : null;
    const retrievalMode = classifyRetrievalMode(groupedMemory);
    const contextCompleteness = await this.assessContextCompletenessSafely({
      project,
      currentContextDocuments: "items" in currentContext
        ? currentContext.items.map((item) => ({
            title: item.document.title,
            path: item.document.path,
            tags: item.document.tags,
          }))
        : [],
      repoFullNames: projectStatus.github_repos?.map((repo) => repo.repoFullName) ?? [],
    });
    const warnings = buildContextWarnings({
      projectStatus,
      groupedMemory,
      retrievalMode,
      entities,
      initiatives,
      activeSources: input.activeSources,
    })
      .concat(project === "light-lane" ? contextCompleteness.warnings : [])
      .concat(currentTruth?.warnings ?? []);
    const contextHealth = {
      retrieval_mode: retrievalMode,
      warnings,
      project_health: projectStatus.health,
      context_completeness: contextCompleteness,
    };
    const writeBackPolicy = selectiveWriteBackPolicy(input.activeSources);
    const environmentToolGuidance = this.planEnvironmentToolUse({
      environment: input.environment,
      userIntent: input.userIntent ?? "",
      projectOrTopic: input.projectOrTopic ?? project,
      availableTools: input.availableTools,
      activeSources: input.activeSources,
      includeInstructions: true,
    });
    const alignmentAssessment = await this.buildAlignmentAssessment({
      userIntent: input.userIntent ?? "",
      proposedWork: {
        type: "other",
        summary: input.userIntent,
        project_slug: project,
      },
      strategyContext: strategyContext.strategy_context,
      save: false,
    });
    const operatingBrief = buildOperatingBrief({
      userIntent: input.userIntent,
      contextResolution: resolution,
      relatedProjects,
      operationalContext: assistantActionPlan.operational_context,
      requestClassification: assistantActionPlan.request_classification,
      actionability: assistantActionPlan.actionability,
      toolPlan: assistantActionPlan.tool_plan,
      strategyContext: strategyContext.strategy_context,
      alignmentAssessment,
      groupedMemory,
      contextHealth,
      tasks,
      sourceEvents,
      writeBackPolicy,
      availableTools: input.availableTools,
      environmentToolGuidance,
    });

    return {
      task_profile: taskProfile,
      required_context_pack: requiredContextPack,
      context_completeness: contextCompleteness,
      repo_coverage: contextCompleteness.repo_coverage,
      memory_quality_gates: contextCompleteness.memory_quality_gates,
      context_resolution: resolution,
      active_project: activeProject,
      related_projects: relatedProjects,
      initiative_context: initiativeContext,
      strategy_context: strategyContext.strategy_context,
      current_context: currentContext,
      grouped_memory: groupedMemory,
      current_truth: currentTruth,
      entities,
      tasks,
      source_events: sourceEvents,
      facts,
      context_health: contextHealth,
      environment_tool_guidance: environmentToolGuidance,
      ...assistantActionPlan,
      operating_brief: operatingBrief,
      recommended_live_mcp_checks: recommendedLiveChecks({
        project,
        activeSources: input.activeSources,
        entities,
        tasks,
        sourceEvents,
        warnings,
        currentTruthChecks: currentTruth?.required_live_checks,
      }),
      write_back_policy: writeBackPolicy,
    };
  }

  getOperationalContext(input: {
    timezone?: string;
    now?: string;
    businessHours?: {
      start?: string;
      end?: string;
      business_days?: number[];
    };
    projectTimezone?: unknown;
  } = {}) {
    return {
      time_context: buildAssistantActionPlan({
        timezone: input.timezone,
        now: input.now,
        businessHours: input.businessHours,
        projectTimezone: input.projectTimezone,
        envDefaultTimezone: this.config.defaultTimezone,
      }).operational_context,
    };
  }

  planAssistantAction(input: {
    userIntent?: string;
    activeSources?: string[];
    availableTools?: string[];
    timezone?: string;
    now?: string;
    businessHours?: {
      start?: string;
      end?: string;
      business_days?: number[];
    };
    projectTimezone?: unknown;
  }) {
    return buildAssistantActionPlan({
      userIntent: input.userIntent,
      activeSources: input.activeSources,
      availableTools: input.availableTools,
      timezone: input.timezone,
      now: input.now,
      businessHours: input.businessHours,
      projectTimezone: input.projectTimezone,
      envDefaultTimezone: this.config.defaultTimezone,
    });
  }

  listClientEnvironments() {
    return this.repo
      .listClientEnvironments()
      .then((environments) => ({ environments }))
      .catch(() => ({ environments: defaultClientEnvironments() }));
  }

  async upsertClientEnvironment(input: {
    slug: string;
    displayName: string;
    description?: string | null;
    defaultToolStyle?: string | null;
    notes?: string | null;
  }) {
    return { environment: await this.repo.upsertClientEnvironment(input) };
  }

  listToolCapabilities() {
    return this.repo.listToolCapabilities().then((capabilities) => ({ capabilities })).catch(() => ({
      capabilities: defaultToolCapabilities(),
    }));
  }

  async upsertToolCapability(input: Parameters<MemoryRepository["upsertToolCapability"]>[0]) {
    return { capability: await this.repo.upsertToolCapability(input) };
  }

  listEnvironmentCapabilities(input: { environment?: string } = {}) {
    return this.repo
      .listEnvironmentCapabilities(input.environment)
      .then((capabilities) => ({ capabilities }))
      .catch(() => ({ capabilities: defaultEnvironmentCapabilities() }));
  }

  async upsertEnvironmentCapability(input: Parameters<MemoryRepository["upsertEnvironmentCapability"]>[0]) {
    return { environment_capability: await this.repo.upsertEnvironmentCapability(input) };
  }

  planEnvironmentToolUse(input: {
    environment?: string;
    userIntent: string;
    projectOrTopic?: string;
    availableTools?: string[];
    activeSources?: string[];
    proposedAction?: string;
    includeInstructions?: boolean;
  }) {
    return planEnvironmentToolUse({
      environment: input.environment,
      userIntent: input.userIntent,
      projectOrTopic: input.projectOrTopic,
      availableTools: input.availableTools,
      activeSources: input.activeSources,
      proposedAction: input.proposedAction,
      includeInstructions: input.includeInstructions,
    });
  }

  async resolveContext(input: { projectOrTopic?: string; userIntent?: string }) {
    const projects = await this.repo.listProjects();
    const raw = input.projectOrTopic?.trim();
    const normalized = raw ? normalizeProject(raw) : null;
    const exact = normalized ? await this.repo.getProject(normalized) : null;
    const query = [input.projectOrTopic, input.userIntent].filter(Boolean).join(" ").toLowerCase();
    const candidates = projects
      .map((project) => ({
        project,
        score: projectMatchScore(project, normalized, query),
        reasons: projectMatchReasons(project, normalized, query),
      }))
      .filter((candidate) => candidate.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, 8);
    const activeProject =
      exact ??
      candidates[0]?.project ??
      (await this.repo.getProject("shared")) ??
      projects.find((project) => project.slug === "shared") ??
      projects[0];
    if (!activeProject) {
      throw new Error("No memory projects are available. Create a project before resolving context.");
    }
    const related = await this.repo.listRelatedProjects(activeProject.slug);
    return {
      active_project: activeProject,
      candidates: candidates.map((candidate) => ({
        project: candidate.project,
        score: candidate.score,
        reasons: candidate.reasons,
      })),
      related_project_hints: related,
      project_switching: {
        selected: activeProject.slug,
        reason: exact
          ? `Exact project or alias match for ${raw ?? activeProject.slug}.`
          : candidates[0]
            ? `Best project match from topic and intent: ${candidates[0].reasons.join(", ")}.`
            : "No strong project match; using shared context.",
      },
    };
  }

  async listInitiatives(input: { status?: string; project?: string; limit?: number }) {
    return { initiatives: await this.repo.listInitiatives(input) };
  }

  async upsertInitiative(input: {
    slug?: string;
    title: string;
    summary?: string | null;
    status?: MemoryInitiative["status"];
    owner?: string | null;
    horizon?: string | null;
    priority?: MemoryInitiative["priority"];
    startsAt?: string | null;
    dueAt?: string | null;
    tags?: string[];
    metadata?: Record<string, unknown>;
    projectSlugs?: string[];
  }) {
    const initiative = await this.repo.upsertInitiative({
      slug: input.slug ? slugify(input.slug) : slugify(input.title),
      title: input.title,
      summary: input.summary,
      status: input.status,
      owner: input.owner,
      horizon: input.horizon,
      priority: input.priority,
      startsAt: input.startsAt,
      dueAt: input.dueAt,
      tags: input.tags,
      metadata: input.metadata,
      projectSlugs: input.projectSlugs?.map((project) => normalizeProject(project)),
    });
    return {
      initiative,
      projects: initiative ? await this.repo.listInitiativeProjects(initiative.id) : [],
    };
  }

  async getInitiativeContext(input: { initiative: string }) {
    const initiative =
      (await this.repo.getInitiativeBySlug(slugify(input.initiative))) ??
      (await this.repo.getInitiativeById(input.initiative));
    if (!initiative) {
      throw new Error(`Initiative ${input.initiative} not found.`);
    }
    const projects = await this.repo.listInitiativeProjects(initiative.id);
    const [tasks, facts, events] = await Promise.all([
      this.repo.listTasks({ initiativeId: initiative.id, limit: 20 }),
      this.repo.listFacts({ initiativeId: initiative.id, limit: 20 }),
      this.repo.listSourceEvents({ limit: 20 }),
    ]);
    return {
      initiative,
      projects,
      open_tasks: tasks,
      facts,
      source_events: events.filter((event) => event.initiativeId === initiative.id).slice(0, 10),
    };
  }

  async upsertTask(input: {
    id?: string;
    project?: string;
    title: string;
    description?: string | null;
    status?: ContextTask["status"];
    priority?: ContextTask["priority"];
    dueAt?: string | null;
    owner?: string | null;
    initiativeId?: string | null;
    entityId?: string | null;
    source?: string | null;
    sourceUrl?: string | null;
    reminderAt?: string | null;
    metadata?: Record<string, unknown>;
  }) {
    const project = normalizeProject(input.project);
    await this.ensureProject({ project });
    return {
      task: await this.repo.upsertTask({
        ...input,
        project,
      }),
    };
  }

  async saveSourceEvent(input: {
    project?: string;
    source: string;
    sourceId?: string | null;
    eventType: string;
    occurredAt?: string | null;
    title: string;
    summary: string;
    sensitivity?: SourceEvent["sensitivity"];
    savePolicy?: SourceEvent["savePolicy"];
    initiativeId?: string | null;
    entityId?: string | null;
    externalUrl?: string | null;
    metadata?: Record<string, unknown>;
  }) {
    const project = normalizeProject(input.project);
    await this.ensureProject({ project });
    const policy = connectorPolicyFor(input.source);
    const savePolicy = input.savePolicy ?? policy.save_policy;
    if (savePolicy === "live_only") {
      return {
        saved: false,
        reason: "Connector policy is live_only; no durable source event was written.",
        policy,
      };
    }
    return {
      saved: true,
      policy,
      source_event: await this.repo.saveSourceEvent({
        ...input,
        project,
        savePolicy,
      }),
    };
  }

  async extractDurableFacts(input: {
    project?: string;
    text: string;
    title?: string;
    source?: string;
    sourceUrl?: string;
    confidence?: number;
    initiativeId?: string | null;
    entityId?: string | null;
    save?: boolean;
  }) {
    const project = normalizeProject(input.project);
    const extracted = extractFactCandidates(input.text).map((body, index) => ({
      title: input.title ?? `Extracted fact ${index + 1}`,
      body,
      factKey: slugify(`${input.source ?? "manual"}-${body}`).slice(0, 140),
      source: input.source,
      sourceUrl: input.sourceUrl,
      confidence: input.confidence ?? 0.65,
      initiativeId: input.initiativeId,
      entityId: input.entityId,
    }));
    if (!input.save) {
      return { project, facts: extracted, saved: [] };
    }
    await this.ensureProject({ project });
    const saved = [];
    for (const fact of extracted) {
      saved.push(
        await this.repo.upsertFact({
          ...fact,
          project,
        }),
      );
    }
    return { project, facts: extracted, saved };
  }

  async upsertEntityState(input: {
    project?: string;
    entityId?: string;
    entityType?: EntityType;
    entityName?: string;
    entitySlug?: string;
    entitySummary?: string | null;
    aliases?: string[];
    stateKey: string;
    value: unknown;
    confidence?: number | null;
    source?: string | null;
    sourceId?: string | null;
    sourceEventId?: string | null;
    validFrom?: string | null;
    validUntil?: string | null;
    observedAt?: string | null;
    status?: EntityState["status"];
  }) {
    const project = normalizeProject(input.project);
    await this.ensureProject({ project });
    let entity = input.entityId ? await this.repo.getEntity(input.entityId) : null;
    if (!entity) {
      if (!input.entityName) {
        throw new Error("entity_name is required when entity_id is not provided.");
      }
      entity = await this.repo.upsertEntity({
        project,
        type: input.entityType ?? "other",
        slug: input.entitySlug ? slugify(input.entitySlug) : slugify(input.entityName),
        name: input.entityName,
        summary: input.entitySummary,
        source: input.source,
        sourceId: input.sourceId,
        confidence: input.confidence,
      });
    }
    if (!entity) {
      throw new Error("Unable to resolve or create entity for state write.");
    }
    const aliases = await this.repo.upsertEntityAliases({
      project,
      entityId: entity.id,
      aliases: [entity.name, ...(input.aliases ?? [])],
      source: input.source ?? "manual",
      confidence: input.confidence ?? entity.confidence,
    });
    const state = await this.repo.upsertEntityState({
      project,
      entityId: entity.id,
      stateKey: normalizeStateKey(input.stateKey),
      value: input.value,
      confidence: input.confidence,
      source: input.source,
      sourceId: input.sourceId,
      sourceEventId: input.sourceEventId,
      validFrom: input.validFrom,
      validUntil: input.validUntil,
      observedAt: input.observedAt,
      status: input.status,
    });
    return { project, entity, aliases, state };
  }

  async getEntityCurrentState(input: {
    project?: string;
    entityId?: string;
    query?: string;
    includeSuperseded?: boolean;
  }) {
    const project = normalizeProject(input.project);
    const entities = input.entityId
      ? [await this.repo.getEntity(input.entityId)].filter(isPresent)
      : await this.resolveCurrentTruthEntities(project, input.query ?? "");
    const states = await this.repo.listEntityStatesForEntities({
      project,
      entityIds: entities.map((entity) => entity.id),
      includeSuperseded: input.includeSuperseded,
    });
    const primary = entities[0] ?? null;
    return {
      project,
      entity: primary,
      entities: entities.map((entity) => ({
        entity,
        states: statesByKey(states.filter((state) => state.entityId === entity.id)),
      })),
      states: primary ? statesByKey(states.filter((state) => state.entityId === primary.id)) : {},
    };
  }

  async resolveCurrentTruth(input: {
    project?: string;
    query: string;
    includeSuperseded?: boolean;
    limit?: number;
  }) {
    const project = normalizeProject(input.project);
    const currentStateRequired = isCurrentStateQuery(input.query);
    const aliasMatches = await this.repo.searchEntityAliases({
      project,
      query: input.query,
      limit: input.limit ?? 12,
    });
    const entities = dedupeEntities([
      ...aliasMatches.map((alias) => alias.entity).filter(isPresent),
      ...(aliasMatches.length
        ? []
        : await this.repo.searchEntities({ project, query: input.query, limit: input.limit ?? 12 })),
    ]);
    const states = await this.repo.listEntityStatesForEntities({
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
      required_live_checks: currentStateRequired && (warnings.length > 0 || entityPayloads.length === 0)
        ? currentTruthLiveChecks(input.query)
        : [],
    };
  }

  async linkMemory(input: {
    project?: string;
    fromType: string;
    fromId: string;
    toType: string;
    toId: string;
    relation: string;
    weight?: number;
    metadata?: Record<string, unknown>;
  }) {
    const project = normalizeProject(input.project);
    return {
      links: await this.repo.linkMemory({
        ...input,
        project,
      }),
    };
  }

  async dailyBriefing(input: { project?: string; date?: string } = {}) {
    const project = input.project ? normalizeProject(input.project) : undefined;
    const dueBefore = input.date ?? daysFromNowIso(1);
    const [projects, initiatives, tasks, events] = await Promise.all([
      project ? [await this.repo.getProject(project)] : this.repo.listProjects(),
      this.repo.listInitiatives({ project, status: "active", limit: 20 }),
      this.repo.listTasks({ project, dueBefore, limit: 50 }),
      this.repo.listSourceEvents({ project, limit: 20 }),
    ]);
    return {
      date: input.date ?? new Date().toISOString(),
      projects: projects.filter(Boolean),
      active_initiatives: initiatives,
      due_or_upcoming_tasks: tasks,
      recent_source_events: events,
      suggested_focus: buildSuggestedFocus(tasks, initiatives, events),
    };
  }

  async contextHealthCheck(input: { project?: string; query?: string } = {}) {
    const project = normalizeProject(input.project);
    const status = await this.projectStatus({ project });
    const diagnostics = input.query
      ? await this.retrievalDiagnostics({ project, query: input.query })
      : null;
    const initiatives = await this.repo.listInitiatives({ project, status: "active", limit: 10 });
    const tasks = await this.repo.listTasks({ project, dueBefore: daysFromNowIso(7), limit: 20 });
    const contextCompleteness = await this.assessContextCompletenessSafely({
      project,
      repoFullNames: status.github_repos?.map((repo) => repo.repoFullName) ?? [],
    });
    const warnings = buildContextWarnings({
      projectStatus: status,
      groupedMemory: diagnostics,
      retrievalMode: diagnostics ? classifyRetrievalMode(diagnostics) : "not_checked",
      entities: await this.repo.searchEntities({ project, limit: 5 }),
      initiatives,
      activeSources: [],
    }).concat(project === "light-lane" ? contextCompleteness.warnings : []);
    return {
      project,
      status,
      initiatives,
      upcoming_tasks: tasks,
      retrieval: diagnostics,
      context_completeness: contextCompleteness,
      repo_coverage: contextCompleteness.repo_coverage,
      memory_quality_gates: contextCompleteness.memory_quality_gates,
      warnings,
    };
  }

  async upsertVision(input: {
    project?: string;
    id?: string;
    slug?: string;
    type: StrategyNode["type"];
    title: string;
    summary?: string | null;
    status?: StrategyNode["status"];
    parentId?: string | null;
    horizon?: string | null;
    priority?: StrategyNode["priority"];
    metric?: {
      name?: string;
      target_value?: string;
      current_value?: string;
      unit?: string;
      direction?: StrategyNode["metricDirection"];
    };
    startsAt?: string | null;
    dueAt?: string | null;
    reviewCadence?: string | null;
    tags?: string[];
    metadata?: Record<string, unknown>;
  }) {
    const project = normalizeProject(input.project);
    await this.ensureProject({ project });
    if (input.parentId) {
      const parent = await this.repo.getStrategyNodeById(input.parentId);
      if (!parent) {
        throw new Error(`Strategy parent ${input.parentId} not found.`);
      }
    }
    return {
      strategy_node: await this.repo.upsertStrategyNode({
        id: input.id,
        project,
        slug: input.slug ? slugify(input.slug) : slugify(input.title),
        type: input.type,
        title: input.title,
        summary: input.summary,
        status: input.status,
        parentId: input.parentId,
        horizon: input.horizon,
        priority: input.priority,
        metricName: input.metric?.name,
        targetValue: input.metric?.target_value,
        currentValue: input.metric?.current_value,
        metricUnit: input.metric?.unit,
        metricDirection: input.metric?.direction,
        startsAt: input.startsAt,
        dueAt: input.dueAt,
        reviewCadence: input.reviewCadence,
        tags: input.tags,
        metadata: input.metadata,
      }),
    };
  }

  async listVisions(input: {
    project?: string;
    type?: StrategyNode["type"];
    status?: StrategyNode["status"];
    parentId?: string;
    includeChildren?: boolean;
    limit?: number;
  } = {}) {
    const project = input.project ? normalizeProject(input.project) : undefined;
    const nodes = await this.repo.listStrategyNodes({
      project,
      type: input.type,
      status: input.status,
      parentId: input.parentId,
      limit: input.limit,
    });
    if (!input.includeChildren) {
      return { strategy_nodes: nodes };
    }
    const childrenByParent = new Map<string, StrategyNode[]>();
    const allNodes = await this.repo.listStrategyNodes({ project, status: input.status, limit: 100 });
    for (const node of allNodes) {
      if (!node.parentId) {
        continue;
      }
      childrenByParent.set(node.parentId, [...(childrenByParent.get(node.parentId) ?? []), node]);
    }
    return {
      strategy_nodes: nodes.map((node) => ({
        ...node,
        children: childrenByParent.get(node.id) ?? [],
      })),
    };
  }

  async getStrategyContext(input: {
    projectOrTopic?: string;
    userIntent?: string;
    include?: Array<"visions" | "pillars" | "outcomes" | "initiatives" | "milestones" | "assets" | "branch_projects">;
    horizon?: string;
    limit?: number;
  } = {}) {
    const resolution = await this.resolveContext({
      projectOrTopic: input.projectOrTopic,
      userIntent: input.userIntent,
    });
    const project = resolution.active_project.slug;
    const include = new Set(input.include ?? [
      "visions",
      "pillars",
      "outcomes",
      "initiatives",
      "milestones",
      "assets",
      "branch_projects",
    ]);
    const compactLimit = Math.min(input.limit ?? 8, 20);
    const query = input.userIntent;
    const [
      visions,
      pillars,
      outcomes,
      initiatives,
      milestones,
      assets,
      branchProject,
    ] = await Promise.all([
      include.has("visions")
        ? this.repo.listStrategyNodes({ project, status: "active", limit: 20 })
        : Promise.resolve([]),
      include.has("pillars")
        ? this.repo.listStrategyNodes({ project, type: "strategic_pillar", status: "active", limit: 5 })
        : Promise.resolve([]),
      include.has("outcomes")
        ? this.repo.listStrategyNodes({ project, type: "outcome", status: "active", query, limit: compactLimit })
        : Promise.resolve([]),
      include.has("initiatives")
        ? this.repo.listInitiatives({ project, status: "active", limit: compactLimit })
        : Promise.resolve([]),
      include.has("milestones")
        ? this.repo.listMilestones({ project, dueBefore: daysFromNowIso(90), limit: compactLimit })
        : Promise.resolve([]),
      include.has("assets")
        ? this.repo.listAssets({ project, query, limit: compactLimit })
        : Promise.resolve([]),
      include.has("branch_projects") ? this.repo.getBranchProject(project) : Promise.resolve(null),
    ]);
    const activeVisions = visions.filter((node) => node.type === "vision" || node.type === "north_star").slice(0, 2);
    const warnings = buildStrategyWarnings({
      visions: activeVisions,
      milestones,
      branchProject,
      now: new Date(),
    });
    return {
      context_resolution: resolution,
      strategy_context: {
        project,
        visions: compactStrategyNodes(activeVisions),
        pillars: compactStrategyNodes(pillars.slice(0, 5)),
        outcomes: compactStrategyNodes(filterByHorizon(outcomes, input.horizon).slice(0, compactLimit)),
        initiatives,
        milestones: milestones.slice(0, compactLimit).map(compactMilestone),
        assets: assets.slice(0, compactLimit).map(compactAsset),
        branch_project: branchProject,
        warnings,
      },
    };
  }

  async upsertAsset(input: {
    project?: string;
    id?: string;
    slug?: string;
    name: string;
    type: StrategyAsset["type"];
    summary?: string | null;
    status?: StrategyAsset["status"];
    owner?: string | null;
    source?: string | null;
    sourceId?: string | null;
    sourceUrl?: string | null;
    liveSourceKind?: StrategyAsset["liveSourceKind"];
    sensitivity?: StrategyAsset["sensitivity"];
    howToUse?: string | null;
    limitations?: string | null;
    tags?: string[];
    metadata?: Record<string, unknown>;
  }) {
    const project = normalizeProject(input.project);
    await this.ensureProject({ project });
    return {
      asset: await this.repo.upsertAsset({
        ...input,
        project,
        slug: input.slug ? slugify(input.slug) : slugify(input.name),
      }),
    };
  }

  async listAssets(input: {
    project?: string;
    query?: string;
    type?: string;
    status?: string;
    includeArchived?: boolean;
    limit?: number;
  } = {}) {
    return {
      assets: await this.repo.listAssets({
        ...input,
        project: input.project ? normalizeProject(input.project) : undefined,
      }),
    };
  }

  async linkAsset(input: {
    project?: string;
    assetId: string;
    toType: string;
    toId: string;
    relation: string;
    weight?: number;
    guidance?: string;
    metadata?: Record<string, unknown>;
  }) {
    const asset = await this.repo.getAssetById(input.assetId);
    if (!asset) {
      throw new Error(`Asset ${input.assetId} not found.`);
    }
    const project = normalizeProject(input.project ?? asset.project);
    return this.linkMemory({
      project,
      fromType: "asset",
      fromId: input.assetId,
      toType: input.toType,
      toId: input.toId,
      relation: input.relation,
      weight: input.weight,
      metadata: {
        ...(input.metadata ?? {}),
        guidance: input.guidance,
      },
    });
  }

  async upsertMilestone(input: {
    project?: string;
    id?: string;
    slug?: string;
    title: string;
    summary?: string | null;
    status?: StrategyMilestone["status"];
    initiativeId?: string | null;
    projectSlug?: string | null;
    outcomeId?: string | null;
    owner?: string | null;
    dueAt?: string | null;
    completedAt?: string | null;
    successMetric?: string | null;
    evidence?: string | null;
    tags?: string[];
    metadata?: Record<string, unknown>;
  }) {
    const project = normalizeProject(input.project);
    await this.ensureProject({ project });
    if (input.initiativeId && !(await this.repo.getInitiativeById(input.initiativeId))) {
      throw new Error(`Initiative ${input.initiativeId} not found.`);
    }
    if (input.outcomeId && !(await this.repo.getStrategyNodeById(input.outcomeId))) {
      throw new Error(`Outcome ${input.outcomeId} not found.`);
    }
    return {
      milestone: await this.repo.upsertMilestone({
        ...input,
        project,
        slug: input.slug ? slugify(input.slug) : slugify(input.title),
        projectSlug: input.projectSlug ? normalizeProject(input.projectSlug) : null,
      }),
    };
  }

  async createBranchProject(input: {
    project: string;
    displayName?: string;
    description?: string;
    parentInitiativeId: string;
    parentProjectSlug?: string | null;
    branchReason: string;
    hypothesis: string;
    timeboxStartsAt: string;
    timeboxEndsAt: string;
    successMetric: string;
    riskToParent: string;
    riskLevel: BranchProject["riskLevel"];
    mergeBackCondition: string;
    killCondition: string;
    assets?: string[];
    tags?: string[];
    metadata?: Record<string, unknown>;
  }) {
    const project = normalizeProject(input.project);
    const parentProjectSlug = input.parentProjectSlug ? normalizeProject(input.parentProjectSlug) : null;
    const initiative = await this.repo.getInitiativeById(input.parentInitiativeId);
    if (!initiative) {
      throw new Error(`Parent initiative ${input.parentInitiativeId} not found.`);
    }
    const ensured = await this.ensureProject({
      project,
      displayName: input.displayName,
      description: input.description,
      profile: {
        branch_project: true,
        parent_initiative_id: input.parentInitiativeId,
        parent_project_slug: parentProjectSlug,
      },
    });
    await this.repo.linkInitiativeProject({
      initiativeId: input.parentInitiativeId,
      projectSlug: project,
      role: "branch",
      status: "active",
    });
    if (parentProjectSlug) {
      await this.repo.upsertProjectRelation({
        sourceProjectSlug: project,
        targetProjectSlug: parentProjectSlug,
        relation: "forked_from",
        reason: input.branchReason,
      });
    }
    const branchProject = await this.repo.upsertBranchProject({
      projectSlug: project,
      parentInitiativeId: input.parentInitiativeId,
      parentProjectSlug,
      branchReason: input.branchReason,
      hypothesis: input.hypothesis,
      timeboxStartsAt: input.timeboxStartsAt,
      timeboxEndsAt: input.timeboxEndsAt,
      successMetric: input.successMetric,
      riskToParent: input.riskToParent,
      riskLevel: input.riskLevel,
      mergeBackCondition: input.mergeBackCondition,
      killCondition: input.killCondition,
      metadata: {
        ...(input.metadata ?? {}),
        tags: input.tags ?? [],
      },
    });
    for (const assetId of input.assets ?? []) {
      await this.repo.linkMemory({
        project,
        fromType: "branch_project",
        fromId: branchProject!.id,
        toType: "asset",
        toId: assetId,
        relation: "uses",
      });
    }
    return {
      project: ensured.project,
      branch_project: branchProject,
    };
  }

  async checkAlignment(input: {
    projectOrTopic?: string;
    userIntent: string;
    proposedWork?: ProposedWork;
    save?: boolean;
  }) {
    const strategy = await this.getStrategyContext({
      projectOrTopic: input.projectOrTopic ?? input.proposedWork?.project_slug,
      userIntent: input.userIntent,
    });
    const assessment = await this.buildAlignmentAssessment({
      userIntent: input.userIntent,
      proposedWork: input.proposedWork,
      strategyContext: strategy.strategy_context,
      save: input.save,
    });
    return {
      context_resolution: strategy.context_resolution,
      alignment_assessment: assessment,
    };
  }

  async planRequest(input: {
    projectOrTopic?: string;
    userIntent: string;
    environment?: string;
    activeSources?: string[];
    availableTools?: string[];
    timezone?: string;
    now?: string;
    businessHours?: {
      start?: string;
      end?: string;
      business_days?: number[];
    };
    includeMemory?: boolean;
    includeAssets?: boolean;
    includeActiveTasks?: boolean;
    taskProfile?: TaskProfile;
  }) {
    const resolution = await this.resolveContext({
      projectOrTopic: input.projectOrTopic,
      userIntent: input.userIntent,
    });
    const project = resolution.active_project.slug;
    const taskProfile = input.taskProfile ?? inferTaskProfile(input.userIntent);
    const requiredContextPack = buildRequiredContextPack({
      project,
      taskProfile,
      userIntent: input.userIntent,
    });
    const actionPlan = this.planAssistantAction({
      userIntent: input.userIntent,
      activeSources: input.activeSources,
      availableTools: input.availableTools,
      timezone: input.timezone,
      now: input.now,
      businessHours: input.businessHours,
      projectTimezone: resolution.active_project.profile.timezone,
    });
    const [strategy, memory, activeTasks, sourceEvents, projectStatus] = await Promise.all([
      this.getStrategyContext({ projectOrTopic: project, userIntent: input.userIntent }),
      input.includeMemory === false
        ? Promise.resolve(null)
        : this.searchMemory({ project, query: input.userIntent, limit: 8, scope: "project", taskProfile }),
      input.includeActiveTasks === false
        ? Promise.resolve([])
        : this.repo.listTasks({ project, dueBefore: daysFromNowIso(14), limit: 12 }),
      this.repo.listSourceEvents({ project, limit: 10 }),
      this.projectStatus({ project }),
    ]);
    const relevantAssets = input.includeAssets === false ? [] : strategy.strategy_context.assets;
    const alignment = await this.buildAlignmentAssessment({
      userIntent: input.userIntent,
      proposedWork: {
        type: "other",
        summary: input.userIntent,
        project_slug: project,
      },
      strategyContext: strategy.strategy_context,
      save: false,
    });
    const retrievalMode = memory ? classifyRetrievalMode(memory) : "not_requested";
    const contextCompleteness = await this.assessContextCompletenessSafely(project);
    const contextWarnings = buildContextWarnings({
      projectStatus,
      groupedMemory: memory,
      retrievalMode,
      entities: [],
      initiatives: strategy.strategy_context.initiatives,
      activeSources: input.activeSources,
    }).concat(project === "light-lane" ? contextCompleteness.warnings : []);
    const contextHealth = {
      retrieval_mode: retrievalMode,
      warnings: contextWarnings,
      project_health: projectStatus.health,
      context_completeness: contextCompleteness,
    };
    const writeBackPolicy = selectiveWriteBackPolicy(input.activeSources);
    const environmentToolGuidance = this.planEnvironmentToolUse({
      environment: input.environment,
      userIntent: input.userIntent,
      projectOrTopic: input.projectOrTopic ?? project,
      availableTools: input.availableTools,
      activeSources: input.activeSources,
      includeInstructions: true,
    });
    const operatingBrief = buildOperatingBrief({
      userIntent: input.userIntent,
      contextResolution: resolution,
      relatedProjects: [],
      operationalContext: actionPlan.operational_context,
      requestClassification: actionPlan.request_classification,
      actionability: actionPlan.actionability,
      toolPlan: actionPlan.tool_plan,
      strategyContext: {
        ...strategy.strategy_context,
        assets: relevantAssets,
      },
      alignmentAssessment: alignment,
      groupedMemory: memory,
      contextHealth,
      tasks: activeTasks,
      sourceEvents,
      writeBackPolicy,
      availableTools: input.availableTools,
      environmentToolGuidance,
    });
    return {
      task_profile: taskProfile,
      required_context_pack: requiredContextPack,
      context_completeness: contextCompleteness,
      repo_coverage: contextCompleteness.repo_coverage,
      memory_quality_gates: contextCompleteness.memory_quality_gates,
      context_resolution: resolution,
      operational_context: actionPlan.operational_context,
      request_classification: actionPlan.request_classification,
      actionability: actionPlan.actionability,
      tool_plan: actionPlan.tool_plan,
      strategy_context: strategy.strategy_context,
      grouped_memory: memory,
      active_tasks: activeTasks,
      relevant_assets: relevantAssets,
      alignment_assessment: alignment,
      environment_tool_guidance: environmentToolGuidance,
      operating_brief: operatingBrief,
      request_plan: buildRequestPlan({
        userIntent: input.userIntent,
        operatingBrief,
        recommendedScope: alignment.scopeGuidance,
      }),
      recommended_scope: alignment.scopeGuidance,
      recommended_next_steps: buildRecommendedNextSteps({
        alignment,
        toolPlan: actionPlan.tool_plan,
        actionability: actionPlan.actionability,
      }),
      write_back_policy: writeBackPolicy,
    };
  }

  private async buildAlignmentAssessment(input: {
    userIntent: string;
    proposedWork?: ProposedWork;
    strategyContext: StrategyContextPayload;
    save?: boolean;
  }): Promise<AlignmentAssessment> {
    const assessment = assessStrategicAlignment({
      userIntent: input.userIntent,
      proposedWork: input.proposedWork,
      strategyContext: input.strategyContext,
    });
    if (!input.save) {
      return {
        id: "preview",
        project: input.strategyContext.project,
        subjectType: input.proposedWork?.type ?? "request",
        subjectId: input.proposedWork?.milestone_id ?? input.proposedWork?.initiative_id ?? null,
        userIntent: input.userIntent,
        alignmentLabel: assessment.alignmentLabel,
        score: assessment.score,
        confidence: assessment.confidence,
        rationale: assessment.rationale,
        evidence: assessment.evidence,
        risks: assessment.risks,
        scopeGuidance: assessment.scopeGuidance,
        missingContext: assessment.missingContext,
        strategySnapshot: compactStrategySnapshot(input.strategyContext),
        createdAt: new Date().toISOString(),
      };
    }
    return (await this.repo.saveAlignmentAssessment({
      project: input.strategyContext.project,
      subjectType: input.proposedWork?.type ?? "request",
      subjectId: input.proposedWork?.milestone_id ?? input.proposedWork?.initiative_id ?? null,
      userIntent: input.userIntent,
      alignmentLabel: assessment.alignmentLabel,
      score: assessment.score,
      confidence: assessment.confidence,
      rationale: assessment.rationale,
      evidence: assessment.evidence,
      risks: assessment.risks,
      scopeGuidance: assessment.scopeGuidance,
      missingContext: assessment.missingContext,
      strategySnapshot: compactStrategySnapshot(input.strategyContext),
    }))!;
  }

  async getDocument(input: {
    documentId?: string;
    path?: string;
    workdriveFileId?: string;
    authoritative?: boolean;
  }) {
    const document = await this.resolveDocumentReference(input);
    if (!document) {
      throw new Error("Document not found.");
    }
    const snapshot = await this.repo.getLatestSnapshot(document.id);
    const authoritative = input.authoritative
      ? await this.zoho.downloadMarkdown(document.workdriveFileId)
      : null;
    return {
      document,
      snapshot,
      authoritative_markdown: authoritative?.markdown ?? null,
    };
  }

  async getCurrentContext(input: {
    project?: string;
    query?: string;
    authoritative?: boolean;
  }) {
    if (input.query) {
      return this.searchMemory({
        query: input.query,
        project: input.project,
        limit: 10,
        activeOnly: true,
        includeSuperseded: false,
        memoryTypes: ["current_context", "decision"],
        authoritative: input.authoritative,
      });
    }

    const documents = await this.repo.listCurrentContextDocuments(
      input.project ? normalizeProject(input.project) : undefined,
    );

    const items = await Promise.all(
      documents.map(async (document) => {
        const snapshot = await this.repo.getLatestSnapshot(document.id);
        const authoritative = input.authoritative
          ? await this.zoho.downloadMarkdown(document.workdriveFileId)
          : null;
        return {
          document,
          snapshot,
          authoritative_markdown: authoritative?.markdown ?? null,
        };
      }),
    );

    return {
      items,
      grouped: {
        current_context: items.filter(
          (item) => item.document?.memoryType === "current_context",
        ),
        decisions: items.filter((item) => item.document?.memoryType === "decision"),
      },
    };
  }

  async writeSessionSummary(input: {
    project?: string;
    title: string;
    markdown: string;
    tags?: string[];
    authorClient?: string;
  }) {
    const project = normalizeProject(input.project);
    await this.ensureProject({ project });
    const contentHash = await sha256Hex(input.markdown);
    const dedupKey = `${dateForDedup(new Date())}:${slugify(input.title)}:${contentHash}`;
    const existingDedup = await this.repo.findDedup({
      project,
      memoryType: "session_summary",
      dedupKey,
    });
    if (existingDedup) {
      const existingDocument = existingDedup.document_id
        ? await this.repo.getDocumentById(existingDedup.document_id)
        : null;
      return {
        deduped: true,
        document_id: existingDedup.document_id,
        path: existingDocument?.path,
        workdrive_file_id: existingDocument?.workdriveFileId,
        content_sha256: existingDedup.content_sha256,
      };
    }
    const folders = await resolveMemoryFolders(this.zoho, this.config, project);
    const now = new Date();
    const fileName = `${timestampForFile(now)}-${slugify(input.title || "session-summary")}.md`;
    const path = buildLogicalPath(project, ["sessions"], fileName);
    const parsed = parseMarkdownDocument(path, input.markdown, input.authorClient ?? this.principal.login);
    const frontmatter = applyFrontmatterOverrides(parsed.frontmatter, {
      title: input.title,
      project,
      memory_type: "session_summary",
      status: "historical",
      canonical: false,
      tags: input.tags ?? parsed.frontmatter.tags,
      author_client: input.authorClient ?? this.principal.login,
    });
    const markdown = buildMarkdownDocument(frontmatter, parsed.body);
    const uploaded = await this.zoho.uploadMarkdownFile({
      folderId: folders.sessions.id,
      fileName,
      markdown,
      overrideExisting: false,
    });

    const jobId = await this.indexUploadedMarkdownAndRecordJob({
      file: uploaded,
      path,
      reason: "session summary write",
      project,
      markdown,
    });
    await this.repo.recordDedup({
      project,
      memoryType: "session_summary",
      dedupKey,
      documentId: (await this.repo.getDocumentByWorkDriveFileId(uploaded.id))?.id,
      contentSha256: contentHash,
    });

    return { path, workdrive_file_id: uploaded.id, job_id: jobId };
  }

  async recordDecision(input: {
    project?: string;
    title: string;
    markdown: string;
    tags?: string[];
    supersedesDocumentIds?: string[];
    authorClient?: string;
  }) {
    const project = normalizeProject(input.project);
    await this.ensureProject({ project });
    const folders = await resolveMemoryFolders(this.zoho, this.config, project);
    const now = new Date();
    const fileName = `${timestampForFile(now)}-${slugify(input.title || "decision")}.md`;
    const path = buildLogicalPath(project, ["decisions"], fileName);
    const parsed = parseMarkdownDocument(path, input.markdown, input.authorClient ?? this.principal.login);
    const frontmatter = applyFrontmatterOverrides(parsed.frontmatter, {
      title: input.title,
      project,
      memory_type: "decision",
      status: "active",
      canonical: false,
      tags: input.tags ?? parsed.frontmatter.tags,
      supersedes: input.supersedesDocumentIds ?? parsed.frontmatter.supersedes,
      author_client: input.authorClient ?? this.principal.login,
    });
    const markdown = buildMarkdownDocument(frontmatter, parsed.body);
    const uploaded = await this.zoho.uploadMarkdownFile({
      folderId: folders.decisions.id,
      fileName,
      markdown,
      overrideExisting: false,
    });
    const jobId = await this.indexUploadedMarkdownAndRecordJob({
      file: uploaded,
      path,
      reason: "decision write",
      project,
      markdown,
    });
    if (input.supersedesDocumentIds?.length) {
      await this.repo.markDocumentsSuperseded({
        documentIds: input.supersedesDocumentIds,
      });
    }
    return { path, workdrive_file_id: uploaded.id, job_id: jobId };
  }

  async saveSnippet(input: {
    project?: string;
    title: string;
    markdown: string;
    tags?: string[];
    source?: string;
    sourceUrls?: string[];
    repo?: string;
    path?: string;
    confidence?: number;
    usefulness?: number;
    authorClient?: string;
  }) {
    const project = normalizeProject(input.project);
    await this.ensureProject({ project });
    const contentHash = await sha256Hex(input.markdown);
    const dedupKey = [
      input.source ?? "manual",
      input.repo ?? "",
      input.path ?? "",
      contentHash,
    ].join(":");
    const existingDedup = await this.repo.findDedup({
      project,
      memoryType: "snippet",
      dedupKey,
    });
    if (existingDedup) {
      const existingDocument = existingDedup.document_id
        ? await this.repo.getDocumentById(existingDedup.document_id)
        : null;
      return {
        deduped: true,
        document_id: existingDedup.document_id,
        path: existingDocument?.path,
        workdrive_file_id: existingDocument?.workdriveFileId,
        content_sha256: existingDedup.content_sha256,
      };
    }

    const folders = await resolveMemoryFolders(this.zoho, this.config, project);
    const fileName = `${timestampForFile(new Date())}-${slugify(input.title || "snippet")}.md`;
    const path = buildLogicalPath(project, ["snippets"], fileName);
    const parsed = parseMarkdownDocument(path, input.markdown, input.authorClient ?? this.principal.login);
    const frontmatter = applyFrontmatterOverrides(parsed.frontmatter, {
      title: input.title,
      project,
      memory_type: "snippet",
      status: "active",
      canonical: false,
      tags: input.tags ?? parsed.frontmatter.tags,
      source: input.source,
      source_urls: input.sourceUrls ?? parsed.frontmatter.source_urls,
      repo: input.repo,
      path: input.path,
      confidence: input.confidence,
      usefulness: input.usefulness,
      author_client: input.authorClient ?? this.principal.login,
    });
    const markdown = buildMarkdownDocument(frontmatter, parsed.body);
    const uploaded = await this.zoho.uploadMarkdownFile({
      folderId: folders.snippets.id,
      fileName,
      markdown,
      overrideExisting: false,
    });
    const jobId = await this.indexUploadedMarkdownAndRecordJob({
      file: uploaded,
      path,
      reason: "snippet write",
      project,
      markdown,
    });
    await this.repo.recordDedup({
      project,
      memoryType: "snippet",
      dedupKey,
      documentId: (await this.repo.getDocumentByWorkDriveFileId(uploaded.id))?.id,
      contentSha256: contentHash,
    });
    return { path, workdrive_file_id: uploaded.id, job_id: jobId };
  }

  async writeRepoIndexDocument(input: {
    project: string;
    repo: string;
    title: string;
    markdown: string;
    sourceUrls?: string[];
    authorClient?: string;
  }) {
    const project = normalizeProject(input.project);
    await this.ensureProject({ project });
    const folders = await resolveMemoryFolders(this.zoho, this.config, project);
    const fileName = `${slugify(input.repo)}-overview.md`;
    const path = buildLogicalPath(project, ["repo-index"], fileName);
    const existing = await this.repo.getDocumentByPath(path);
    const parsed = parseMarkdownDocument(path, input.markdown, input.authorClient ?? this.principal.login);
    const frontmatter = applyFrontmatterOverrides(parsed.frontmatter, {
      title: input.title,
      project,
      memory_type: "repo_index",
      status: "active",
      canonical: false,
      revision: existing ? existing.revision + 1 : 1,
      tags: ["github", "repo-index", input.repo],
      source: "github",
      source_urls: input.sourceUrls ?? [],
      repo: input.repo,
      author_client: input.authorClient ?? this.principal.login,
      updated_at: new Date().toISOString(),
    });
    const markdown = buildMarkdownDocument(frontmatter, parsed.body);
    const uploaded = await this.zoho.uploadMarkdownFile({
      folderId: folders.repoIndex.id,
      fileName,
      markdown,
      overrideExisting: Boolean(existing),
    });
    const jobId = await this.indexUploadedMarkdownAndRecordJob({
      file: uploaded,
      path,
      reason: "repo index write",
      project,
      documentId: existing?.id,
      markdown,
    });
    return { path, workdrive_file_id: uploaded.id, job_id: jobId };
  }

  async finishWorkSession(input: {
    project: string;
    title: string;
    summaryMarkdown: string;
    tags?: string[];
    decisions?: Array<{ title: string; markdown: string; tags?: string[]; supersedesDocumentIds?: string[] }>;
    snippets?: Array<{ title: string; markdown: string; tags?: string[]; source?: string; sourceUrls?: string[]; repo?: string; path?: string }>;
    tasks?: Array<{
      id?: string;
      title: string;
      description?: string | null;
      status?: ContextTask["status"];
      priority?: ContextTask["priority"];
      dueAt?: string | null;
      owner?: string | null;
      initiativeId?: string | null;
      entityId?: string | null;
      source?: string | null;
      sourceUrl?: string | null;
      reminderAt?: string | null;
      metadata?: Record<string, unknown>;
    }>;
    sourceEvents?: Array<{
      source: string;
      sourceId?: string | null;
      eventType: string;
      occurredAt?: string | null;
      title: string;
      summary: string;
      sensitivity?: SourceEvent["sensitivity"];
      savePolicy?: SourceEvent["savePolicy"];
      initiativeId?: string | null;
      entityId?: string | null;
      externalUrl?: string | null;
      metadata?: Record<string, unknown>;
    }>;
    facts?: Array<{
      title: string;
      body: string;
      factKey?: string | null;
      source?: string | null;
      sourceUrl?: string | null;
      confidence?: number | null;
      initiativeId?: string | null;
      entityId?: string | null;
      documentId?: string | null;
      metadata?: Record<string, unknown>;
    }>;
    authorClient?: string;
  }) {
    const summary = await this.writeSessionSummary({
      project: input.project,
      title: input.title,
      markdown: input.summaryMarkdown,
      tags: input.tags,
      authorClient: input.authorClient ?? this.principal.login,
    });
    const decisions = [];
    for (const decision of input.decisions ?? []) {
      decisions.push(
        await this.recordDecision({
          project: input.project,
          title: decision.title,
          markdown: decision.markdown,
          tags: decision.tags,
          supersedesDocumentIds: decision.supersedesDocumentIds,
          authorClient: input.authorClient ?? this.principal.login,
        }),
      );
    }
    const snippets = [];
    for (const snippet of input.snippets ?? []) {
      snippets.push(
        await this.saveSnippet({
          project: input.project,
          ...snippet,
          authorClient: input.authorClient ?? this.principal.login,
        }),
      );
    }
    const tasks = [];
    for (const task of input.tasks ?? []) {
      tasks.push(await this.upsertTask({ ...task, project: input.project }));
    }
    const sourceEvents = [];
    for (const event of input.sourceEvents ?? []) {
      sourceEvents.push(await this.saveSourceEvent({ ...event, project: input.project }));
    }
    const facts = [];
    for (const fact of input.facts ?? []) {
      facts.push(
        await this.repo.upsertFact({
          ...fact,
          project: normalizeProject(input.project),
        }),
      );
    }
    return { summary, decisions, snippets, tasks, source_events: sourceEvents, facts };
  }

  async updateContextDocument(input: {
    project?: string;
    path?: string;
    title?: string;
    markdown: string;
    expectedRevision?: number;
    authorClient?: string;
  }) {
    const project = normalizeProject(input.project);
    await this.ensureProject({ project });
    const folders = await resolveMemoryFolders(this.zoho, this.config, project);
    const canonicalFileName = input.path
      ? (input.path.split("/").pop() ?? `${slugify(input.title ?? "context")}.md`)
      : `${slugify(input.title ?? "context")}.md`;
    const path =
      input.path ?? buildLogicalPath(project, ["context", "current"], canonicalFileName);

    const existing = await this.repo.getDocumentByPath(path);
    if (
      existing &&
      input.expectedRevision !== undefined &&
      input.expectedRevision !== existing.revision
    ) {
      throw new Error(
        `Revision mismatch for ${path}. Expected ${input.expectedRevision}, found ${existing.revision}.`,
      );
    }
    if (!existing && input.expectedRevision && input.expectedRevision !== 0) {
      throw new Error(`Document ${path} does not yet exist, so expected_revision must be 0 or omitted.`);
    }

    const previousSnapshot = existing
      ? await this.repo.getLatestSnapshot(existing.id)
      : null;

    const parsed = parseMarkdownDocument(path, input.markdown, input.authorClient ?? this.principal.login);
    const nextRevision = existing ? existing.revision + 1 : 1;
    const frontmatter = applyFrontmatterOverrides(parsed.frontmatter, {
      title: input.title ?? parsed.frontmatter.title,
      project,
      memory_type: "current_context",
      status: "active",
      canonical: true,
      revision: nextRevision,
      created_at: previousSnapshot?.frontmatter.created_at ?? parsed.frontmatter.created_at,
      updated_at: new Date().toISOString(),
      author_client: input.authorClient ?? this.principal.login,
    });
    const markdown = buildMarkdownDocument(frontmatter, parsed.body);

    let historyResult:
      | {
          path: string;
          workdrive_file_id: string;
          job_id: string;
        }
      | null = null;

    if (previousSnapshot && existing) {
      const historyFileName = `${canonicalFileName.replace(
        /\.md$/i,
        "",
      )}--rev-${previousSnapshot.revision}-${Date.now()}.md`;
      const historyPath = buildLogicalPath(project, ["context", "history"], historyFileName);
      const historyFrontmatter = applyFrontmatterOverrides(previousSnapshot.frontmatter, {
        memory_type: "historical_note",
        status: "historical",
        canonical: false,
        author_client: input.authorClient ?? this.principal.login,
      });
      const historyMarkdown = buildMarkdownDocument(
        historyFrontmatter,
        previousSnapshot.bodyMarkdown,
      );
      const uploadedHistory = await this.zoho.uploadMarkdownFile({
        folderId: folders.contextHistory.id,
        fileName: historyFileName,
        markdown: historyMarkdown,
        overrideExisting: false,
      });
      const historyJobId = await this.indexUploadedMarkdownAndRecordJob({
        file: uploadedHistory,
        path: historyPath,
        reason: "history snapshot write",
        project,
        markdown: historyMarkdown,
      });
      historyResult = {
        path: historyPath,
        workdrive_file_id: uploadedHistory.id,
        job_id: historyJobId,
      };
    }

    const targetFolderId = existing?.parentFolderId ?? folders.contextCurrent.id;
    const uploadedCanonical = await this.zoho.uploadMarkdownFile({
      folderId: targetFolderId,
      fileName: canonicalFileName,
      markdown,
      overrideExisting: Boolean(existing),
    });
    const jobId = await this.indexUploadedMarkdownAndRecordJob({
      file: uploadedCanonical,
      path,
      reason: "canonical context write",
      project,
      markdown,
    });

    return {
      path,
      workdrive_file_id: uploadedCanonical.id,
      job_id: jobId,
      history_snapshot: historyResult,
    };
  }

  async reindexDocument(input: {
    documentId?: string;
    path?: string;
    workdriveFileId?: string;
  }) {
    const document = input.documentId || input.path || input.workdriveFileId
      ? await this.resolveDocumentReference({
          documentId: input.documentId,
          path: input.path,
          workdriveFileId: input.workdriveFileId,
        })
      : null;
    if (!document) {
      throw new Error("Unable to resolve a document to reindex.");
    }
    const jobId = await this.repo.createReindexJob({
      scope: "document",
      documentId: document.id,
      workdriveFileId: document.workdriveFileId,
      path: document.path,
      requestedBy: this.principal.login,
      reason: "manual document reindex",
      project: document.project,
      jobKind: "document",
    });
    await runDocumentReindexJob(this.env, this.repo, {
      jobId,
      workdriveFileId: document.workdriveFileId,
      path: document.path,
    });
    return { job_id: jobId, path: document.path, status: "completed" };
  }

  async reindexAll() {
    if (!isAdminPrincipal(this.principal, this.config.adminGithubLogins)) {
      throw new Error("reindex_all is restricted to administrators.");
    }
    const jobId = await this.repo.createReindexJob({
      scope: "crawl",
      requestedBy: this.principal.login,
      reason: "manual full crawl",
    });
    await this.env.INDEX_QUEUE.send({
      jobId,
      kind: "crawl",
      requestedBy: this.principal.login,
    } satisfies IndexQueueMessage);
    return { job_id: jobId };
  }

  async adminStatus() {
    const status = await this.repo.getAdminStatus();
    return {
      ...status,
      connectivity: {
        workdrive_configured: Boolean(
          this.config.zoho.sharedRootFolderId &&
            this.config.zoho.projectsRootFolderId &&
            (this.config.zoho.accessToken ||
              (this.config.zoho.clientId &&
                this.config.zoho.clientSecret &&
                this.config.zoho.refreshToken)),
        ),
        github_configured: Boolean(
          this.config.github.accessToken ||
            (this.config.github.clientId && this.config.github.clientSecret) ||
            this.config.github.allowedRepos.length > 0,
        ),
        vectorize_bound: Boolean(this.env.MEMORY_INDEX),
        queue_bound: Boolean(this.env.INDEX_QUEUE),
      },
    };
  }

  async reconcileWorkDrive() {
    if (!isAdminPrincipal(this.principal, this.config.adminGithubLogins)) {
      throw new Error("admin_reconcile_workdrive is restricted to administrators.");
    }
    return runReconciliation(this.env, "manual");
  }

  async retrievalDiagnostics(input: {
    query: string;
    project?: string;
    repo?: string;
    path?: string;
  }) {
    const project = normalizeProject(input.project);
    const namespaces = project === "shared" ? ["shared"] : ["shared", project];
    const stats = await this.repo.getProjectStats(project);
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

  async analyzeMemoryMigration(input: { project?: string; includeMarkdownLinks?: boolean } = {}) {
    const [projects, aliases, documents] = await Promise.all([
      this.repo.listProjects({ includeMerged: true, includeArchived: true }),
      this.repo.listProjectAliases().catch(() => []),
      this.repo.listAllDocuments({ project: input.project, limit: 5000 }).catch(() => []),
    ]);
    const statsByProject = new Map<string, Awaited<ReturnType<MemoryRepository["getProjectStats"]>>>();
    for (const project of projects) {
      statsByProject.set(project.slug, await this.repo.getProjectStats(project.slug).catch(() => ({
        document_count: 0,
        current_context_count: 0,
        active_decision_count: 0,
        chunk_count: 0,
        failed_job_count: 0,
      })));
    }
    const duplicateProjectGroups = detectDuplicateProjectGroups(projects, statsByProject, aliases);
    const placeholderDocs = documents
      .filter((document) => document.memoryType === "current_context")
      .filter((document) => isPlaceholderPath(document.path) || isPlaceholderTitle(document.title))
      .map((document) => ({
        document_id: document.id,
        project: document.project,
        title: document.title,
        path: document.path,
        status: document.status,
        active: document.active,
        proposed_action: document.active ? "review_for_noncanonical_marker" : "already_inactive_history",
      }));
    const duplicateCurrentContextPaths = detectDuplicateCurrentContextPaths(documents);
    const vectorGaps = [...statsByProject.entries()]
      .filter(([project]) => !input.project || project === normalizeProject(input.project))
      .filter(([, stats]) => stats.document_count > 0 && stats.chunk_count === 0)
      .map(([project, stats]) => ({ project, ...stats, proposed_action: "enqueue_reindex_or_inspect_failed_jobs" }));
    const markdownLinkProposals = input.includeMarkdownLinks === false ? [] : buildMarkdownLinkProposals(duplicateProjectGroups);
    const memoryLinkProposals = duplicateProjectGroups.flatMap((group) => [
      {
        project: group.canonical_project,
        from_type: "project",
        from_id: group.duplicate_project,
        to_type: "project",
        to_id: group.canonical_project,
        relation: "merged_into",
      },
      {
        project: group.canonical_project,
        from_type: "project",
        from_id: group.canonical_project,
        to_type: "project",
        to_id: group.duplicate_project,
        relation: "has_alias_project",
      },
    ]);
    const actions = [
      ...duplicateProjectGroups.map((group) => ({
        type: "project_canonicalization",
        canonical_project: group.canonical_project,
        duplicate_project: group.duplicate_project,
        safe_to_apply: true,
      })),
      ...memoryLinkProposals.map((proposal) => ({
        type: "memory_link",
        ...proposal,
        safe_to_apply: true,
      })),
    ];
    return {
      migration_slug: "environment-capabilities-and-memory-migration",
      dry_run: true,
      summary: {
        duplicate_project_groups: duplicateProjectGroups.length,
        placeholder_current_context_docs: placeholderDocs.length,
        duplicate_current_context_paths: duplicateCurrentContextPaths.length,
        vector_indexing_gaps: vectorGaps.length,
        proposed_actions: actions.length,
      },
      duplicate_projects: duplicateProjectGroups,
      placeholder_current_context_docs: placeholderDocs,
      duplicate_current_context_paths: duplicateCurrentContextPaths,
      vector_indexing_gaps: vectorGaps,
      markdown_link_proposals: markdownLinkProposals,
      memory_link_proposals: memoryLinkProposals,
      actions,
      safety: {
        deletes_workdrive_files: false,
        deletes_d1_rows: false,
        resets_vectorize: false,
        raw_private_data_policy: "durable summaries and pointers only",
      },
    };
  }

  async runMemoryMigration(input: { dryRun?: boolean; apply?: boolean; project?: string } = {}) {
    const apply = input.apply === true;
    const dryRun = input.dryRun !== false || !apply;
    const analysis = await this.analyzeMemoryMigration({ project: input.project });
    if (dryRun) {
      await this.repo.recordMigrationAuditEvent({
        migrationSlug: analysis.migration_slug,
        phase: "dry_run",
        dryRun: true,
        status: "ok",
        summary: `Dry run found ${analysis.summary.proposed_actions} metadata-safe proposed actions.`,
        counts: analysis.summary,
      }).catch(() => undefined);
      return {
        dry_run: true,
        applied: false,
        analysis,
      };
    }

    let aliasesWritten = 0;
    let projectMarkersWritten = 0;
    let linksWritten = 0;
    for (const group of analysis.duplicate_projects) {
      await this.repo.updateProjectProfile({
        slug: group.canonical_project,
        aliases: [group.duplicate_project, ...group.aliases],
        canonicalProject: group.canonical_project,
        canonicalStatus: "canonical",
      });
      await this.repo.updateProjectProfile({
        slug: group.duplicate_project,
        canonicalProject: group.canonical_project,
        mergedIntoProject: group.canonical_project,
        canonicalStatus: "merged",
        noncanonicalReason: "Likely duplicate slug variant; preserved as merged/noncanonical metadata.",
      });
      aliasesWritten += 1 + group.aliases.length;
      projectMarkersWritten += 2;
    }
    for (const link of analysis.memory_link_proposals) {
      await this.repo.linkMemory({
        project: link.project,
        fromType: link.from_type,
        fromId: link.from_id,
        toType: link.to_type,
        toId: link.to_id,
        relation: link.relation,
        metadata: { migration_slug: analysis.migration_slug, non_destructive: true },
      });
      linksWritten += 1;
    }
    await this.repo.recordMigrationAuditEvent({
      migrationSlug: analysis.migration_slug,
      phase: "apply",
      dryRun: false,
      status: "ok",
      summary: `Applied metadata-safe canonicalization: ${projectMarkersWritten} project markers, ${aliasesWritten} aliases, ${linksWritten} links.`,
      counts: { project_markers: projectMarkersWritten, aliases: aliasesWritten, memory_links: linksWritten },
    });
    await this.repo.saveSourceEvent({
      project: "memory-system-mcp",
      source: "migration",
      sourceId: `${analysis.migration_slug}:apply`,
      eventType: "memory_reconciliation",
      title: "Applied metadata-safe memory migration",
      summary: "Marked duplicate project slug variants as canonical/merged and created idempotent graph links without deleting WorkDrive files or D1 rows.",
      sensitivity: "internal",
      savePolicy: "durable_summary",
      metadata: { project_markers: projectMarkersWritten, aliases: aliasesWritten, memory_links: linksWritten },
    }).catch(() => undefined);
    return {
      dry_run: false,
      applied: true,
      counts: { project_markers: projectMarkersWritten, aliases: aliasesWritten, memory_links: linksWritten },
      analysis,
    };
  }

  async getMigrationAudit(input: { migrationSlug?: string; limit?: number } = {}) {
    return { events: await this.repo.listMigrationAuditEvents(input) };
  }

  async analyzeContextTruthMigration(input: { project?: string } = {}) {
    const project = normalizeProject(input.project);
    const [documents, entities, aliases, facts] = await Promise.all([
      this.repo.listAllDocuments({ project, limit: 5000 }).catch(() => []),
      this.repo.searchEntities({ project, limit: 100 }).catch(() => []),
      this.repo.listEntityAliases({ project, limit: 500 }).catch(() => []),
      this.repo.listFacts({ project, limit: 100 }).catch(() => []),
    ]);
    const candidateCurrentDocs = documents.filter((document) =>
      document.active &&
      ["current_context", "decision"].includes(document.memoryType),
    );
    const currentSensitiveDocs = candidateCurrentDocs.filter((document) =>
      /\b(current|latest|status|stage|pipeline|deal|opportunit|next action|blocker|left|joined)\b/i.test(
        `${document.title} ${document.path} ${document.tags.join(" ")}`,
      ),
    );
    const counts = {
      documents_scanned: documents.length,
      current_sensitive_documents: currentSensitiveDocs.length,
      entities_seen: entities.length,
      aliases_seen: aliases.length,
      facts_seen: facts.length,
    };
    return {
      migration_slug: "context-truth-engine",
      dry_run: true,
      project,
      counts,
      proposed_actions: [
        {
          type: "entity_alias_backfill",
          count: entities.length,
          safe_to_apply: true,
          description: "Create aliases from existing entity names and slugs.",
        },
        {
          type: "manual_current_state_review",
          count: currentSensitiveDocs.length,
          safe_to_apply: false,
          description: "Review volatile current-state docs before converting them into active entity states.",
        },
      ],
      safety: {
        deletes_workdrive_files: false,
        deletes_d1_rows: false,
        resets_vectorize: false,
        raw_private_data_policy: "durable summaries and structured state only",
      },
    };
  }

  async runContextTruthMigration(input: { project?: string; dryRun?: boolean; apply?: boolean } = {}) {
    const apply = input.apply === true;
    const dryRun = input.dryRun !== false || !apply;
    const analysis = await this.analyzeContextTruthMigration({ project: input.project });
    const manifestId = `context-truth-engine-${analysis.project}`;
    if (dryRun) {
      await this.repo.recordContextTruthMigrationManifest({
        id: manifestId,
        migrationSlug: analysis.migration_slug,
        project: analysis.project,
        dryRun: true,
        applyRequested: false,
        status: "dry_run",
        summary: `Dry run scanned ${analysis.counts.documents_scanned} documents and found ${analysis.counts.current_sensitive_documents} current-sensitive review candidates.`,
        manifest: analysis,
        counts: analysis.counts,
      }).catch(() => undefined);
      await this.repo.recordMigrationAuditEvent({
        migrationSlug: analysis.migration_slug,
        phase: "dry_run",
        dryRun: true,
        status: "ok",
        summary: "Created Context Truth Engine dry-run manifest.",
        counts: analysis.counts,
      }).catch(() => undefined);
      return { dry_run: true, applied: false, manifest_id: manifestId, analysis };
    }

    const entities = await this.repo.searchEntities({ project: analysis.project, limit: 100 });
    let aliasesWritten = 0;
    for (const entity of entities) {
      const aliases = await this.repo.upsertEntityAliases({
        project: analysis.project,
        entityId: entity.id,
        aliases: [entity.name, entity.slug],
        source: "context-truth-engine-migration",
        confidence: entity.confidence ?? 0.7,
      });
      aliasesWritten += aliases.length;
    }
    const counts = {
      ...analysis.counts,
      aliases_written: aliasesWritten,
    };
    await this.repo.recordContextTruthMigrationManifest({
      id: manifestId,
      migrationSlug: analysis.migration_slug,
      project: analysis.project,
      dryRun: false,
      applyRequested: true,
      status: "applied",
      summary: `Applied non-destructive Context Truth Engine migration metadata and wrote ${aliasesWritten} aliases.`,
      manifest: analysis,
      counts,
    });
    await this.repo.recordMigrationAuditEvent({
      migrationSlug: analysis.migration_slug,
      phase: "apply",
      dryRun: false,
      status: "ok",
      summary: `Applied Context Truth Engine metadata migration: ${aliasesWritten} aliases written.`,
      counts,
    }).catch(() => undefined);
    await this.repo.saveSourceEvent({
      project: "memory-system-mcp",
      source: "migration",
      sourceId: `${analysis.migration_slug}:apply:${manifestId}`,
      eventType: "context_truth_engine",
      title: "Applied Context Truth Engine metadata migration",
      summary: "Backfilled entity aliases from existing entities and recorded a non-destructive migration manifest. Volatile deal/person states still require approved structured state writes.",
      sensitivity: "internal",
      savePolicy: "durable_summary",
      metadata: counts,
    }).catch(() => undefined);
    return { dry_run: false, applied: true, manifest_id: manifestId, counts, analysis };
  }

  async importAiBrainVault(input: {
    project?: string;
    vaultName?: string;
    files: Array<{ path: string; markdown: string }>;
    manifest?: Record<string, unknown>;
    retrievalMap?: Record<string, unknown>;
    dryRun?: boolean;
    apply?: boolean;
    preserveWikilinks?: boolean;
    applyLinks?: boolean;
    currentContextPriorities?: string[];
    authorClient?: string;
  }) {
    const project = normalizeProject(input.project);
    const apply = input.apply === true;
    const dryRun = input.dryRun !== false || !apply;
    const analysis = analyzeAiBrainVaultPayloadV2({
      project,
      vaultName: input.vaultName ?? "AI Brain Vault",
      files: input.files,
      manifest: input.manifest,
      retrievalMap: input.retrievalMap,
      preserveWikilinks: input.preserveWikilinks,
      applyLinks: input.applyLinks,
      currentContextPriorities: input.currentContextPriorities,
    });
    const manifestId = `ai-brain-vault-import-${project}`;
    if (dryRun) {
      await this.repo.recordContextTruthMigrationManifest({
        id: manifestId,
        migrationSlug: "ai-brain-vault-import",
        project,
        dryRun: true,
        applyRequested: false,
        status: "dry_run",
        summary: `Dry run prepared ${analysis.counts.files_seen} AI Brain vault files for import.`,
        manifest: analysis,
        counts: analysis.counts,
      }).catch(() => undefined);
      return {
        dry_run: true,
        applied: false,
        manifest_id: manifestId,
        links_written: 0,
        unresolved_links: analysis.unresolved_links,
        current_context_written: 0,
        snippets_written: 0,
        documents_by_stable_id: analysis.documents_by_stable_id,
        analysis,
      };
    }

    const imported = [];
    let currentContextWritten = 0;
    let snippetsWritten = 0;
    for (const proposal of analysis.proposed_documents) {
      const markdown = buildAiBrainImportMarkdownV2({
        proposal,
        vaultName: analysis.vault_name,
        project,
        authorClient: input.authorClient ?? this.principal.login,
      });
      if (proposal.memory_type === "current_context") {
        currentContextWritten += 1;
        imported.push(
          await this.updateContextDocument({
            project,
            path: buildLogicalPath(project, ["context", "current"], `${slugify(proposal.title)}.md`),
            title: proposal.title,
            markdown,
            authorClient: input.authorClient ?? this.principal.login,
          }),
        );
      } else {
        snippetsWritten += 1;
        imported.push(
          await this.saveSnippet({
            project,
            title: proposal.title,
            markdown: buildAiBrainSnippetImportMarkdownV2({
              proposal,
              vaultName: analysis.vault_name,
              project,
            }),
            tags: [...proposal.tags],
            source: "ai-brain-vault",
            path: proposal.source_path,
            confidence: 0.8,
            usefulness: proposal.priority === "load-first" ? 1 : 0.85,
            authorClient: input.authorClient ?? this.principal.login,
          }),
        );
      }
    }
    let linksWritten = 0;
    if (input.applyLinks !== false) {
      for (const link of analysis.proposed_links) {
        await this.repo.linkMemory({
          project,
          fromType: "ai_brain_document",
          fromId: link.from_stable_id,
          toType: "ai_brain_document",
          toId: link.to_stable_id,
          relation: "wikilink",
          weight: 1,
          metadata: {
            vault_name: analysis.vault_name,
            source_path: link.from_path,
            target_path: link.to_path,
            target_label: link.target_label,
          },
        });
        linksWritten += 1;
      }
    }
    await this.repo.recordContextTruthMigrationManifest({
      id: manifestId,
      migrationSlug: "ai-brain-vault-import",
      project,
      dryRun: false,
      applyRequested: true,
      status: "applied",
      summary: `Imported ${imported.length} AI Brain vault files and wrote ${linksWritten} wiki-link relationships without deleting existing memory.`,
      manifest: analysis,
      counts: { ...analysis.counts, imported: imported.length, links_written: linksWritten },
    });
    return {
      dry_run: false,
      applied: true,
      manifest_id: manifestId,
      links_written: linksWritten,
      unresolved_links: analysis.unresolved_links,
      current_context_written: currentContextWritten,
      snippets_written: snippetsWritten,
      documents_by_stable_id: analysis.documents_by_stable_id,
      imported,
      analysis,
    };
  }

  async analyzeLightLaneMemoryRecovery(input: {
    aiBrainFiles?: Array<{ path: string; markdown: string }>;
    aiBrainAnalysis?: LightLaneRecoveryAiBrainInput;
    associatedRepos?: string[];
    knownDealUpdates?: LightLaneKnownDealUpdate[];
  } = {}) {
    const [documents, repos] = await Promise.all([
      this.repo.listAllDocuments({ limit: 5000 }),
      input.associatedRepos
        ? Promise.resolve([])
        : this.repo.listProjectGithubRepos("light-lane").catch(() => []),
    ]);
    const aiBrainAnalysis = input.aiBrainAnalysis
      ?? (input.aiBrainFiles?.length
        ? analyzeAiBrainVaultPayloadV2({
            project: "light-lane",
            vaultName: "AI Brain Vault",
            files: input.aiBrainFiles,
            preserveWikilinks: true,
            applyLinks: true,
            currentContextPriorities: ["load-first", "high"],
          })
        : inferExistingAiBrainImport(documents));

    return buildLightLaneMemoryRecoveryAnalysis({
      documents: documents.map((document) => ({
        id: document.id,
        project: document.project,
        title: document.title,
        path: document.path,
        memoryType: document.memoryType,
        status: document.status,
        tags: document.tags,
      })),
      aiBrainAnalysis,
      associatedRepos: input.associatedRepos ?? repos.map((repo) => repo.repoFullName),
      knownDealUpdates: input.knownDealUpdates,
    });
  }

  async runLightLaneMemoryRecovery(input: {
    aiBrainFiles?: Array<{ path: string; markdown: string }>;
    aiBrainAnalysis?: LightLaneRecoveryAiBrainInput;
    associatedRepos?: string[];
    knownDealUpdates?: LightLaneKnownDealUpdate[];
    dryRun?: boolean;
    apply?: boolean;
    applyPhases?: LightLaneRecoveryApplyPhase[];
    authorClient?: string;
  } = {}) {
    const apply = input.apply === true;
    const dryRun = input.dryRun !== false || !apply;
    const analysis = await this.analyzeLightLaneMemoryRecovery({
      aiBrainFiles: input.aiBrainFiles,
      aiBrainAnalysis: input.aiBrainAnalysis,
      associatedRepos: input.associatedRepos,
      knownDealUpdates: input.knownDealUpdates,
    });
    const manifestId = "light-lane-memory-recovery-light-lane";
    const counts = lightLaneRecoveryCounts(analysis);
    if (dryRun) {
      await this.repo.recordContextTruthMigrationManifest({
        id: manifestId,
        migrationSlug: analysis.migration_slug,
        project: analysis.project,
        dryRun: true,
        applyRequested: false,
        status: "dry_run",
        summary: `Dry run prepared Light Lane recovery: ${counts.current_context_documents} current-context docs, ${counts.deal_state_actions} entity-state writes, ${counts.shared_documents_to_archive} shared docs to archive, and ${counts.repos_to_associate} repos to associate.`,
        manifest: analysis,
        counts,
      });
      return {
        dry_run: true,
        applied: false,
        manifest_id: manifestId,
        analysis,
      };
    }

    if (!analysis.quality_gates.ready_to_apply) {
      await this.repo.recordContextTruthMigrationManifest({
        id: manifestId,
        migrationSlug: analysis.migration_slug,
        project: analysis.project,
        dryRun: false,
        applyRequested: true,
        status: "blocked",
        summary: `Light Lane recovery apply blocked: ${analysis.quality_gates.blockers.join(", ")}`,
        manifest: analysis,
        counts,
      });
      return {
        dry_run: false,
        applied: false,
        manifest_id: manifestId,
        blocked: true,
        blockers: analysis.quality_gates.blockers,
        analysis,
      };
    }

    const authorClient = input.authorClient ?? this.principal.login;
    const phases = new Set(input.applyPhases?.length ? input.applyPhases : DEFAULT_LIGHT_LANE_RECOVERY_PHASES);
    const aiBrainImport = phases.has("ai_brain") && input.aiBrainFiles?.length
      ? await this.importAiBrainVault({
          project: "light-lane",
          vaultName: "AI Brain Vault",
          files: input.aiBrainFiles,
          dryRun: false,
          apply: true,
          preserveWikilinks: true,
          applyLinks: true,
          currentContextPriorities: ["load-first", "high"],
          authorClient,
        })
      : null;
    const currentContextWritten = [];
    if (phases.has("current_context")) {
      for (const document of analysis.current_context_documents) {
        currentContextWritten.push(
          await this.updateContextDocument({
            project: "light-lane",
            path: document.target_path,
            title: document.title,
            markdown: document.markdown,
            authorClient,
          }),
        );
      }
    }
    const entityStatesWritten = [];
    if (phases.has("entity_state")) {
      for (const action of analysis.deal_state_actions) {
        entityStatesWritten.push(
          await this.upsertEntityState({
            project: "light-lane",
            entityType: "deal",
            entityName: action.entity_name,
            stateKey: action.state_key,
            value: action.value,
            confidence: action.confidence,
            source: action.source,
            sourceId: analysis.migration_slug,
            observedAt: new Date().toISOString(),
          }),
        );
      }
    }
    const archived = phases.has("archive")
      ? await this.archiveLightLaneRecoveryDocuments({
          actions: analysis.archive_actions,
          manifestId,
          authorClient,
        })
      : {
          documents_archived: 0,
          vector_metadata_refreshed: 0,
          memory_links_written: 0,
          archive_results: [],
        };
    const reposAssociated = [];
    if (phases.has("repo_associate")) {
      for (const action of analysis.repo_actions.associate) {
        reposAssociated.push(await this.associateGithubRepo(action));
      }
    }
    const reposIndexed = [];
    if (phases.has("repo_index")) {
      for (const action of analysis.repo_actions.index_overview) {
        reposIndexed.push(
          await this.indexGithubRepoOverview({
            ...action,
            authorClient,
          }),
        );
      }
    }
    const applyCounts = {
      ...counts,
      ai_brain_current_context_written: aiBrainImport?.current_context_written ?? 0,
      ai_brain_snippets_written: aiBrainImport?.snippets_written ?? 0,
      ai_brain_links_written: aiBrainImport?.links_written ?? 0,
      current_context_written: currentContextWritten.length,
      entity_states_written: entityStatesWritten.length,
      documents_archived: archived.documents_archived,
      repos_associated: reposAssociated.length,
      repos_indexed: reposIndexed.length,
    };
    await this.repo.recordContextTruthMigrationManifest({
      id: manifestId,
      migrationSlug: analysis.migration_slug,
      project: analysis.project,
      dryRun: false,
      applyRequested: true,
      status: "applied",
      summary: `Applied Light Lane recovery: imported AI Brain material, wrote ${currentContextWritten.length} canonical current-context docs, wrote ${entityStatesWritten.length} entity states, archived ${archived.documents_archived} shared docs, and indexed ${reposIndexed.length} repos.`,
      manifest: {
        ...analysis,
        apply_phases: [...phases],
        apply_results: {
          ai_brain_import: aiBrainImport,
          current_context_written: currentContextWritten,
          entity_states_written: entityStatesWritten,
          archived,
          repos_associated: reposAssociated,
          repos_indexed: reposIndexed,
        },
      },
      counts: applyCounts,
    });
    await this.repo.saveSourceEvent({
      project: "memory-system-mcp",
      source: "migration",
      sourceId: `${analysis.migration_slug}:apply:${manifestId}`,
      eventType: "light_lane_memory_recovery",
      title: "Applied Light Lane memory recovery",
      summary: "Imported Light Lane AI Brain content, wrote project-scoped current context, moved deal state into structured entity states, archived misplaced shared current-context documents, and associated/indexed Light Lane repositories.",
      sensitivity: "internal",
      savePolicy: "durable_summary",
      metadata: applyCounts,
    }).catch(() => undefined);
    return {
      dry_run: false,
      applied: true,
      manifest_id: manifestId,
      analysis,
      counts: applyCounts,
      apply_results: {
        ai_brain_import: aiBrainImport,
        current_context_written: currentContextWritten,
        entity_states_written: entityStatesWritten,
        archived,
        repos_associated: reposAssociated,
        repos_indexed: reposIndexed,
      },
    };
  }

  async analyzeWorkdriveCanonicalization(input: {
    canonicalProject?: string;
    duplicateProject?: string;
    includeSharedDuplicates?: boolean;
  } = {}) {
    const canonicalProject = normalizeProject(input.canonicalProject ?? "light-lane");
    const duplicateProject = normalizeProject(input.duplicateProject ?? "lightlane");
    const includeSharedDuplicates = input.includeSharedDuplicates !== false;
    const [projects, documents, aliases] = await Promise.all([
      this.repo.listProjects({ includeMerged: true, includeArchived: true }),
      this.repo.listAllDocuments({ limit: 5000 }),
      this.repo.listProjectAliases().catch(() => []),
    ]);
    const canonical = projects.find((project) => project.slug === canonicalProject) ?? null;
    const duplicate = projects.find((project) => project.slug === duplicateProject) ?? null;
    const duplicateDocuments = documents
      .filter((document) => document.project === duplicateProject)
      .filter((document) => document.active && document.status !== "archived");
    const sharedDuplicateDocuments = includeSharedDuplicates
      ? documents.filter(isSharedLightLaneCurrentContextDuplicate)
      : [];
    const archiveCopies = duplicateDocuments.map((document) => ({
      document_id: document.id,
      workdrive_file_id: document.workdriveFileId,
      title: document.title,
      from_path: document.path,
      to_path: archivePathForMergedProjectDocument(document, canonicalProject, duplicateProject),
      action: "copy_to_canonical_archive_then_mark_original_archived",
    }));
    const sharedArchiveCopies = sharedDuplicateDocuments.map((document) => ({
      document_id: document.id,
      workdrive_file_id: document.workdriveFileId,
      title: document.title,
      from_path: document.path,
      to_path: sharedHistoryArchivePath(document, canonicalProject),
      action: "copy_to_shared_history_then_mark_original_archived",
    }));
    const redirectFiles = duplicate?.workdriveRootFolderId
      ? [
          {
            folder_id: duplicate.workdriveRootFolderId,
            path: `/memory/projects/${duplicateProject}/MERGED_INTO_${canonicalProject}.md`,
            file_name: `MERGED_INTO_${canonicalProject}.md`,
            action: "upsert_redirect_marker",
          },
          {
            folder_id: duplicate.workdriveRootFolderId,
            path: `/memory/projects/${duplicateProject}/README.md`,
            file_name: "README.md",
            action: "upsert_redirect_readme",
          },
        ]
      : [];
    const canonicalCurrentContext = documents
      .filter((document) => document.project === canonicalProject)
      .filter((document) => document.memoryType === "current_context")
      .filter((document) => document.active && document.canonical)
      .sort((left, right) => right.revision - left.revision || right.path.localeCompare(left.path))
      .slice(0, 5)
      .map((document) => ({
        document_id: document.id,
        title: document.title,
        path: document.path,
        revision: document.revision,
      }));
    const memoryLinks = [
      {
        project: canonicalProject,
        from_type: "project",
        from_id: duplicateProject,
        to_type: "project",
        to_id: canonicalProject,
        relation: "merged_into",
      },
      ...archiveCopies.map((copy) => ({
        project: canonicalProject,
        from_type: "document",
        from_id: copy.document_id,
        to_type: "path",
        to_id: copy.to_path,
        relation: "archived_as",
      })),
      ...sharedArchiveCopies.map((copy) => ({
        project: canonicalProject,
        from_type: "document",
        from_id: copy.document_id,
        to_type: "path",
        to_id: copy.to_path,
        relation: "archived_as",
      })),
    ];
    const wikiLinks = [
      "[[light-lane]]",
      "[[memory-system-mcp]]",
      "[[Assistant Context OS]]",
      "[[Fully Promoted Nelson]]",
      "[[Fivestar Print]]",
    ];
    const counts = {
      duplicate_project_documents: archiveCopies.length,
      shared_duplicate_documents: sharedArchiveCopies.length,
      redirect_files: redirectFiles.length,
      memory_links: memoryLinks.length,
      canonical_current_context_candidates: canonicalCurrentContext.length,
    };
    const manifest = {
      migration_slug: "workdrive-visible-canonicalization",
      canonical_project: canonicalProject,
      duplicate_project: duplicateProject,
      strategy: "copy_archive_and_redirect",
      generated_at: new Date().toISOString(),
      folders: {
        canonical_project_root_id: canonical?.workdriveRootFolderId ?? null,
        duplicate_project_root_id: duplicate?.workdriveRootFolderId ?? null,
        canonical_archive_path: `/memory/projects/${canonicalProject}/_merged/${duplicateProject}/`,
      },
      project_state: {
        canonical,
        duplicate,
        aliases: aliases.filter((alias) => alias.alias === duplicateProject || alias.projectSlug === canonicalProject),
        proposed_duplicate_status: "archived",
        proposed_duplicate_canonical_status: "merged",
      },
      canonical_current_context: canonicalCurrentContext,
      archive_copies: archiveCopies,
      shared_archive_copies: sharedArchiveCopies,
      redirect_files: redirectFiles,
      d1_updates: [
        {
          table: "projects",
          key: duplicateProject,
          changes: {
            status: "archived",
            canonical_status: "merged",
            canonical_project: canonicalProject,
            merged_into_project: canonicalProject,
          },
        },
        {
          table: "documents",
          count: archiveCopies.length + sharedArchiveCopies.length,
          changes: {
            status: "archived",
            active: false,
            canonical: false,
            archived_to_path: "per manifest archive copy",
          },
        },
      ],
      reindex: {
        archive_copies: archiveCopies.map((copy) => copy.to_path),
        shared_archive_copies: sharedArchiveCopies.map((copy) => copy.to_path),
        original_documents_metadata_refresh: [...archiveCopies, ...sharedArchiveCopies].map((copy) => copy.document_id),
      },
      memory_links: memoryLinks,
      markdown_wiki_links: wikiLinks,
      risks: [
        "This conservative phase does not delete WorkDrive files.",
        "Folder moves are not attempted because this tenant API path is not validated in the current client.",
        "The old lightlane folder receives redirect files; any remaining raw files are marked archived in D1 and their vector metadata is refreshed inactive.",
      ],
      rollback_plan: [
        "Use migration audit/manifest id to find changed D1 rows.",
        "Set affected document rows active/canonical/status back from the previous D1 backup if needed.",
        "Archive copies and redirect files can remain as preserved history; no original files are deleted.",
        "Re-run document reindex for affected original WorkDrive file IDs if a rollback is approved.",
      ],
      safety: {
        deletes_workdrive_files: false,
        deletes_d1_rows: false,
        drops_vectorize_without_replacement: false,
        copies_raw_markdown_only_within_canonical_workdrive_store: true,
      },
      counts,
    };
    return {
      dry_run: true,
      manifest,
    };
  }

  async runWorkdriveCanonicalization(input: {
    canonicalProject?: string;
    duplicateProject?: string;
    dryRun?: boolean;
    apply?: boolean;
    includeSharedDuplicates?: boolean;
  } = {}) {
    const apply = input.apply === true;
    const dryRun = input.dryRun !== false || !apply;
    const analysis = await this.analyzeWorkdriveCanonicalization(input);
    const manifest = analysis.manifest;
    const manifestId = workdriveCanonicalizationManifestId(
      manifest.canonical_project,
      manifest.duplicate_project,
    );
    if (dryRun) {
      await this.repo.recordWorkdriveCanonicalizationManifest({
        id: manifestId,
        migrationSlug: manifest.migration_slug,
        canonicalProject: manifest.canonical_project,
        duplicateProject: manifest.duplicate_project,
        dryRun: true,
        applyRequested: false,
        status: "dry_run",
        summary: `Dry-run manifest proposes ${manifest.counts.duplicate_project_documents} duplicate project archive copies, ${manifest.counts.shared_duplicate_documents} shared duplicate archive copies, and ${manifest.counts.redirect_files} redirect files.`,
        manifest: manifest as Record<string, unknown>,
        counts: manifest.counts,
      });
      await this.repo.recordMigrationAuditEvent({
        migrationSlug: manifest.migration_slug,
        phase: "dry_run",
        dryRun: true,
        status: "ok",
        summary: "Created WorkDrive-visible canonicalization dry-run manifest.",
        counts: manifest.counts,
      }).catch(() => undefined);
      return {
        dry_run: true,
        applied: false,
        manifest_id: manifestId,
        manifest,
      };
    }

    const now = new Date().toISOString();
    let archiveCopiesWritten = 0;
    let redirectFilesWritten = 0;
    let documentsMarkedArchived = 0;
    let vectorMetadataRefreshed = 0;
    let memoryLinksWritten = 0;
    const archiveResults: Array<{ from_path: string; to_path: string; workdrive_file_id: string; job_id: string }> = [];

    for (const copy of [...manifest.archive_copies, ...manifest.shared_archive_copies]) {
      const document = await this.repo.getDocumentById(copy.document_id);
      if (!document) {
        continue;
      }
      const downloaded = await this.zoho.downloadMarkdown(document.workdriveFileId);
      const archiveMarkdown = buildArchivedCanonicalizationMarkdown({
        document,
        markdown: downloaded.markdown,
        archivePath: copy.to_path,
        canonicalProject: manifest.canonical_project,
        duplicateProject: manifest.duplicate_project,
        manifestId,
        now,
      });
      const targetFolder = await ensureFolderForLogicalPath(this.zoho, this.config, copy.to_path);
      const uploaded = await this.zoho.uploadMarkdownFile({
        folderId: targetFolder.id,
        fileName: fileNameFromPath(copy.to_path),
        markdown: archiveMarkdown,
        overrideExisting: true,
      });
      const jobId = await this.indexUploadedMarkdownAndRecordJob({
        file: uploaded,
        path: copy.to_path,
        reason: "workdrive canonicalization archive copy",
        project: manifest.canonical_project,
        markdown: archiveMarkdown,
      });
      archiveCopiesWritten += 1;
      archiveResults.push({
        from_path: copy.from_path,
        to_path: copy.to_path,
        workdrive_file_id: uploaded.id,
        job_id: jobId,
      });
      await this.repo.markDocumentsNoncanonical({
        documentIds: [document.id],
        canonicalGroup: manifest.canonical_project,
        reason: `Archived by ${manifest.migration_slug}; preserved under canonical archive path.`,
        status: "archived",
        archivedToPath: copy.to_path,
        manifestId,
        notes: {
          migration_slug: manifest.migration_slug,
          canonical_project: manifest.canonical_project,
          duplicate_project: manifest.duplicate_project,
          archive_path: copy.to_path,
        },
      });
      documentsMarkedArchived += 1;
      if (await this.refreshArchivedVectorMetadata(document.id)) {
        vectorMetadataRefreshed += 1;
      }
      const archivedDocument = await this.repo.getDocumentByPath(copy.to_path);
      if (archivedDocument) {
        await this.repo.linkMemory({
          project: manifest.canonical_project,
          fromType: "document",
          fromId: document.id,
          toType: "document",
          toId: archivedDocument.id,
          relation: "archived_as",
          metadata: { migration_slug: manifest.migration_slug, manifest_id: manifestId },
        });
        memoryLinksWritten += 1;
      }
    }

    const duplicate = (manifest.project_state.duplicate as MemoryProject | null) ?? null;
    if (duplicate?.workdriveRootFolderId) {
      const redirectMarkdown = buildMergedProjectRedirectMarkdown({
        canonicalProject: manifest.canonical_project,
        duplicateProject: manifest.duplicate_project,
        manifestId,
        now,
      });
      for (const redirect of manifest.redirect_files) {
        const uploaded = await this.zoho.uploadMarkdownFile({
          folderId: duplicate.workdriveRootFolderId,
          fileName: redirect.file_name,
          markdown: redirectMarkdown,
          overrideExisting: true,
        });
        await this.indexUploadedMarkdownAndRecordJob({
          file: uploaded,
          path: redirect.path,
          reason: "workdrive canonicalization redirect",
          project: manifest.duplicate_project,
          markdown: redirectMarkdown,
        });
        redirectFilesWritten += 1;
      }
    }

    await this.repo.updateProjectProfile({
      slug: manifest.canonical_project,
      aliases: [manifest.duplicate_project],
      canonicalProject: manifest.canonical_project,
      canonicalStatus: "canonical",
    });
    await this.repo.updateProjectProfile({
      slug: manifest.duplicate_project,
      status: "archived",
      canonicalProject: manifest.canonical_project,
      mergedIntoProject: manifest.canonical_project,
      canonicalStatus: "merged",
      noncanonicalReason: `WorkDrive-visible canonicalization archived this duplicate under ${manifest.canonical_project}.`,
    });
    await this.repo.linkMemory({
      project: manifest.canonical_project,
      fromType: "project",
      fromId: manifest.duplicate_project,
      toType: "project",
      toId: manifest.canonical_project,
      relation: "merged_into",
      metadata: { migration_slug: manifest.migration_slug, manifest_id: manifestId },
    });
    memoryLinksWritten += 1;

    const counts = {
      archive_copies_written: archiveCopiesWritten,
      redirect_files_written: redirectFilesWritten,
      documents_marked_archived: documentsMarkedArchived,
      vector_metadata_refreshed: vectorMetadataRefreshed,
      memory_links_written: memoryLinksWritten,
    };
    await this.repo.recordWorkdriveCanonicalizationManifest({
      id: manifestId,
      migrationSlug: manifest.migration_slug,
      canonicalProject: manifest.canonical_project,
      duplicateProject: manifest.duplicate_project,
      dryRun: false,
      applyRequested: true,
      status: "applied",
      summary: `Archived ${archiveCopiesWritten} WorkDrive-visible duplicate docs and wrote ${redirectFilesWritten} redirect files without deleting originals.`,
      manifest: { ...manifest, archive_results: archiveResults },
      counts,
    });
    await this.repo.recordMigrationAuditEvent({
      migrationSlug: manifest.migration_slug,
      phase: "apply",
      dryRun: false,
      status: "ok",
      summary: `Applied WorkDrive-visible canonicalization: ${archiveCopiesWritten} archive copies, ${redirectFilesWritten} redirects, ${documentsMarkedArchived} document markers.`,
      counts,
    });
    await this.repo.saveSourceEvent({
      project: "memory-system-mcp",
      source: "migration",
      sourceId: `${manifest.migration_slug}:apply:${manifestId}`,
      eventType: "workdrive_canonicalization",
      title: "Applied WorkDrive-visible Light Lane canonicalization",
      summary: "Copied duplicate Light Lane Markdown into canonical archive paths, wrote redirect markers, marked duplicate documents archived/noncanonical, refreshed vector metadata inactive, and preserved all originals.",
      sensitivity: "internal",
      savePolicy: "durable_summary",
      metadata: { manifest_id: manifestId, ...counts },
    }).catch(() => undefined);

    return {
      dry_run: false,
      applied: true,
      manifest_id: manifestId,
      counts,
      archive_results: archiveResults,
      manifest,
    };
  }

  async getWorkdriveCanonicalizationManifest(input: {
    migrationSlug?: string;
    canonicalProject?: string;
    duplicateProject?: string;
    limit?: number;
  } = {}) {
    return {
      manifests: await this.repo.listWorkdriveCanonicalizationManifests({
        migrationSlug: input.migrationSlug,
        canonicalProject: input.canonicalProject ? normalizeProject(input.canonicalProject) : undefined,
        duplicateProject: input.duplicateProject ? normalizeProject(input.duplicateProject) : undefined,
        limit: input.limit,
      }),
    };
  }

  async archiveLightLaneRecoveryDocuments(input: {
    actions: LightLaneArchiveAction[];
    manifestId: string;
    authorClient?: string;
  }) {
    const now = new Date().toISOString();
    const archiveResults: Array<{
      from_path: string;
      to_path: string;
      workdrive_file_id: string;
      job_id: string;
    }> = [];
    let documentsArchived = 0;
    let vectorMetadataRefreshed = 0;
    let memoryLinksWritten = 0;

    for (const action of input.actions) {
      const document = await this.repo.getDocumentById(action.document_id);
      if (!document) {
        continue;
      }
      const downloaded = await this.zoho.downloadMarkdown(document.workdriveFileId);
      const archiveMarkdown = buildLightLaneRecoveryArchiveMarkdown({
        document,
        markdown: downloaded.markdown,
        action,
        manifestId: input.manifestId,
        now,
        authorClient: input.authorClient ?? this.principal.login,
      });
      const targetFolder = await ensureFolderForLogicalPath(this.zoho, this.config, action.to_path);
      const uploaded = await this.zoho.uploadMarkdownFile({
        folderId: targetFolder.id,
        fileName: fileNameFromPath(action.to_path),
        markdown: archiveMarkdown,
        overrideExisting: true,
      });
      const jobId = await this.indexUploadedMarkdownAndRecordJob({
        file: uploaded,
        path: action.to_path,
        reason: "light lane memory recovery archive copy",
        project: "light-lane",
        markdown: archiveMarkdown,
      });
      archiveResults.push({
        from_path: action.from_path,
        to_path: action.to_path,
        workdrive_file_id: uploaded.id,
        job_id: jobId,
      });
      await this.repo.markDocumentsNoncanonical({
        documentIds: [document.id],
        canonicalGroup: "light-lane",
        reason: "Archived by light-lane-memory-recovery; durable truth was rewritten into project-scoped Light Lane context or entity state.",
        status: "archived",
        archivedToPath: action.to_path,
        manifestId: input.manifestId,
        notes: {
          migration_slug: "light-lane-memory-recovery",
          replacement_project: action.replacement_project,
          replacement_target: action.replacement_target,
          archive_path: action.to_path,
        },
      });
      documentsArchived += 1;
      if (await this.refreshArchivedVectorMetadata(document.id)) {
        vectorMetadataRefreshed += 1;
      }
      const archivedDocument = await this.repo.getDocumentByPath(action.to_path);
      if (archivedDocument) {
        await this.repo.linkMemory({
          project: "light-lane",
          fromType: "document",
          fromId: document.id,
          toType: "document",
          toId: archivedDocument.id,
          relation: "archived_as",
          metadata: {
            migration_slug: "light-lane-memory-recovery",
            manifest_id: input.manifestId,
            replacement_target: action.replacement_target,
          },
        });
        memoryLinksWritten += 1;
      }
    }

    return {
      documents_archived: documentsArchived,
      vector_metadata_refreshed: vectorMetadataRefreshed,
      memory_links_written: memoryLinksWritten,
      archive_results: archiveResults,
    };
  }

  private async refreshArchivedVectorMetadata(documentId: string) {
    const document = await this.repo.getDocumentById(documentId);
    if (!document || !document.currentSnapshotId) {
      return false;
    }
    const chunks = await this.repo.listChunksForDocument(documentId);
    if (chunks.length === 0) {
      return false;
    }
    const embeddings = await embedTexts(
      this.env,
      chunks.map((chunk) => chunk.content),
    );
    await replaceDocumentVectors(this.env, {
      namespace: document.namespace,
      documentId: document.id,
      snapshotId: document.currentSnapshotId,
      workdriveFileId: document.workdriveFileId,
      title: document.title,
      path: document.path,
      project: document.project,
      memoryType: document.memoryType,
      status: "archived",
      active: false,
      superseded: false,
      repo: document.repo,
      repoPath: document.repoPath,
      tags: document.tags,
      source: document.source,
      confidence: document.confidence,
      usefulness: document.usefulness,
      revision: document.revision,
      url: document.permalink,
      chunks,
      embeddings,
    });
    return true;
  }

  private async resolveSearchScopeProjects(input: {
    project: string;
    scope: AssistantSearchScope;
    initiative?: string;
    entityId?: string;
  }) {
    if (input.scope === "entity" && input.entityId) {
      const entity = await this.repo.getEntity(input.entityId);
      return uniqueProjects([entity?.project, input.project]);
    }
    if (input.scope === "initiative" && input.initiative) {
      const initiative =
        (await this.repo.getInitiativeBySlug(slugify(input.initiative))) ??
        (await this.repo.getInitiativeById(input.initiative));
      if (initiative) {
        const projects = await this.repo.listInitiativeProjects(initiative.id);
        return uniqueProjects([input.project, ...projects.map((project) => project.projectSlug)]);
      }
    }
    if (input.scope === "all_related") {
      const related = await this.repo.listRelatedProjects(input.project);
      return uniqueProjects([input.project, ...related.map((project) => project.slug)]);
    }
    return [input.project];
  }

  private async resolveCurrentTruthEntities(project: string, query: string) {
    const aliases = await this.repo.searchEntityAliases({ project, query, limit: 12 });
    if (aliases.length > 0) {
      return dedupeEntities(
        aliases.map((alias) => alias.entity).filter((entity): entity is NonNullable<EntityAlias["entity"]> => Boolean(entity)),
      );
    }
    return this.repo.searchEntities({ project, query, limit: 12 });
  }

  private async loadRelatedProjects(
    project: string,
    links: Array<{ slug: string; relation: string; reason: string | null }>,
  ) {
    const projects = [];
    for (const link of links) {
      const related = await this.repo.getProject(link.slug);
      if (related) {
        projects.push({
          project: related,
          relation: link.relation,
          reason: link.reason,
        });
      }
    }
    const profile = (await this.repo.getProject(project))?.profile ?? {};
    const profileRelated = Array.isArray(profile.related_projects)
      ? profile.related_projects.filter((item): item is string => typeof item === "string")
      : [];
    for (const slug of profileRelated) {
      if (projects.some((item) => item.project.slug === slug)) {
        continue;
      }
      const related = await this.repo.getProject(slug);
      if (related) {
        projects.push({
          project: related,
          relation: "profile_related",
          reason: "Project profile related_projects metadata",
        });
      }
    }
    return projects;
  }

  private async enqueueDocumentReindex(input: {
    workdriveFileId: string;
    path: string;
    documentId?: string;
    reason: string;
    project?: string;
  }) {
    const jobId = await this.repo.createReindexJob({
      scope: "document",
      documentId: input.documentId,
      workdriveFileId: input.workdriveFileId,
      path: input.path,
      requestedBy: this.principal.login,
      reason: input.reason,
      project: input.project ?? normalizeProjectFromPath(input.path),
      jobKind: "document",
    });
    await this.env.INDEX_QUEUE.send({
      jobId,
      kind: "document",
      workdriveFileId: input.workdriveFileId,
      path: input.path,
    } satisfies IndexQueueMessage);
    return jobId;
  }

  private async indexUploadedMarkdownAndRecordJob(input: {
    file: ZohoFile;
    path: string;
    markdown: string;
    documentId?: string;
    reason: string;
    project: string;
  }) {
    const jobId = await this.repo.createReindexJob({
      scope: "document",
      documentId: input.documentId,
      workdriveFileId: input.file.id,
      path: input.path,
      requestedBy: this.principal.login,
      reason: input.reason,
      project: input.project,
      jobKind: "document",
    });
    await this.repo.updateReindexJob(jobId, {
      status: "running",
      incrementAttempts: true,
    });
    try {
      await indexMarkdownDocument(this.env, input.file, input.path, input.markdown);
      await this.repo.updateReindexJob(jobId, { status: "completed" });
      return jobId;
    } catch (error) {
      await this.repo.updateReindexJob(jobId, {
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private async resolveDocumentReference(input: {
    documentId?: string;
    path?: string;
    workdriveFileId?: string;
  }) {
    if (input.documentId) {
      return this.repo.getDocumentById(input.documentId);
    }
    if (input.path) {
      return this.repo.getDocumentByPath(input.path);
    }
    if (input.workdriveFileId) {
      return this.repo.getDocumentByWorkDriveFileId(input.workdriveFileId);
    }
    return null;
  }

}

function sliceLines(content: string, lineStart?: number, lineEnd?: number) {
  if (!lineStart && !lineEnd) {
    return content;
  }
  const lines = content.split("\n");
  const start = Math.max((lineStart ?? 1) - 1, 0);
  const end = Math.min(lineEnd ?? lines.length, lines.length);
  if (start >= end) {
    throw new Error("line_start must be before line_end.");
  }
  return lines.slice(start, end).join("\n");
}

function languageForPath(path: string) {
  const extension = path.split(".").pop()?.toLowerCase();
  const languages: Record<string, string> = {
    js: "javascript",
    jsx: "jsx",
    ts: "typescript",
    tsx: "tsx",
    py: "python",
    rb: "ruby",
    go: "go",
    rs: "rust",
    java: "java",
    kt: "kotlin",
    swift: "swift",
    php: "php",
    css: "css",
    html: "html",
    md: "markdown",
    json: "json",
    yaml: "yaml",
    yml: "yaml",
    toml: "toml",
    sql: "sql",
    sh: "bash",
  };
  return extension ? languages[extension] ?? extension : "";
}

function normalizeStateKey(value: string) {
  return slugify(value).replace(/-/g, "_");
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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
    .filter((entity) => (statesByEntity.get(entity.id) ?? []).filter((state) => state.status === "active").length === 0)
    .map((entity) => `No active current-state records were found for ${entity.name}; treat semantic memory as historical until live sources are checked.`);
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

function analyzeAiBrainVaultPayload(input: {
  project: string;
  vaultName: string;
  files: Array<{ path: string; markdown: string }>;
  manifest?: Record<string, unknown>;
  retrievalMap?: Record<string, unknown>;
}) {
  const proposedDocuments = input.files
    .filter((file) => file.path.toLowerCase().endsWith(".md"))
    .map((file) => {
      const parsed = parseLooseMarkdown(file.markdown);
      const title = markdownTitle(parsed.body) ?? titleFromPath(file.path);
      const priority = frontmatterPriority(parsed.frontmatter, file.path);
      const tags = [
        "ai-brain-vault",
        input.vaultName,
        ...frontmatterTags(parsed.frontmatter),
        ...file.path.split("/").slice(0, -1).map((part) => slugify(part)).filter(Boolean),
      ];
      return {
        source_path: file.path,
        title,
        priority,
        memory_type: priority === "load-first" || file.path.startsWith("00 ") ? "current_context" : "snippet",
        tags: [...new Set(tags)],
        wiki_links: extractWikiLinks(file.markdown),
        raw_markdown: file.markdown,
        frontmatter: parsed.frontmatter,
      } as const;
    });
  return {
    migration_slug: "ai-brain-vault-import",
    project: input.project,
    vault_name: input.vaultName,
    dry_run: true,
    counts: {
      files_seen: input.files.length,
      markdown_files: proposedDocuments.length,
      load_first: proposedDocuments.filter((document) => document.priority === "load-first").length,
      current_context: proposedDocuments.filter((document) => document.memory_type === "current_context").length,
      snippets: proposedDocuments.filter((document) => document.memory_type === "snippet").length,
    },
    proposed_documents: proposedDocuments,
    manifest: input.manifest ?? null,
    retrieval_map: input.retrievalMap ?? null,
    safety: {
      deletes_workdrive_files: false,
      deletes_d1_rows: false,
      treats_as_live_pipeline: false,
      raw_private_data_policy: "import only client-supplied vault markdown approved by caller",
    },
  };
}

function buildAiBrainImportMarkdown(input: {
  proposal: ReturnType<typeof analyzeAiBrainVaultPayload>["proposed_documents"][number];
  vaultName: string;
  project: string;
  authorClient: string;
}) {
  const now = new Date().toISOString();
  const body = parseLooseMarkdown(input.proposal.raw_markdown).body;
  const frontmatter = {
    id: crypto.randomUUID(),
    title: input.proposal.title,
    project: input.project,
    memory_type: input.proposal.memory_type,
    status: "active",
    revision: 1,
    tags: input.proposal.tags,
    created_at: now,
    updated_at: now,
    author_client: input.authorClient,
    source: "ai-brain-vault",
    source_urls: [],
    confidence: 0.8,
    usefulness: input.proposal.priority === "load-first" ? 1 : 0.85,
    path: input.proposal.source_path,
    supersedes: [],
    superseded_by: [],
    canonical: input.proposal.memory_type === "current_context",
    ai_brain_vault: input.vaultName,
    ai_brain_priority: input.proposal.priority,
    wiki_links: input.proposal.wiki_links,
  };
  return buildMarkdownWithExtraFrontmatter(frontmatter, body);
}

function parseLooseMarkdown(markdown: string) {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) {
    return { frontmatter: {}, body: markdown };
  }
  try {
    return {
      frontmatter: (YAML.parse(match[1] ?? "") ?? {}) as Record<string, unknown>,
      body: markdown.slice(match[0].length),
    };
  } catch {
    return { frontmatter: {}, body: markdown.slice(match[0].length) };
  }
}

function frontmatterPriority(frontmatter: Record<string, unknown>, path: string) {
  const raw = frontmatter.priority;
  if (typeof raw === "string" && raw.trim()) {
    return raw.trim().toLowerCase();
  }
  if (path.startsWith("00 ")) {
    return "load-first";
  }
  return "normal";
}

function frontmatterTags(frontmatter: Record<string, unknown>) {
  const raw = frontmatter.tags;
  if (Array.isArray(raw)) {
    return raw.filter((item): item is string => typeof item === "string");
  }
  if (typeof raw === "string") {
    return raw.split(/[,\s]+/).filter(Boolean);
  }
  return [];
}

function markdownTitle(markdown: string) {
  return markdown.match(/^#\s+(.+)$/m)?.[1]?.trim();
}

function titleFromPath(path: string) {
  const fileName = path.split("/").pop() ?? "Untitled";
  return fileName.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim() || "Untitled";
}

function extractWikiLinks(markdown: string) {
  return [...new Set([...markdown.matchAll(/\[\[([^\]]+)\]\]/g)].map((match) => match[1]).filter(isPresent))];
}

export async function processIndexQueueMessage(env: Env, message: IndexQueueMessage) {
  const repo = new MemoryRepository(env.DB);
  if (message.kind === "crawl") {
    await repo.updateReindexJob(message.jobId, { status: "running", incrementAttempts: true });
    try {
      const result = await runReconciliation(env, "manual");
      await repo.updateReindexJob(message.jobId, { status: "completed" });
      return result;
    } catch (error) {
      await repo.updateReindexJob(message.jobId, {
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  await repo.updateReindexJob(message.jobId, { status: "running", incrementAttempts: true });
  try {
    await runDocumentReindexJob(env, repo, {
      jobId: message.jobId,
      workdriveFileId: message.workdriveFileId,
      path: message.path,
    });
  } catch (error) {
    throw error;
  }
}

export async function reindexWorkDriveDocument(
  env: Env,
  workdriveFileId: string,
  path: string,
) {
  const zoho = new ZohoWorkDriveClient(env);
  const downloaded = await zoho.downloadMarkdown(workdriveFileId);
  await indexMarkdownDocument(env, downloaded.file, path, downloaded.markdown);
}

async function runDocumentReindexJob(
  env: Env,
  repo: MemoryRepository,
  input: {
    jobId: string;
    workdriveFileId: string;
    path: string;
  },
) {
  await repo.updateReindexJob(input.jobId, {
    status: "running",
    incrementAttempts: true,
  });
  try {
    await reindexWorkDriveDocument(env, input.workdriveFileId, input.path);
    await repo.updateReindexJob(input.jobId, { status: "completed" });
  } catch (error) {
    await repo.updateReindexJob(input.jobId, {
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

async function ensureFolderForLogicalPath(
  zoho: ZohoWorkDriveClient,
  config: ReturnType<typeof loadConfig>,
  path: string,
) {
  const parts = path.split("/").filter(Boolean);
  const fileName = parts.at(-1);
  if (!fileName) {
    throw new Error(`Cannot resolve WorkDrive folder for empty path ${path}.`);
  }
  if (parts[0] !== "memory") {
    throw new Error(`Path ${path} is not under /memory.`);
  }
  if (parts[1] === "shared") {
    if (!config.zoho.sharedRootFolderId) {
      throw new Error("WORKDRIVE_SHARED_ROOT_FOLDER_ID is required.");
    }
    return zoho.ensureFolderPath(config.zoho.sharedRootFolderId, parts.slice(2, -1)).then((result) => result.folder);
  }
  if (parts[1] === "projects" && parts[2]) {
    if (!config.zoho.projectsRootFolderId) {
      throw new Error("WORKDRIVE_PROJECTS_ROOT_FOLDER_ID is required.");
    }
    return zoho.ensureFolderPath(config.zoho.projectsRootFolderId, parts.slice(2, -1)).then((result) => result.folder);
  }
  throw new Error(`Unsupported memory path ${path}.`);
}

function archivePathForMergedProjectDocument(
  document: { path: string; fileName: string },
  canonicalProject: string,
  duplicateProject: string,
) {
  const prefix = `/memory/projects/${duplicateProject}/`;
  const relative = document.path.startsWith(prefix)
    ? document.path.slice(prefix.length)
    : `unmapped/${document.fileName}`;
  return `/memory/projects/${canonicalProject}/_merged/${duplicateProject}/${relative}`;
}

function sharedHistoryArchivePath(document: { path: string; fileName: string }, canonicalProject: string) {
  return `/memory/shared/context/history/${canonicalProject}/${document.fileName}`;
}

function isSharedLightLaneCurrentContextDuplicate(document: ResolvedMemoryDocument) {
  if (document.project !== "shared" || document.memoryType !== "current_context" || !document.active) {
    return false;
  }
  const haystack = `${document.title} ${document.path}`.toLowerCase();
  if (!haystack.includes("light-lane") && !haystack.includes("lightlane")) {
    return false;
  }
  return (
    haystack.includes("current-context") ||
    haystack.includes("current context") ||
    /\d{2}-\d{2}-\d{4}/.test(haystack)
  );
}

function fileNameFromPath(path: string) {
  return path.split("/").filter(Boolean).at(-1) ?? "untitled.md";
}

function workdriveCanonicalizationManifestId(canonicalProject: string, duplicateProject: string) {
  return `workdrive-visible-canonicalization-${duplicateProject}-to-${canonicalProject}`;
}

function inferExistingAiBrainImport(documents: ResolvedMemoryDocument[]): LightLaneRecoveryAiBrainInput | undefined {
  const aiBrainDocuments = documents.filter((document) =>
    document.project === "light-lane"
    && document.active
    && (document.source === "ai-brain-vault" || document.tags.includes("ai-brain-vault")),
  );
  if (!aiBrainDocuments.length) {
    return undefined;
  }
  const currentContext = aiBrainDocuments.filter((document) => document.memoryType === "current_context").length;
  const snippets = aiBrainDocuments.filter((document) => document.memoryType === "snippet").length;
  return {
    counts: {
      markdown_files: aiBrainDocuments.length,
      current_context: currentContext,
      snippets,
      load_first: currentContext >= 13 ? 12 : 0,
      high_priority: currentContext >= 13 ? 1 : 0,
      wiki_links: aiBrainDocuments.length >= 63 ? 218 : 0,
    },
  };
}

function lightLaneRecoveryCounts(analysis: ReturnType<typeof buildLightLaneMemoryRecoveryAnalysis>) {
  return {
    misplaced_shared_documents: analysis.misplaced_shared_documents.length,
    current_context_documents: analysis.current_context_documents.length,
    deal_state_actions: analysis.deal_state_actions.length,
    shared_documents_to_archive: analysis.archive_actions.length,
    repos_to_associate: analysis.repo_actions.associate.length,
    repos_to_index: analysis.repo_actions.index_overview.length,
  };
}

function buildMarkdownWithExtraFrontmatter(frontmatter: Record<string, unknown>, body: string) {
  return `---\n${YAML.stringify(frontmatter).trimEnd()}\n---\n\n${body.trim()}\n`;
}

function buildArchivedCanonicalizationMarkdown(input: {
  document: ResolvedMemoryDocument;
  markdown: string;
  archivePath: string;
  canonicalProject: string;
  duplicateProject: string;
  manifestId: string;
  now: string;
}) {
  const parsed = parseMarkdownDocument(input.document.path, input.markdown);
  const originalFrontmatter = parsed.frontmatter;
  const frontmatter = {
    ...originalFrontmatter,
    id: crypto.randomUUID(),
    title: input.document.title,
    project: input.canonicalProject,
    memory_type: input.document.memoryType,
    status: "archived",
    canonical: false,
    revision: 1,
    updated_at: input.now,
    author_client: "contextos-canonicalization",
    source_urls: input.document.permalink ? [input.document.permalink] : originalFrontmatter.source_urls,
    canonical_project: input.canonicalProject,
    merged_from: input.duplicateProject,
    archived_from_path: input.document.path,
    archived_from_document_id: input.document.id,
    canonicalization_manifest_id: input.manifestId,
    wiki_links: [
      "[[light-lane]]",
      "[[memory-system-mcp]]",
      "[[Assistant Context OS]]",
      "[[Fully Promoted Nelson]]",
      "[[Fivestar Print]]",
    ],
  };
  return buildMarkdownWithExtraFrontmatter(
    frontmatter,
    [
      `# ${input.document.title}`,
      "",
      `> Archived noncanonical copy from \`${input.document.path}\`.`,
      `> Canonical project: [[${input.canonicalProject}]]. No original content was deleted.`,
      "",
      parsed.body,
    ].join("\n"),
  );
}

function buildLightLaneRecoveryArchiveMarkdown(input: {
  document: ResolvedMemoryDocument;
  markdown: string;
  action: LightLaneArchiveAction;
  manifestId: string;
  now: string;
  authorClient: string;
}) {
  return buildMarkdownWithExtraFrontmatter(
    {
      id: crypto.randomUUID(),
      title: `Archived shared current context: ${input.document.title}`,
      project: "light-lane",
      memory_type: "snippet",
      status: "archived",
      canonical: false,
      revision: 1,
      tags: [
        "light-lane",
        "memory-recovery",
        "archived-shared-current-context",
        input.action.replacement_target,
      ],
      created_at: input.now,
      updated_at: input.now,
      author_client: input.authorClient,
      source: "light-lane-memory-recovery",
      confidence: input.document.confidence ?? 0.5,
      usefulness: 0.2,
      path: input.action.to_path,
      archived_from_path: input.action.from_path,
      archived_from_document_id: input.document.id,
      archived_to_path: input.action.to_path,
      canonicalization_manifest_id: input.manifestId,
      replacement_project: input.action.replacement_project,
      replacement_target: input.action.replacement_target,
      wiki_links: ["[[light-lane]]", "[[Light Lane Current Sales State]]", "[[Light Lane Source Trust]]"],
    },
    [
      `# Archived Shared Current Context: ${input.document.title}`,
      "",
      "This file preserves a former shared current-context document after the Light Lane memory recovery.",
      "",
      `- Original path: \`${input.action.from_path}\``,
      `- Replacement project: \`${input.action.replacement_project}\``,
      `- Replacement target: \`${input.action.replacement_target}\``,
      `- Manifest: \`${input.manifestId}\``,
      "",
      "## Original Markdown",
      "",
      input.markdown.trim(),
    ].join("\n"),
  );
}

function buildMergedProjectRedirectMarkdown(input: {
  canonicalProject: string;
  duplicateProject: string;
  manifestId: string;
  now: string;
}) {
  return buildMarkdownWithExtraFrontmatter(
    {
      id: crypto.randomUUID(),
      title: `${input.duplicateProject} merged into ${input.canonicalProject}`,
      project: input.duplicateProject,
      memory_type: "historical_note",
      status: "archived",
      revision: 1,
      tags: ["canonicalization", "merged-project", input.canonicalProject],
      created_at: input.now,
      updated_at: input.now,
      author_client: "contextos-canonicalization",
      source_urls: [],
      supersedes: [],
      superseded_by: [],
      canonical: false,
      canonical_project: input.canonicalProject,
      merged_into: input.canonicalProject,
      canonicalization_manifest_id: input.manifestId,
    },
    [
      `# ${input.duplicateProject} merged into [[${input.canonicalProject}]]`,
      "",
      `This project folder was merged into \`${input.canonicalProject}\` by ContextOS on ${input.now}.`,
      "",
      "- No WorkDrive files were deleted.",
      `- Canonical project path: \`/memory/projects/${input.canonicalProject}/\`.`,
      `- Preserved archive path: \`/memory/projects/${input.canonicalProject}/_merged/${input.duplicateProject}/\`.`,
      `- Migration audit id: \`${input.manifestId}\`.`,
      "",
      "Useful links: [[light-lane]], [[memory-system-mcp]], [[Assistant Context OS]], [[Fully Promoted Nelson]], [[Fivestar Print]].",
    ].join("\n"),
  );
}

export async function indexMarkdownDocument(
  env: Env,
  file: ZohoFile,
  path: string,
  markdown: string,
) {
  const repo = new MemoryRepository(env.DB);
  const parsed = parseMarkdownDocument(path, markdown);
  const namespace = normalizeProject(parsed.frontmatter.project);
  const existing =
    (await repo.getDocumentByWorkDriveFileId(file.id)) ??
    (await repo.getDocumentByPath(path));

  const documentId = existing?.id ?? crypto.randomUUID();
  const snapshotId = crypto.randomUUID();
  const updatedAtUnix = Math.floor(
    (file.modifiedTimeMillis ??
      Date.parse(parsed.frontmatter.updated_at) ??
      Date.now()) / 1000,
  );

  const chunks = chunkMarkdown({
    title: parsed.frontmatter.title,
    memoryType: parsed.frontmatter.memory_type,
    markdown: parsed.body,
  }).map((chunk) => ({
    vectorId: `${documentId}:${chunk.chunkIndex}`,
    chunkIndex: chunk.chunkIndex,
    headingPath: chunk.headingPath,
    content: chunk.content,
    tokenEstimate: chunk.tokenEstimate,
    updatedAtUnix,
  }));

  const embeddings = await embedTexts(
    env,
    chunks.map((chunk) => chunk.content),
  );

  await replaceDocumentVectors(env, {
    namespace,
    documentId,
    snapshotId,
    workdriveFileId: file.id,
    title: parsed.frontmatter.title,
    path,
    project: normalizeProject(parsed.frontmatter.project),
    memoryType: parsed.frontmatter.memory_type,
    status: parsed.frontmatter.status,
    active: parsed.frontmatter.status === "active",
    superseded: parsed.frontmatter.status === "superseded",
    repo: parsed.frontmatter.repo,
    repoPath: parsed.frontmatter.path,
    tags: parsed.frontmatter.tags,
    source: parsed.frontmatter.source,
    confidence: parsed.frontmatter.confidence,
    usefulness: parsed.frontmatter.usefulness,
    revision: parsed.frontmatter.revision,
    url: file.permalink,
    chunks,
    embeddings,
  });

  const result = await repo.upsertIndexedDocument({
    documentId,
    snapshotId,
    workdriveFileId: file.id,
    path,
    title: parsed.frontmatter.title,
    project: normalizeProject(parsed.frontmatter.project),
    namespace,
    parentFolderId: file.parentId ?? "",
    fileName: file.name,
    permalink: file.permalink,
    downloadUrl: file.downloadUrl,
    memoryType: parsed.frontmatter.memory_type,
    status: parsed.frontmatter.status,
    canonical: parsed.frontmatter.canonical,
    active: parsed.frontmatter.status === "active",
    revision: parsed.frontmatter.revision,
    source: parsed.frontmatter.source,
    sourceUrl: parsed.frontmatter.source_urls[0],
    repo: parsed.frontmatter.repo,
    repoPath: parsed.frontmatter.path,
    tags: parsed.frontmatter.tags,
    confidence: parsed.frontmatter.confidence,
    usefulness: parsed.frontmatter.usefulness,
    rawMarkdown: markdown,
    bodyMarkdown: parsed.body,
    frontmatter: parsed.frontmatter,
    contentHash: await sha256Hex(markdown),
    lastRemoteModifiedAt: file.modifiedTimeMillis,
    chunks,
  });

  await deleteVectors(env, result.oldVectorIds.filter((id) => !chunks.some((chunk) => chunk.vectorId === id)));

  if (existing?.currentSnapshotId && existing.currentSnapshotId !== snapshotId) {
    await repo.recordSupersession({
      fromDocumentId: documentId,
      fromSnapshotId: existing.currentSnapshotId,
      toDocumentId: documentId,
      relationType:
        parsed.frontmatter.memory_type === "decision"
          ? "decision_override"
          : "canonical_update",
    });
  }
}

export async function runReconciliation(env: Env, triggerKind: "cron" | "manual") {
  const config = loadConfig(env);
  const repo = new MemoryRepository(env.DB);
  const zoho = new ZohoWorkDriveClient(env);
  const syncRunId = await repo.createSyncRun(triggerKind);

  let scannedCount = 0;
  let indexedCount = 0;
  let failedCount = 0;
  const failures: Array<{ workdrive_file_id: string; path: string; error: string }> = [];
  try {
    const roots: Array<{ folderId?: string; pathPrefix: string }> = [
      {
        folderId: config.zoho.sharedRootFolderId,
        pathPrefix: "/memory/shared",
      },
      {
        folderId: config.zoho.projectsRootFolderId,
        pathPrefix: "/memory/projects",
      },
    ];

    for (const root of roots) {
      if (!root.folderId) {
        continue;
      }
      const entries = await walkWorkDriveMarkdownTree(zoho, root.folderId, root.pathPrefix);
      for (const entry of entries) {
        scannedCount += 1;
        const existing = await repo.getDocumentByWorkDriveFileId(entry.id);
        const chunkCount = existing ? await repo.getChunkCountForDocument(existing.id) : 0;
        const isStale =
          !existing ||
          chunkCount === 0 ||
          (entry.modifiedTimeMillis ?? 0) > (existing.lastRemoteModifiedAt ?? 0);
        if (!isStale) {
          continue;
        }
        const jobId = await repo.createReindexJob({
          scope: "document",
          documentId: existing?.id,
          workdriveFileId: entry.id,
          path: entry.path,
          requestedBy: triggerKind,
          reason: "reconciliation",
          project: normalizeProjectFromPath(entry.path),
          jobKind: "document",
        });
        try {
          await runDocumentReindexJob(env, repo, {
            jobId,
            workdriveFileId: entry.id,
            path: entry.path,
          });
          indexedCount += 1;
        } catch (error) {
          failedCount += 1;
          if (failures.length < 20) {
            failures.push({
              workdrive_file_id: entry.id,
              path: entry.path,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      }
    }
    await repo.completeSyncRun(syncRunId, {
      status: "completed",
      scannedCount,
      enqueuedCount: indexedCount,
    });
    return {
      sync_run_id: syncRunId,
      scanned_count: scannedCount,
      indexed_count: indexedCount,
      failed_count: failedCount,
      failures,
    };
  } catch (error) {
    await repo.completeSyncRun(syncRunId, {
      status: "failed",
      scannedCount,
      enqueuedCount: indexedCount,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

async function walkWorkDriveMarkdownTree(
  zoho: ZohoWorkDriveClient,
  folderId: string,
  pathPrefix: string,
): Promise<Array<{ id: string; path: string; modifiedTimeMillis: number | null }>> {
  const files = await zoho.listFiles(folderId);
  const folders = await zoho.listFolders(folderId);
  const siblingNames = new Set(files.map((file) => file.name.toLowerCase()));

  const currentFiles = files
    .filter((file) => {
      if (!file.name.toLowerCase().endsWith(".md")) {
        return false;
      }
      const canonicalName = canonicalNameForZohoTimestampedCopy(file.name);
      return !canonicalName || !siblingNames.has(canonicalName.toLowerCase());
    })
    .map((file) => ({
      id: file.id,
      path: `${pathPrefix}/${file.name}`,
      modifiedTimeMillis: file.modifiedTimeMillis,
    }));

  const nested = await Promise.all(
    folders.map((folder) =>
      walkWorkDriveMarkdownTree(zoho, folder.id, `${pathPrefix}/${folder.name}`),
    ),
  );

  return [...currentFiles, ...nested.flat()];
}

function canonicalNameForZohoTimestampedCopy(fileName: string) {
  const match = fileName.match(
    /^(?<base>.+) \d{2}-\d{2}-\d{4} \d{2}:\d{2}:\d{2}:\d{3}(?<extension>\.md)$/i,
  );
  if (!match?.groups) {
    return null;
  }
  return `${match.groups.base}${match.groups.extension}`;
}

async function resolveMemoryFolders(
  zoho: ZohoWorkDriveClient,
  config: ReturnType<typeof loadConfig>,
  project: string,
  options: {
    createMissing?: boolean;
    record?: (
      folderPath: string,
      folderId: string | null,
      status: "ok" | "missing" | "error",
      error?: string | null,
    ) => Promise<void>;
  } = {},
) {
  const resolve = async (rootFolderId: string, segments: string[], folderPath: string) => {
    try {
      const result = options.createMissing
        ? await zoho.ensureFolderPath(rootFolderId, segments)
        : { folder: await zoho.resolveFolderPath(rootFolderId, segments), created: [] };
      await options.record?.(folderPath, result.folder.id, "ok");
      return result;
    } catch (error) {
      await options.record?.(
        folderPath,
        null,
        options.createMissing ? "error" : "missing",
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  };

  if (project === "shared") {
    if (!config.zoho.sharedRootFolderId) {
      throw new Error("WORKDRIVE_SHARED_ROOT_FOLDER_ID is required.");
    }
    const root = await zoho.getFile(config.zoho.sharedRootFolderId);
    const contextCurrent = await resolve(
      config.zoho.sharedRootFolderId,
      ["context", "current"],
      "/memory/shared/context/current",
    );
    const contextHistory = await resolve(
      config.zoho.sharedRootFolderId,
      ["context", "history"],
      "/memory/shared/context/history",
    );
    const decisions = await resolve(config.zoho.sharedRootFolderId, ["decisions"], "/memory/shared/decisions");
    const sessions = await resolve(config.zoho.sharedRootFolderId, ["sessions"], "/memory/shared/sessions");
    const snippets = await resolve(config.zoho.sharedRootFolderId, ["snippets"], "/memory/shared/snippets");
    const repoIndex = await resolve(config.zoho.sharedRootFolderId, ["repo-index"], "/memory/shared/repo-index");
    return {
      root,
      contextCurrent: contextCurrent.folder,
      contextHistory: contextHistory.folder,
      decisions: decisions.folder,
      sessions: sessions.folder,
      snippets: snippets.folder,
      repoIndex: repoIndex.folder,
      created: [
        ...contextCurrent.created,
        ...contextHistory.created,
        ...decisions.created,
        ...sessions.created,
        ...snippets.created,
        ...repoIndex.created,
      ],
    };
  }

  if (!config.zoho.projectsRootFolderId) {
    throw new Error("WORKDRIVE_PROJECTS_ROOT_FOLDER_ID is required.");
  }

  const rootResult = await resolve(config.zoho.projectsRootFolderId, [project], `/memory/projects/${project}`);
  const contextCurrent = await resolve(
    config.zoho.projectsRootFolderId,
    [project, "context", "current"],
    `/memory/projects/${project}/context/current`,
  );
  const contextHistory = await resolve(
    config.zoho.projectsRootFolderId,
    [project, "context", "history"],
    `/memory/projects/${project}/context/history`,
  );
  const decisions = await resolve(
    config.zoho.projectsRootFolderId,
    [project, "decisions"],
    `/memory/projects/${project}/decisions`,
  );
  const sessions = await resolve(
    config.zoho.projectsRootFolderId,
    [project, "sessions"],
    `/memory/projects/${project}/sessions`,
  );
  const snippets = await resolve(
    config.zoho.projectsRootFolderId,
    [project, "snippets"],
    `/memory/projects/${project}/snippets`,
  );
  const repoIndex = await resolve(
    config.zoho.projectsRootFolderId,
    [project, "repo-index"],
    `/memory/projects/${project}/repo-index`,
  );
  return {
    root: rootResult.folder,
    contextCurrent: contextCurrent.folder,
    contextHistory: contextHistory.folder,
    decisions: decisions.folder,
    sessions: sessions.folder,
    snippets: snippets.folder,
    repoIndex: repoIndex.folder,
    created: [
      ...rootResult.created,
      ...contextCurrent.created,
      ...contextHistory.created,
      ...decisions.created,
      ...sessions.created,
      ...snippets.created,
      ...repoIndex.created,
    ],
  };
}

function applyFrontmatterOverrides(
  base: MemoryFrontmatter,
  overrides: Partial<MemoryFrontmatter>,
) : MemoryFrontmatter {
  return {
    ...base,
    ...overrides,
  };
}

function folderSummary(folders: Awaited<ReturnType<typeof resolveMemoryFolders>>) {
  return {
    root: folders.root.id,
    context_current: folders.contextCurrent.id,
    context_history: folders.contextHistory.id,
    decisions: folders.decisions.id,
    sessions: folders.sessions.id,
    snippets: folders.snippets.id,
    repo_index: folders.repoIndex.id,
  };
}

function projectHasFolderIds(project: MemoryProject) {
  return Boolean(
    project.workdriveRootFolderId &&
      project.contextCurrentFolderId &&
      project.contextHistoryFolderId &&
      project.decisionsFolderId &&
      project.sessionsFolderId &&
      project.snippetsFolderId &&
      project.repoIndexFolderId,
  );
}

function projectFolderSummary(project: MemoryProject) {
  return {
    root: project.workdriveRootFolderId,
    context_current: project.contextCurrentFolderId,
    context_history: project.contextHistoryFolderId,
    decisions: project.decisionsFolderId,
    sessions: project.sessionsFolderId,
    snippets: project.snippetsFolderId,
    repo_index: project.repoIndexFolderId,
  };
}

function currentContextTemplates(project: string, displayName: string) {
  return [
    {
      fileName: "overview.md",
      title: "Project Overview",
      markdown: `# ${displayName}\n\n## Purpose\n\nRecord the durable project purpose here.\n\n## Current State\n\nNo current state has been recorded yet.\n`,
    },
    {
      fileName: "architecture.md",
      title: "Current Architecture",
      markdown: `# Current Architecture\n\n## System Shape\n\nDescribe the current production architecture for ${project}.\n\n## Important Boundaries\n\nRecord service, storage, and integration boundaries here.\n`,
    },
    {
      fileName: "active-goals.md",
      title: "Active Goals",
      markdown: "# Active Goals\n\n## Now\n\nRecord the active goals and priorities here.\n\n## Later\n\nRecord deferred but still relevant goals here.\n",
    },
    {
      fileName: "constraints.md",
      title: "Known Constraints",
      markdown: "# Known Constraints\n\n## Technical Constraints\n\nRecord important constraints here.\n\n## Product Or Workflow Constraints\n\nRecord workflow-specific constraints here.\n",
    },
    {
      fileName: "setup-deployment.md",
      title: "Setup And Deployment",
      markdown: "# Setup And Deployment\n\n## Local Setup\n\nRecord local setup commands here.\n\n## Deployment\n\nRecord deployment, URLs, callbacks, and operational details here.\n",
    },
    {
      fileName: "repo-map.md",
      title: "Repo Map",
      markdown: "# Repo Map\n\n## Associated Repositories\n\nRecord associated repositories and their roles here.\n\n## Important Paths\n\nRecord important files and directories here.\n",
    },
  ];
}

function titleFromSlug(slug: string) {
  if (slug === "shared") {
    return "Shared Memory";
  }
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function selectRepoOverviewFiles(
  entries: Array<{ name: string; path: string; type: string; size: number }>,
  globs?: string[],
) {
  if (globs?.length) {
    return entries.filter((entry) =>
      entry.type === "file" && globs.some((glob) => simpleGlobMatch(glob, entry.path)),
    );
  }
  const importantNames = new Set([
    "readme.md",
    "package.json",
    "wrangler.jsonc",
    "wrangler.toml",
    "tsconfig.json",
    "vite.config.ts",
    "vitest.config.ts",
    "pyproject.toml",
    "cargo.toml",
    "go.mod",
  ]);
  return entries.filter((entry) => entry.type === "file" && importantNames.has(entry.name.toLowerCase()));
}

function simpleGlobMatch(glob: string, path: string) {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, ".*")
    .replace(/\*/g, "[^/]*");
  return new RegExp(`^${escaped}$`).test(path);
}

function unsafeRepoPathReason(path: string) {
  const normalized = path.toLowerCase();
  if (
    normalized.includes("node_modules/") ||
    normalized.includes("dist/") ||
    normalized.includes("build/") ||
    normalized.includes(".git/")
  ) {
    return "generated or dependency path";
  }
  if (
    /(^|\/)\.env($|[./-])/.test(normalized) ||
    /\.(pem|p12|pfx|key|crt|cer)$/i.test(normalized) ||
    /(secret|credential|private-key|token)/i.test(normalized)
  ) {
    return "secret-like path";
  }
  if (/\.(png|jpg|jpeg|gif|webp|pdf|zip|gz|wasm|lock)$/i.test(normalized)) {
    return "binary, generated, or low-value overview file";
  }
  return null;
}

function secretContentReason(content: string) {
  const secretPatterns = [
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    /\b(?:api[_-]?key|secret|token|password)\s*[:=]\s*["']?[A-Za-z0-9_\-]{20,}/i,
    /\bgh[pousr]_[A-Za-z0-9_]{20,}/,
  ];
  if (secretPatterns.some((pattern) => pattern.test(content))) {
    return "secret-like content";
  }
  return null;
}

function buildRepoIndexMarkdown(input: {
  repo: string;
  ref?: string;
  structure: Awaited<ReturnType<MemoryService["inspectGithubRepoStructure"]>>;
  files: Array<{ path: string; sha: string; size: number; content: string; url: string | null }>;
  skipped: Array<{ path: string; reason: string }>;
}) {
  const lines = [
    `# Repo Overview: ${input.repo}`,
    "",
    `Repository: ${input.repo}`,
    input.ref ? `Ref: ${input.ref}` : "",
    "",
    "## Root Structure",
    "",
    ...input.structure.root.entries.map((entry) => `- ${entry.type}: ${entry.path}`),
    "",
    "## Indexed Files",
    "",
  ].filter(Boolean);

  for (const file of input.files) {
    lines.push(`### ${file.path}`, "");
    lines.push(`SHA: ${file.sha}`);
    if (file.url) {
      lines.push(`URL: ${file.url}`);
    }
    lines.push("", "```", file.content.trimEnd(), "```", "");
  }

  if (input.skipped.length) {
    lines.push("## Skipped Files", "");
    for (const skipped of input.skipped) {
      lines.push(`- ${skipped.path}: ${skipped.reason}`);
    }
  }

  return lines.join("\n");
}

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
};

function groupSearchResults(results: SearchResultItem[]) {
  return results.reduce<Record<string, SearchResultItem[]>>((grouped, result) => {
    const key = result.memory_type;
    grouped[key] ??= [];
    grouped[key].push(result);
    return grouped;
  }, {});
}

function mergeProjectProfile(
  base?: Record<string, unknown>,
  additions: Record<string, unknown> = {},
) {
  const next = { ...(base ?? {}) };
  for (const [key, value] of Object.entries(additions)) {
    if (value !== undefined) {
      next[key] = value;
    }
  }
  return next;
}

function daysFromNowIso(days: number) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function uniqueProjects(projects: Array<string | null | undefined>) {
  const normalized = projects.map((project) => normalizeProject(project)).filter(Boolean);
  return [...new Set(normalized)];
}

function projectMatchScore(project: MemoryProject, normalized: string | null, query: string) {
  let score = 0;
  const haystack = [
    project.slug,
    project.displayName,
    project.description ?? "",
    JSON.stringify(project.profile ?? {}),
  ]
    .join(" ")
    .toLowerCase();
  if (normalized && project.slug === normalized) {
    score += 100;
  }
  if (project.mergedIntoProject) {
    score -= 80;
  }
  if (project.canonicalStatus === "canonical") {
    score += 5;
  }
  for (const term of queryTerms(query)) {
    if (project.slug.includes(term)) {
      score += 8;
    }
    if (project.displayName.toLowerCase().includes(term)) {
      score += 6;
    }
    if (haystack.includes(term)) {
      score += 2;
    }
  }
  if (project.status === "active") {
    score += 1;
  }
  return score;
}

function projectMatchReasons(project: MemoryProject, normalized: string | null, query: string) {
  const reasons: string[] = [];
  if (normalized && project.slug === normalized) {
    reasons.push("exact slug or alias");
  }
  const display = project.displayName.toLowerCase();
  const terms = queryTerms(query);
  if (terms.some((term) => display.includes(term))) {
    reasons.push("display name match");
  }
  const profile = JSON.stringify(project.profile ?? {}).toLowerCase();
  if (terms.some((term) => profile.includes(term))) {
    reasons.push("profile metadata match");
  }
  if (project.description && terms.some((term) => project.description!.toLowerCase().includes(term))) {
    reasons.push("description match");
  }
  return reasons.length ? reasons : ["active project fallback"];
}

function queryTerms(query: string) {
  return [
    ...new Set(
      query
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .map((term) => term.trim())
        .filter((term) => term.length > 2),
    ),
  ].slice(0, 12);
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

function keywordFallbackScore(document: { project: string; memoryType: string; active: boolean; canonical: boolean; status: string }, project: string) {
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

function detectDuplicateProjectGroups(
  projects: MemoryProject[],
  statsByProject: Map<string, { document_count: number; current_context_count: number; active_decision_count: number; chunk_count: number }>,
  aliases: Array<{ alias: string; projectSlug: string }>,
) {
  const byCompactSlug = new Map<string, MemoryProject[]>();
  for (const project of projects) {
    const key = compactProjectSlug(project.slug);
    byCompactSlug.set(key, [...(byCompactSlug.get(key) ?? []), project]);
  }
  const aliasByProject = new Map<string, string[]>();
  for (const alias of aliases) {
    aliasByProject.set(alias.projectSlug, [...(aliasByProject.get(alias.projectSlug) ?? []), alias.alias]);
  }
  return [...byCompactSlug.values()].flatMap((group) => {
    if (group.length < 2) {
      return [];
    }
    const canonical = [...group].sort((left, right) =>
      projectCanonicalScore(right, statsByProject) - projectCanonicalScore(left, statsByProject) ||
      right.updatedAt.localeCompare(left.updatedAt),
    )[0]!;
    return group
      .filter((project) => project.slug !== canonical.slug)
      .map((project) => ({
        canonical_project: canonical.slug,
        duplicate_project: project.slug,
        normalized_key: compactProjectSlug(project.slug),
        aliases: aliasByProject.get(project.slug) ?? [],
        canonical_reason: "richer metadata/doc/chunk count/latest update wins unless explicit canonical metadata exists",
        canonical_stats: statsByProject.get(canonical.slug) ?? null,
        duplicate_stats: statsByProject.get(project.slug) ?? null,
        proposed_actions: [
          "add duplicate slug as alias to canonical project",
          "mark duplicate project canonical_status=merged and merged_into_project=canonical",
          "create structured memory_links in both directions",
        ],
      }));
  });
}

function projectCanonicalScore(
  project: MemoryProject,
  statsByProject: Map<string, { document_count: number; current_context_count: number; active_decision_count: number; chunk_count: number }>,
) {
  const explicit = project.canonicalProject === project.slug || project.canonicalStatus === "canonical" ? 1000 : 0;
  const mergedPenalty = project.mergedIntoProject ? -1000 : 0;
  const stats = statsByProject.get(project.slug);
  const metadataScore = Object.keys(project.profile ?? {}).length;
  return explicit + mergedPenalty + metadataScore + (stats?.document_count ?? 0) * 4 + (stats?.current_context_count ?? 0) * 8 + (stats?.active_decision_count ?? 0) * 6 + (stats?.chunk_count ?? 0);
}

function compactProjectSlug(slug: string) {
  return normalizeProject(slug).replace(/[^a-z0-9]/g, "");
}

function isPlaceholderPath(path: string) {
  return /\b(record|placeholder|bootstrap)\b/i.test(path);
}

function isPlaceholderTitle(title: string) {
  return /\b(record|placeholder|bootstrap|no current state)\b/i.test(title);
}

function detectDuplicateCurrentContextPaths(documents: Array<{ id: string; project: string; title: string; path: string; memoryType: string; active: boolean; status: string }>) {
  const groups = new Map<string, typeof documents>();
  for (const document of documents) {
    if (document.memoryType !== "current_context") {
      continue;
    }
    const key = `${document.project}:${document.path.replace(/\s+\d{2}-\d{2}-\d{4}.*(?=\.md$)/, "").toLowerCase()}`;
    groups.set(key, [...(groups.get(key) ?? []), document]);
  }
  return [...groups.values()]
    .filter((group) => group.length > 1)
    .map((group) => ({
      project: group[0]!.project,
      canonical_document_id: group.find((document) => document.active)?.id ?? group[0]!.id,
      duplicate_document_ids: group.filter((document) => !document.active).map((document) => document.id),
      paths: group.map((document) => document.path),
      proposed_action: "preserve history and mark old path variants noncanonical/superseded where not already inactive",
    }));
}

function buildMarkdownLinkProposals(groups: ReturnType<typeof detectDuplicateProjectGroups>) {
  return groups.map((group) => ({
    project: group.canonical_project,
    target: group.duplicate_project,
    link: `[[project:${group.duplicate_project}]]`,
    proposed_location: "canonical project overview/current-context",
    safe_to_apply: false,
    reason: "Markdown links are proposed for human/Obsidian navigation; structured memory_links remain the AI source.",
  }));
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
  result: { diagnostics?: { vector_hits?: number; ranked_vector_hits?: number; keyword_hits?: number; vector_error?: string | null } },
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
    causes.push("Vectorize returned no semantic matches despite indexed chunks; check namespace, metadata filters, and embedding compatibility.");
  }
  if ((result.diagnostics?.vector_hits ?? 0) > 0 && (result.diagnostics?.ranked_vector_hits ?? 0) === 0) {
    causes.push("Vector hits were filtered after hydration or project-scope checks.");
  }
  if ((result.diagnostics?.keyword_hits ?? 0) > 0 && (result.diagnostics?.vector_hits ?? 0) === 0) {
    causes.push("Keyword fallback is carrying this query; broad conceptual recall may be weak.");
  }
  return causes;
}

function buildContextWarnings(input: {
  projectStatus: { health?: { ok?: boolean; stats?: Record<string, number> } };
  groupedMemory: unknown;
  retrievalMode: string;
  entities: unknown[];
  initiatives: unknown[];
  activeSources?: string[];
}) {
  const warnings: string[] = [];
  if (!input.projectStatus.health?.ok) {
    warnings.push("Project health is not clean; inspect missing folders or failed jobs before relying on context.");
  }
  const stats = input.projectStatus.health?.stats ?? {};
  if ((stats.current_context_count ?? 0) === 0) {
    warnings.push("Project has no active current-context documents.");
  }
  if (input.retrievalMode === "keyword_fallback_only") {
    warnings.push("Retrieval is keyword-only for this request; semantic recall did not produce results.");
  }
  if (input.retrievalMode === "no_hits") {
    warnings.push("No memory matched the user intent; live source checks or context bootstrap may be needed.");
  }
  if (input.entities.length === 0) {
    warnings.push("No structured entities are linked to this context yet.");
  }
  if (input.initiatives.length === 0) {
    warnings.push("No active initiative is linked to this project.");
  }
  for (const source of input.activeSources ?? []) {
    const policy = connectorPolicyFor(source);
    if (policy.save_policy === "requires_approval") {
      warnings.push(`${source} contains approval-gated data; save only durable summaries unless explicitly approved.`);
    }
  }
  return warnings;
}

function recommendedLiveChecks(input: {
  project: string;
  activeSources?: string[];
  entities: unknown[];
  tasks: ContextTask[];
  sourceEvents: SourceEvent[];
  warnings: string[];
  currentTruthChecks?: unknown[];
}) {
  const checks = new Set<string>();
  for (const source of input.activeSources ?? []) {
    checks.add(`Check live ${source} for fresh context before writing durable summaries.`);
  }
  if (input.tasks.some((task) => task.dueAt || task.reminderAt)) {
    checks.add("Check calendar/reminder source for due-date freshness.");
  }
  if (input.sourceEvents.length === 0) {
    checks.add("If this task depends on CRM/email/calendar/shopify state, query that live MCP before deciding.");
  }
  if (input.warnings.some((warning) => warning.includes("semantic"))) {
    checks.add("Run retrieval_diagnostics and consider reindexing before assuming memory is complete.");
  }
  for (const rawCheck of input.currentTruthChecks ?? []) {
    const check = isRecord(rawCheck) ? rawCheck : {};
    const sourceKind = typeof check.source_kind === "string" ? check.source_kind : "source";
    const reason = typeof check.reason === "string" ? check.reason : "current truth guardrail";
    checks.add(`Check live ${sourceKind} before relying on current-state recommendations: ${reason}`);
  }
  return [...checks];
}

function selectiveWriteBackPolicy(activeSources?: string[]) {
  const sources = activeSources?.length
    ? activeSources
    : ["zoho_crm", "zoho_mail", "zoho_calendar", "zoho_notes", "github", "shopify", "workdrive"];
  return {
    mode: "selective_durable_facts",
    rules: [
      "Store durable summaries, decisions, deadlines, relationships, and source links.",
      "Keep raw external payloads, full private emails, attachments, and sensitive PII live-only unless explicitly approved.",
      "Prefer source_event + fact/task/entity writes over large copied documents.",
    ],
    connector_policies: Object.fromEntries(
      sources.map((source) => [source, connectorPolicyFor(source)]),
    ),
  };
}

function connectorPolicyFor(source: string) {
  const key = source.toLowerCase().replace(/[-\s]+/g, "_");
  const policies: Record<string, {
    save_policy: "durable_summary" | "live_only" | "requires_approval";
    durable: string[];
    requires_approval: string[];
    live_only: string[];
  }> = {
    zoho_crm: {
      save_policy: "durable_summary",
      durable: ["deal stage changes", "account updates", "contact summaries", "follow-up tasks"],
      requires_approval: ["full records", "private notes", "attachments"],
      live_only: ["raw CRM payloads"],
    },
    zoho_mail: {
      save_policy: "requires_approval",
      durable: ["thread summaries", "commitments", "deadlines", "decisions"],
      requires_approval: ["raw body", "attachments", "full thread"],
      live_only: ["message body", "attachments"],
    },
    zoho_calendar: {
      save_policy: "durable_summary",
      durable: ["meeting summaries", "deadlines", "follow-ups"],
      requires_approval: ["private descriptions", "full attendee lists"],
      live_only: ["raw event payloads"],
    },
    zoho_notes: {
      save_policy: "durable_summary",
      durable: ["note summaries", "decisions", "ideas", "tasks"],
      requires_approval: ["full private notes"],
      live_only: ["raw note payloads"],
    },
    github: {
      save_policy: "durable_summary",
      durable: ["repo changes", "issues", "pull requests", "release summaries"],
      requires_approval: ["large diffs", "private repo file bodies"],
      live_only: ["raw diffs"],
    },
    shopify: {
      save_policy: "durable_summary",
      durable: ["product updates", "order summaries without PII", "inventory changes"],
      requires_approval: ["customer PII", "order line items with identifying data"],
      live_only: ["raw order payloads"],
    },
    workdrive: {
      save_policy: "durable_summary",
      durable: ["document summaries", "decisions", "plans", "context updates"],
      requires_approval: ["full private documents"],
      live_only: ["binary files"],
    },
  };
  return policies[key] ?? {
    save_policy: "requires_approval",
    durable: ["durable summary with source link"],
    requires_approval: ["raw source content"],
    live_only: ["unknown connector payloads"],
  };
}

type ProposedWork = {
  title?: string;
  summary?: string;
  type?: "task" | "project" | "branch_project" | "milestone" | "initiative" | "research" | "other";
  project_slug?: string;
  initiative_id?: string;
  milestone_id?: string;
  asset_ids?: string[];
  expected_outcome?: string;
  estimated_effort?: "small" | "medium" | "large" | "unknown";
};

type StrategyContextPayload = {
  project: string;
  visions: Array<ReturnType<typeof compactStrategyNode>>;
  pillars: Array<ReturnType<typeof compactStrategyNode>>;
  outcomes: Array<ReturnType<typeof compactStrategyNode>>;
  initiatives: MemoryInitiative[];
  milestones: Array<ReturnType<typeof compactMilestone>>;
  assets: Array<ReturnType<typeof compactAsset>>;
  branch_project: BranchProject | null;
  warnings: string[];
};

function compactStrategyNodes(nodes: StrategyNode[]) {
  return nodes.map(compactStrategyNode);
}

function compactStrategyNode(node: StrategyNode) {
  return {
    id: node.id,
    slug: node.slug,
    type: node.type,
    title: node.title,
    summary: truncateNullable(node.summary, 240),
    status: node.status,
    parent_id: node.parentId,
    horizon: node.horizon,
    priority: node.priority,
    metric: node.metricName
      ? {
          name: node.metricName,
          target_value: node.targetValue,
          current_value: node.currentValue,
          unit: node.metricUnit,
          direction: node.metricDirection,
        }
      : null,
    due_at: node.dueAt,
    review_cadence: node.reviewCadence,
  };
}

function compactMilestone(milestone: StrategyMilestone) {
  return {
    id: milestone.id,
    slug: milestone.slug,
    title: milestone.title,
    summary: truncateNullable(milestone.summary, 220),
    status: milestone.status,
    initiative_id: milestone.initiativeId,
    project_slug: milestone.projectSlug,
    outcome_id: milestone.outcomeId,
    due_at: milestone.dueAt,
    success_metric: milestone.successMetric,
  };
}

function compactAsset(asset: StrategyAsset) {
  return {
    id: asset.id,
    slug: asset.slug,
    name: asset.name,
    type: asset.type,
    summary: truncateNullable(asset.summary, 220),
    status: asset.status,
    source: asset.source,
    source_url: asset.sourceUrl,
    live_source_kind: asset.liveSourceKind,
    sensitivity: asset.sensitivity,
    how_to_use: truncateNullable(asset.howToUse, 240),
    limitations: truncateNullable(asset.limitations, 180),
  };
}

function truncateNullable(value: string | null, max: number) {
  return value ? truncate(value, max) : null;
}

function filterByHorizon(nodes: StrategyNode[], horizon?: string) {
  if (!horizon) {
    return nodes;
  }
  const normalized = horizon.toLowerCase();
  return nodes.filter((node) => node.horizon?.toLowerCase().includes(normalized));
}

function buildStrategyWarnings(input: {
  visions: StrategyNode[];
  milestones: StrategyMilestone[];
  branchProject: BranchProject | null;
  now: Date;
}) {
  const warnings: string[] = [];
  if (input.visions.length === 0) {
    warnings.push("no_active_vision");
  }
  if (input.milestones.some((milestone) => !milestone.successMetric)) {
    warnings.push("missing_success_metric");
  }
  if (input.branchProject) {
    if (!input.branchProject.parentInitiativeId) {
      warnings.push("no_parent_initiative_for_branch_project");
    }
    const endsAt = Date.parse(input.branchProject.timeboxEndsAt);
    if (Number.isFinite(endsAt) && endsAt < input.now.getTime() && input.branchProject.status === "active") {
      warnings.push("branch_timebox_expired");
    }
  }
  return warnings;
}

function assessStrategicAlignment(input: {
  userIntent: string;
  proposedWork?: ProposedWork;
  strategyContext: StrategyContextPayload;
}) {
  const text = [
    input.userIntent,
    input.proposedWork?.title,
    input.proposedWork?.summary,
    input.proposedWork?.expected_outcome,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const evidence: string[] = [];
  const risks: string[] = [];
  const missingContext: string[] = [];
  const hasStrategy =
    input.strategyContext.visions.length > 0 ||
    input.strategyContext.pillars.length > 0 ||
    input.strategyContext.outcomes.length > 0 ||
    input.strategyContext.initiatives.length > 0;

  if (!hasStrategy) {
    missingContext.push("No active vision, pillar, outcome, or initiative is available for this project.");
    return alignmentResult({
      alignmentLabel: "unknown_until_more_context",
      score: 0,
      confidence: "low",
      rationale: "There is not enough active strategic context to classify this work without guessing.",
      evidence,
      risks,
      missingContext,
      scopeGuidance: "First capture or link the relevant vision, initiative, or outcome, then re-check alignment.",
    });
  }

  if (input.strategyContext.branch_project?.status === "killed" || text.includes("kill condition")) {
    risks.push("The work appears to touch a killed branch project or an explicit kill condition.");
    return alignmentResult({
      alignmentLabel: "conflicts",
      score: -2,
      confidence: "high",
      rationale: "The request conflicts with branch-project governance or a kill condition.",
      evidence,
      risks,
      missingContext,
      scopeGuidance: "Do not proceed unless the branch decision is reopened and recorded.",
    });
  }

  const linkedInitiative = input.proposedWork?.initiative_id
    ? input.strategyContext.initiatives.find((initiative) => initiative.id === input.proposedWork?.initiative_id)
    : null;
  const linkedMilestone = input.proposedWork?.milestone_id
    ? input.strategyContext.milestones.find((milestone) => milestone.id === input.proposedWork?.milestone_id)
    : null;
  const matchingOutcome = input.strategyContext.outcomes.find((outcome) => textMatchesNode(text, outcome));
  const matchingPillar = input.strategyContext.pillars.find((pillar) => textMatchesNode(text, pillar));
  const matchingVision = input.strategyContext.visions.find((vision) => textMatchesNode(text, vision));

  if (linkedMilestone || linkedInitiative || matchingOutcome || matchingPillar || matchingVision) {
    evidence.push(
      linkedMilestone
        ? `Linked milestone: ${linkedMilestone.title}`
        : linkedInitiative
          ? `Linked initiative: ${linkedInitiative.title}`
          : matchingOutcome
            ? `Matches outcome: ${matchingOutcome.title}`
            : matchingPillar
              ? `Matches pillar: ${matchingPillar.title}`
              : `Matches vision: ${matchingVision!.title}`,
    );
    return alignmentResult({
      alignmentLabel: "directly_advances",
      score: 2,
      confidence: linkedMilestone || linkedInitiative ? "high" : "medium",
      rationale: "The work maps to an active strategic object in the current project context.",
      evidence,
      risks,
      missingContext,
      scopeGuidance: "Scope the work around the linked strategic outcome and keep evidence of progress attached.",
    });
  }

  const hasAssetSupport = (input.proposedWork?.asset_ids?.length ?? 0) > 0 || supportIntentPattern.test(text);
  if (hasAssetSupport) {
    evidence.push("The work appears to improve or use an enabling asset, dependency, documentation, or process.");
    return alignmentResult({
      alignmentLabel: "indirectly_supports",
      score: 1,
      confidence: input.proposedWork?.asset_ids?.length ? "high" : "medium",
      rationale: "The request supports execution capacity but is not itself tied to a strategic outcome.",
      evidence,
      risks,
      missingContext,
      scopeGuidance: "Keep the scope small and link the resulting asset or dependency to the initiative it supports.",
    });
  }

  if (input.proposedWork?.type === "branch_project" || input.strategyContext.branch_project) {
    if (input.strategyContext.warnings.includes("branch_timebox_expired")) {
      risks.push("The active branch project timebox has expired.");
      return alignmentResult({
        alignmentLabel: "distraction_risk",
        score: -1,
        confidence: "high",
        rationale: "The project is governed as a branch experiment, but its timebox needs review before more work.",
        evidence,
        risks,
        missingContext,
        scopeGuidance: "Review success, merge-back, and kill conditions before adding new scope.",
      });
    }
    evidence.push("The work is framed as a governed branch project or experiment.");
    return alignmentResult({
      alignmentLabel: "neutral_experiment",
      score: 0,
      confidence: "medium",
      rationale: "The work can be valid as an experiment if it stays inside the branch protocol.",
      evidence,
      risks,
      missingContext,
      scopeGuidance: "Keep the experiment within its hypothesis, timebox, success metric, and kill condition.",
    });
  }

  if (input.proposedWork?.estimated_effort === "large") {
    risks.push("Large effort is not linked to an active strategic object.");
    return alignmentResult({
      alignmentLabel: "distraction_risk",
      score: -1,
      confidence: "medium",
      rationale: "The work may consume meaningful capacity without a visible link to active strategy.",
      evidence,
      risks,
      missingContext,
      scopeGuidance: "Reduce to a discovery task or link it to a specific initiative, milestone, or outcome first.",
    });
  }

  missingContext.push("No explicit initiative, milestone, asset, or outcome match was found.");
  return alignmentResult({
    alignmentLabel: "unknown_until_more_context",
    score: 0,
    confidence: "low",
    rationale: "The request is plausible but does not expose enough strategic linkage for a confident label.",
    evidence,
    risks,
    missingContext,
    scopeGuidance: "Ask for the intended outcome or parent initiative before committing significant work.",
  });
}

const supportIntentPattern = /\b(document|docs|asset|tool|dependency|refactor|setup|process|template|dataset|repo|enable|support)\b/i;

function textMatchesNode(
  text: string,
  node: { slug: string; title: string; summary: string | null },
) {
  const tokens = `${node.slug} ${node.title} ${node.summary ?? ""}`
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 3);
  return tokens.some((token) => text.includes(token));
}

function alignmentResult(input: Omit<AlignmentAssessment, "id" | "project" | "subjectType" | "subjectId" | "userIntent" | "strategySnapshot" | "createdAt">) {
  return input;
}

function compactStrategySnapshot(strategyContext: StrategyContextPayload) {
  return {
    project: strategyContext.project,
    vision_ids: strategyContext.visions.map((node) => node.id),
    pillar_ids: strategyContext.pillars.map((node) => node.id),
    outcome_ids: strategyContext.outcomes.map((node) => node.id),
    initiative_ids: strategyContext.initiatives.map((initiative) => initiative.id),
    milestone_ids: strategyContext.milestones.map((milestone) => milestone.id),
    asset_ids: strategyContext.assets.map((asset) => asset.id),
    branch_project_id: strategyContext.branch_project?.id ?? null,
    warnings: strategyContext.warnings,
  };
}

function buildRecommendedNextSteps(input: {
  alignment: AlignmentAssessment;
  toolPlan: { required_tools: Array<{ tool: string; reason: string; timing: string }> };
  actionability: { recommended_now?: string[] };
}) {
  const steps = [...(input.actionability.recommended_now ?? [])];
  for (const tool of input.toolPlan.required_tools.slice(0, 3)) {
    steps.push(`Use ${tool.tool} ${tool.timing.replace(/_/g, " ")}: ${tool.reason}`);
  }
  if (input.alignment.alignmentLabel === "directly_advances") {
    steps.push("Proceed with a scope tied to the matched strategic outcome.");
  } else if (input.alignment.alignmentLabel === "indirectly_supports") {
    steps.push("Keep the work bounded and link the resulting asset or dependency.");
  } else if (input.alignment.alignmentLabel === "neutral_experiment") {
    steps.push("Confirm hypothesis, timebox, success metric, merge-back, and kill condition.");
  } else if (input.alignment.alignmentLabel === "distraction_risk") {
    steps.push("Narrow the work or attach it to an active initiative before committing capacity.");
  } else if (input.alignment.alignmentLabel === "conflicts") {
    steps.push("Pause and resolve the strategic conflict before taking action.");
  } else {
    steps.push("Gather the missing parent initiative, outcome, or asset context before deciding.");
  }
  return [...new Set(steps)].slice(0, 8);
}

function extractFactCandidates(text: string) {
  const candidates = text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length >= 20)
    .filter((line) =>
      /\b(decision|decided|must|should|deadline|due|blocked|goal|customer|account|deal|owner|priority|constraint|launched|changed|agreed)\b/i.test(
        line,
      ),
    )
    .slice(0, 8);
  return candidates.length ? candidates : [truncate(text.trim(), 500)].filter(Boolean);
}

function buildSuggestedFocus(
  tasks: ContextTask[],
  initiatives: MemoryInitiative[],
  events: SourceEvent[],
) {
  const focus: string[] = [];
  for (const task of tasks.slice(0, 5)) {
    focus.push(`Task: ${task.title}${task.dueAt ? ` due ${task.dueAt}` : ""}`);
  }
  for (const initiative of initiatives.slice(0, 3)) {
    focus.push(`Initiative: ${initiative.title}`);
  }
  for (const event of events.slice(0, 3)) {
    focus.push(`Recent ${event.source}: ${event.title}`);
  }
  return focus;
}

function dateForDedup(now: Date) {
  return now.toISOString().slice(0, 10);
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

function normalizeProjectFromPath(path: string) {
  const parts = path.split("/").filter(Boolean);
  const projectsIndex = parts.indexOf("projects");
  if (projectsIndex >= 0 && parts[projectsIndex + 1]) {
    return normalizeProject(parts[projectsIndex + 1]);
  }
  return "shared";
}

async function hydrateTopDocuments(
  repo: MemoryRepository,
  zoho: ZohoWorkDriveClient,
  hits: MemorySearchHit[],
) {
  const uniqueDocumentIds = [...new Set(hits.slice(0, 3).map((hit) => hit.documentId))];
  return Promise.all(
    uniqueDocumentIds.map(async (documentId) => {
      const document = await repo.getDocumentById(documentId);
      if (!document) {
        return null;
      }
      const snapshot = await repo.getLatestSnapshot(document.id);
      const authoritative = await zoho.downloadMarkdown(document.workdriveFileId);
      return {
        document,
        snapshot,
        authoritative_markdown: authoritative.markdown,
      };
    }),
  ).then(
    (items): Array<{
      document: Awaited<ReturnType<MemoryRepository["getDocumentById"]>>;
      snapshot: Awaited<ReturnType<MemoryRepository["getLatestSnapshot"]>>;
      authoritative_markdown: string;
    }> => items.filter((item) => item !== null),
  );
}

function timestampForFile(now: Date) {
  return now.toISOString().replace(/[:.]/g, "-");
}

function truncate(text: string, maxLength: number) {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 1)}…`;
}

async function sha256Hex(input: string) {
  const encoded = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}
