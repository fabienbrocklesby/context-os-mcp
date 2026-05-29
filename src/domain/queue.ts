import { loadConfig } from "~/config/env";
import { chunkMarkdown } from "~/domain/chunking";
import { parseMarkdownDocument } from "~/domain/frontmatter";
import {
  isRetrievableMemoryStatus,
  normalizeProject,
  type MemoryStatus,
} from "~/domain/memory";

function normalizeProjectFromPath(path: string) {
  const parts = path.split("/").filter(Boolean);
  const projectsIndex = parts.indexOf("projects");
  if (projectsIndex >= 0 && parts[projectsIndex + 1]) {
    return normalizeProject(parts[projectsIndex + 1]);
  }
  return "shared";
}
import { embedTexts } from "~/integrations/workers-ai/embeddings";
import { deleteVectors, replaceDocumentVectors } from "~/integrations/vectorize/client";
import { ZohoWorkDriveClient, type ZohoFile } from "~/integrations/zoho/client";
import { DocumentRepository } from "~/persistence/d1/DocumentRepository";

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

export async function processIndexQueueMessage(env: Env, message: IndexQueueMessage) {
  const repo = new DocumentRepository(env.DB);
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
  await runDocumentReindexJob(env, repo, {
    jobId: message.jobId,
    workdriveFileId: message.workdriveFileId,
    path: message.path,
  });
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
  repo: DocumentRepository,
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
  const repo = new DocumentRepository(env.DB);
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
    active: isRetrievableMemoryStatus(parsed.frontmatter.status),
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
    active: isRetrievableMemoryStatus(parsed.frontmatter.status),
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
  const repo = new DocumentRepository(env.DB);
  const zoho = new ZohoWorkDriveClient(env);
  const syncRunId = await repo.createSyncRun(triggerKind);

  let scannedCount = 0;
  let indexedCount = 0;
  let failedCount = 0;
  const failures: Array<{ workdrive_file_id: string; path: string; error: string }> = [];
  try {
    const roots: Array<{ folderId?: string; pathPrefix: string }> = [
      { folderId: config.zoho.sharedRootFolderId, pathPrefix: "/memory/shared" },
      { folderId: config.zoho.projectsRootFolderId, pathPrefix: "/memory/projects" },
    ];

    for (const root of roots) {
      if (!root.folderId) continue;
      const entries = await walkWorkDriveMarkdownTree(zoho, root.folderId, root.pathPrefix);
      for (const entry of entries) {
        scannedCount += 1;
        const existing = await repo.getDocumentByWorkDriveFileId(entry.id);
        const chunkCount = existing ? await repo.getChunkCountForDocument(existing.id) : 0;
        if (
          !shouldReindexWorkDriveEntry({
            existing,
            chunkCount,
            remoteModifiedAt: entry.modifiedTimeMillis,
            remotePath: entry.path,
          })
        ) {
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

export function shouldReindexWorkDriveEntry(input: {
  existing?:
    | {
        path?: string | null;
        status: MemoryStatus;
        active: boolean;
        lastRemoteModifiedAt?: number | null;
      }
    | null;
  chunkCount: number;
  remoteModifiedAt?: number | null;
  remotePath?: string | null;
}) {
  if (!input.existing) return true;
  if (!input.chunkCount) return true;
  if (input.remoteModifiedAt && input.existing.lastRemoteModifiedAt) {
    if (input.remoteModifiedAt > input.existing.lastRemoteModifiedAt) return true;
  }
  if (input.remotePath && input.existing.path && input.remotePath !== input.existing.path) {
    return true;
  }
  return input.existing.active !== isRetrievableMemoryStatus(input.existing.status);
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
      if (!file.name.toLowerCase().endsWith(".md")) return false;
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
  if (!match?.groups) return null;
  return `${match.groups.base}${match.groups.extension}`;
}

async function sha256Hex(input: string) {
  const data = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
