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
import type { ProjectRepository } from "~/persistence/d1/ProjectRepository";

type StateValues = Record<string, { value: unknown; updated_at?: string | null }>;

export class VaultSyncService {
  constructor(
    private readonly zoho: ZohoWorkDriveClient,
    private readonly config: ReturnType<typeof loadConfig>,
    private readonly projectRepo: ProjectRepository,
  ) {}

  async syncEntity(project: string, entity: MemoryEntity, states: StateValues): Promise<{ path: string; workdriveFileId: string } | null> {
    const rootId = await this.getProjectRootFolderId(project);
    if (!rootId) return null;
    const subfolder = entity.type === "person" ? "people" : "companies";
    const { folder } = await this.zoho.ensureFolderPath(rootId, ["knowledge", "entities", subfolder]);
    const fileName = `${entity.slug}.md`;
    const markdown = buildEntityVaultMarkdown(entity, states);
    const uploaded = await this.zoho.uploadMarkdownFile({ folderId: folder.id, fileName, markdown, overrideExisting: true });
    return { path: `/memory/projects/${project}/knowledge/entities/${subfolder}/${fileName}`, workdriveFileId: uploaded.id };
  }

  async syncFact(project: string, fact: DurableFact): Promise<{ path: string; workdriveFileId: string } | null> {
    const rootId = await this.getProjectRootFolderId(project);
    if (!rootId) return null;
    const { folder } = await this.zoho.ensureFolderPath(rootId, ["knowledge", "facts"]);
    const fileName = `${fact.factKey ? slugify(fact.factKey).slice(0, 100) : fact.id}.md`;
    const markdown = buildFactVaultMarkdown(fact);
    const uploaded = await this.zoho.uploadMarkdownFile({ folderId: folder.id, fileName, markdown, overrideExisting: true });
    return { path: `/memory/projects/${project}/knowledge/facts/${fileName}`, workdriveFileId: uploaded.id };
  }

  async syncTask(project: string, task: ContextTask): Promise<{ path: string; workdriveFileId: string } | null> {
    const rootId = await this.getProjectRootFolderId(project);
    if (!rootId) return null;
    const { folder } = await this.zoho.ensureFolderPath(rootId, ["operational", "tasks"]);
    const fileName = `${vaultSlugForTask(task.title, task.id)}.md`;
    const markdown = buildTaskVaultMarkdown(task);
    const uploaded = await this.zoho.uploadMarkdownFile({ folderId: folder.id, fileName, markdown, overrideExisting: true });
    return { path: `/memory/projects/${project}/operational/tasks/${fileName}`, workdriveFileId: uploaded.id };
  }

  async syncEvent(project: string, event: SourceEvent): Promise<{ path: string; workdriveFileId: string } | null> {
    const rootId = await this.getProjectRootFolderId(project);
    if (!rootId) return null;
    const { folder } = await this.zoho.ensureFolderPath(rootId, ["operational", "events"]);
    const fileName = `${event.occurredAt?.slice(0, 10) ?? "no-date"}-${slugify(event.title).slice(0, 80)}.md`;
    const markdown = buildEventVaultMarkdown(event);
    const uploaded = await this.zoho.uploadMarkdownFile({ folderId: folder.id, fileName, markdown, overrideExisting: true });
    return { path: `/memory/projects/${project}/operational/events/${fileName}`, workdriveFileId: uploaded.id };
  }

  async syncInitiative(
    initiative: Pick<MemoryInitiative, "id" | "slug" | "title" | "summary" | "status" | "createdAt" | "updatedAt">,
    entityNames: string[],
  ): Promise<{ path: string; workdriveFileId: string } | null> {
    const sharedRootId = this.config.zoho.sharedRootFolderId;
    if (!sharedRootId) return null;
    const { folder } = await this.zoho.ensureFolderPath(sharedRootId, ["initiatives"]);
    const fileName = `${initiative.slug}.md`;
    const markdown = buildInitiativeVaultMarkdown(initiative, entityNames);
    const uploaded = await this.zoho.uploadMarkdownFile({ folderId: folder.id, fileName, markdown, overrideExisting: true });
    return { path: `/memory/shared/initiatives/${fileName}`, workdriveFileId: uploaded.id };
  }

  private async getProjectRootFolderId(project: string): Promise<string | null> {
    const proj = await this.projectRepo.getProject(project);
    return proj?.workdriveRootFolderId ?? null;
  }
}
