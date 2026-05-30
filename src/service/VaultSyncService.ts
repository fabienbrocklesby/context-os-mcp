import { loadConfig } from "~/config/env";
import type { ContextTask, DurableFact, MemoryEntity, MemoryInitiative, SourceEvent } from "~/domain/memory";
import { slugify } from "~/domain/memory";
import {
  buildEntityVaultMarkdown,
  buildEventVaultMarkdown,
  buildFactVaultMarkdown,
  buildInitiativeVaultMarkdown,
  buildTaskVaultMarkdown,
  vaultSlugForTask,
} from "~/domain/vault-markdown";
import type { ZohoWorkDriveClient } from "~/integrations/zoho/client";
import type { InitiativeRepository } from "~/persistence/d1/InitiativeRepository";
import type { ProjectRepository } from "~/persistence/d1/ProjectRepository";

type StateValues = Record<string, { value: unknown; updated_at?: string | null }>;

export class VaultSyncService {
  private readonly projectRootCache = new Map<string, string | null>();
  private readonly folderIdCache = new Map<string, string>();
  private readonly initiativeCache = new Map<string, MemoryInitiative | null>();
  private memoryRootId: string | null | undefined = undefined;

  constructor(
    private readonly zoho: ZohoWorkDriveClient,
    private readonly config: ReturnType<typeof loadConfig>,
    private readonly projectRepo: ProjectRepository,
    private readonly initiativeRepo?: InitiativeRepository,
  ) {}

  async syncEntity(project: string, entity: MemoryEntity, states: StateValues): Promise<{ path: string; workdriveFileId: string } | null> {
    const initiative = await this.getInitiativeForProject(project);
    const memoryRootId = initiative ? await this.getMemoryRootFolderId() : null;

    if (initiative && memoryRootId) {
      const subfolder = entity.type === "person" ? "Team" : "Pipeline";
      const folderId = await this.getCachedFolder(memoryRootId, [initiative.title, subfolder]);
      const fileName = `${entity.name}.md`;
      const markdown = buildEntityVaultMarkdown(entity, states);
      const uploaded = await this.zoho.uploadMarkdownFile({ folderId, fileName, markdown, overrideExisting: true });
      return { path: `/memory/${initiative.title}/${subfolder}/${fileName}`, workdriveFileId: uploaded.id };
    }

    const rootId = await this.getProjectRootFolderId(project);
    if (!rootId) return null;
    const subfolder = entity.type === "person" ? "people" : "companies";
    const folderId = await this.getCachedFolder(rootId, ["knowledge", "entities", subfolder]);
    const fileName = `${entity.slug}.md`;
    const markdown = buildEntityVaultMarkdown(entity, states);
    const uploaded = await this.zoho.uploadMarkdownFile({ folderId, fileName, markdown, overrideExisting: true });
    return { path: `/memory/projects/${project}/knowledge/entities/${subfolder}/${fileName}`, workdriveFileId: uploaded.id };
  }

  async syncFact(project: string, fact: DurableFact): Promise<{ path: string; workdriveFileId: string } | null> {
    const initiative = await this.getInitiativeForProject(project);
    const memoryRootId = initiative ? await this.getMemoryRootFolderId() : null;

    if (initiative && memoryRootId) {
      const folderId = await this.getCachedFolder(memoryRootId, [initiative.title, "Knowledge"]);
      const fileName = `${fact.factKey ? slugify(fact.factKey).slice(0, 100) : fact.id}.md`;
      const markdown = buildFactVaultMarkdown(fact);
      const uploaded = await this.zoho.uploadMarkdownFile({ folderId, fileName, markdown, overrideExisting: true });
      return { path: `/memory/${initiative.title}/Knowledge/${fileName}`, workdriveFileId: uploaded.id };
    }

    const rootId = await this.getProjectRootFolderId(project);
    if (!rootId) return null;
    const folderId = await this.getCachedFolder(rootId, ["knowledge", "facts"]);
    const fileName = `${fact.factKey ? slugify(fact.factKey).slice(0, 100) : fact.id}.md`;
    const markdown = buildFactVaultMarkdown(fact);
    const uploaded = await this.zoho.uploadMarkdownFile({ folderId, fileName, markdown, overrideExisting: true });
    return { path: `/memory/projects/${project}/knowledge/facts/${fileName}`, workdriveFileId: uploaded.id };
  }

  async syncTask(project: string, task: ContextTask): Promise<{ path: string; workdriveFileId: string } | null> {
    const initiative = await this.getInitiativeForProject(project);
    const memoryRootId = initiative ? await this.getMemoryRootFolderId() : null;

    if (initiative && memoryRootId) {
      const folderId = await this.getCachedFolder(memoryRootId, [initiative.title, "Tasks"]);
      const fileName = `${vaultSlugForTask(task.title, task.id)}.md`;
      const markdown = buildTaskVaultMarkdown(task);
      const uploaded = await this.zoho.uploadMarkdownFile({ folderId, fileName, markdown, overrideExisting: true });
      return { path: `/memory/${initiative.title}/Tasks/${fileName}`, workdriveFileId: uploaded.id };
    }

    const rootId = await this.getProjectRootFolderId(project);
    if (!rootId) return null;
    const folderId = await this.getCachedFolder(rootId, ["operational", "tasks"]);
    const fileName = `${vaultSlugForTask(task.title, task.id)}.md`;
    const markdown = buildTaskVaultMarkdown(task);
    const uploaded = await this.zoho.uploadMarkdownFile({ folderId, fileName, markdown, overrideExisting: true });
    return { path: `/memory/projects/${project}/operational/tasks/${fileName}`, workdriveFileId: uploaded.id };
  }

  async syncEvent(project: string, event: SourceEvent): Promise<{ path: string; workdriveFileId: string } | null> {
    const initiative = await this.getInitiativeForProject(project);
    const memoryRootId = initiative ? await this.getMemoryRootFolderId() : null;

    if (initiative && memoryRootId) {
      const folderId = await this.getCachedFolder(memoryRootId, [initiative.title, "Events"]);
      const fileName = `${event.occurredAt?.slice(0, 10) ?? "no-date"}-${slugify(event.title).slice(0, 80)}.md`;
      const markdown = buildEventVaultMarkdown(event);
      const uploaded = await this.zoho.uploadMarkdownFile({ folderId, fileName, markdown, overrideExisting: true });
      return { path: `/memory/${initiative.title}/Events/${fileName}`, workdriveFileId: uploaded.id };
    }

    const rootId = await this.getProjectRootFolderId(project);
    if (!rootId) return null;
    const folderId = await this.getCachedFolder(rootId, ["operational", "events"]);
    const fileName = `${event.occurredAt?.slice(0, 10) ?? "no-date"}-${slugify(event.title).slice(0, 80)}.md`;
    const markdown = buildEventVaultMarkdown(event);
    const uploaded = await this.zoho.uploadMarkdownFile({ folderId, fileName, markdown, overrideExisting: true });
    return { path: `/memory/projects/${project}/operational/events/${fileName}`, workdriveFileId: uploaded.id };
  }

  async syncInitiative(
    initiative: Pick<MemoryInitiative, "id" | "slug" | "title" | "summary" | "status" | "createdAt" | "updatedAt">,
    entityNames: string[],
  ): Promise<{ path: string; workdriveFileId: string } | null> {
    const memoryRootId = await this.getMemoryRootFolderId();
    if (memoryRootId) {
      const folderId = await this.getCachedFolder(memoryRootId, [initiative.title]);
      const fileName = `${initiative.title}.md`;
      const markdown = buildInitiativeVaultMarkdown(initiative, entityNames);
      const uploaded = await this.zoho.uploadMarkdownFile({ folderId, fileName, markdown, overrideExisting: true });
      return { path: `/memory/${initiative.title}/${fileName}`, workdriveFileId: uploaded.id };
    }

    const sharedRootId = this.config.zoho.sharedRootFolderId;
    if (!sharedRootId) return null;
    const folderId = await this.getCachedFolder(sharedRootId, ["initiatives"]);
    const fileName = `${initiative.slug}.md`;
    const markdown = buildInitiativeVaultMarkdown(initiative, entityNames);
    const uploaded = await this.zoho.uploadMarkdownFile({ folderId, fileName, markdown, overrideExisting: true });
    return { path: `/memory/shared/initiatives/${fileName}`, workdriveFileId: uploaded.id };
  }

  private async getMemoryRootFolderId(): Promise<string | null> {
    if (this.memoryRootId !== undefined) return this.memoryRootId;
    const sharedRootId = this.config.zoho.sharedRootFolderId;
    if (!sharedRootId) {
      this.memoryRootId = null;
      return null;
    }
    try {
      const sharedFolder = await this.zoho.getFile(sharedRootId);
      this.memoryRootId = sharedFolder.parentId ?? null;
    } catch {
      this.memoryRootId = null;
    }
    return this.memoryRootId;
  }

  private async getInitiativeForProject(project: string): Promise<MemoryInitiative | null> {
    if (this.initiativeCache.has(project)) return this.initiativeCache.get(project) ?? null;
    if (!this.initiativeRepo) {
      this.initiativeCache.set(project, null);
      return null;
    }
    const initiatives = await this.initiativeRepo.listInitiatives({ project, status: "active" });
    const initiative = initiatives[0] ?? null;
    this.initiativeCache.set(project, initiative);
    return initiative;
  }

  private async getCachedFolder(rootId: string, segments: string[]): Promise<string> {
    const key = `${rootId}/${segments.join("/")}`;
    const cached = this.folderIdCache.get(key);
    if (cached) return cached;
    const { folder } = await this.zoho.ensureFolderPath(rootId, segments);
    this.folderIdCache.set(key, folder.id);
    return folder.id;
  }

  private async getProjectRootFolderId(project: string): Promise<string | null> {
    if (this.projectRootCache.has(project)) return this.projectRootCache.get(project) ?? null;
    const proj = await this.projectRepo.getProject(project);
    const id = proj?.workdriveRootFolderId ?? null;
    this.projectRootCache.set(project, id);
    return id;
  }
}
