import { loadConfig } from "~/config/env";
import { buildAssistantActionPlan } from "~/domain/assistant-planning";
import { chunkMarkdown } from "~/domain/chunking";
import { parseMarkdownDocument } from "~/domain/frontmatter";
import {
  buildLogicalPath,
  buildMarkdownDocument,
  createSystemFrontmatter,
  inferMemoryTypeFromPath,
  isAdminPrincipal,
  type AssistantSearchScope,
  type ContextTask,
  type DurableFact,
  type EntityType,
  type MemoryType,
  type MemoryProject,
  normalizeProject,
  slugify,
  type MemoryFrontmatter,
  type MemoryInitiative,
  type MemoryPrincipal,
  type MemorySearchFilters,
  type MemorySearchHit,
  type SourceEvent,
} from "~/domain/memory";
import { rerankSearchHits } from "~/domain/ranking";
import { isVisibleInProjectScope } from "~/domain/scope";
import { GithubOAuthClient } from "~/integrations/github/client";
import { embedTexts } from "~/integrations/workers-ai/embeddings";
import { queryMemoryIndex, replaceDocumentVectors, deleteVectors } from "~/integrations/vectorize/client";
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

  async listProjects() {
    return { projects: await this.repo.listProjects() };
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

    return {
      results,
      grouped: groupSearchResults(results),
      documents: projectResults.flatMap((result) => result.documents ?? []),
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
  }) {
    const normalizedProject = normalizeProject(input.project);
    const namespaces =
      normalizedProject === "shared" ? ["shared"] : ["shared", normalizedProject];
    let hits: MemorySearchHit[] = [];
    let ranked: MemorySearchHit[] = [];
    let vectorError: string | null = null;
    const queryVariants = uniqueQueryVariants(input.query);
    let queryVariantDiagnostics: Array<{ label: string; query: string; vector_hits: number }> =
      queryVariants.map((variant) => ({ ...variant, vector_hits: 0 }));
    try {
      const vectorResult = await withTimeout(
        (async () => {
          const embeddings = await embedTexts(
            this.env,
            queryVariants.map((variant) => variant.query),
          );
          const variantResults = await Promise.all(
            queryVariants.map(async (variant, index) => {
              const variantHits = await queryMemoryIndex(
                this.env,
                embeddings[index],
                namespaces,
                {
                  project: normalizedProject,
                  includeSuperseded: input.includeSuperseded,
                  memoryTypes: input.memoryTypes,
                  statuses: input.statuses,
                  activeOnly: input.activeOnly,
                  repo: input.repo,
                  path: input.path,
                  source: input.source,
                  tags: input.tags,
                  limit: input.limit,
                  candidateLimit: semanticCandidateLimit(input.limit),
                },
              );
              return { ...variant, hits: variantHits };
            }),
          );
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
            ranked: rerankSearchHits(hydratedHits, {
              includeSuperseded: input.includeSuperseded,
              project: normalizedProject,
              repo: input.repo,
              path: input.path,
            }).slice(0, input.limit ?? 8),
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
      .slice(0, Math.max(0, (input.limit ?? 8) - ranked.length));

    const documents = input.authoritative
      ? await hydrateTopDocuments(this.repo, this.zoho, ranked)
      : [];

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
        })),
      );

    return {
      results,
      grouped: groupSearchResults(results),
      documents,
      diagnostics: {
        vector_hits: hits.length,
        ranked_vector_hits: ranked.length,
        keyword_hits: keywordMatches.length,
        vector_error: vectorError,
        namespaces,
        query_variants: queryVariantDiagnostics,
        keyword_fallback_used: keywordResults.length > 0,
        keyword_fallback_due_to_empty_semantic: hits.length === 0 && keywordResults.length > 0,
      },
    };
  }

  async prepareWorkSession(input: {
    project: string;
    topic?: string;
    authoritative?: boolean;
  }) {
    const assistantSession = await this.prepareAssistantSession({
      projectOrTopic: input.project,
      userIntent: input.topic,
      authoritative: input.authoritative,
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
  }) {
    const resolution = await this.resolveContext({
      projectOrTopic: input.projectOrTopic,
      userIntent: input.userIntent,
    });
    const activeProject = resolution.active_project;
    const project = activeProject.slug;
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
        })
      : { results: [], grouped: {}, documents: [], diagnostics: null };

    const initiativeContext = await Promise.all(
      initiatives.map(async (initiative) => this.getInitiativeContext({ initiative: initiative.slug })),
    );
    const relatedProjects = await this.loadRelatedProjects(project, relatedProjectLinks);
    const retrievalMode = classifyRetrievalMode(groupedMemory);
    const warnings = buildContextWarnings({
      projectStatus,
      groupedMemory,
      retrievalMode,
      entities,
      initiatives,
      activeSources: input.activeSources,
    });

    return {
      context_resolution: resolution,
      active_project: activeProject,
      related_projects: relatedProjects,
      initiative_context: initiativeContext,
      current_context: currentContext,
      grouped_memory: groupedMemory,
      entities,
      tasks,
      source_events: sourceEvents,
      facts,
      context_health: {
        retrieval_mode: retrievalMode,
        warnings,
        project_health: projectStatus.health,
      },
      ...assistantActionPlan,
      recommended_live_mcp_checks: recommendedLiveChecks({
        project,
        activeSources: input.activeSources,
        entities,
        tasks,
        sourceEvents,
        warnings,
      }),
      write_back_policy: selectiveWriteBackPolicy(input.activeSources),
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
    return {
      project,
      status,
      initiatives,
      upcoming_tasks: tasks,
      retrieval: diagnostics,
      warnings: buildContextWarnings({
        projectStatus: status,
        groupedMemory: diagnostics,
        retrievalMode: diagnostics ? classifyRetrievalMode(diagnostics) : "not_checked",
        entities: await this.repo.searchEntities({ project, limit: 5 }),
        initiatives,
        activeSources: [],
      }),
    };
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
