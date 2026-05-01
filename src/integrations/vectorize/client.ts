import type { ChunkRecord, MemorySearchFilters, MemorySearchHit } from "~/domain/memory";

type ChunkVectorMetadata = {
  doc_id: string;
  snapshot_id: string;
  project: string;
  path: string;
  workdrive_file_id: string;
  title: string;
  memory_type: string;
  status: string;
  active: boolean;
  superseded: boolean;
  repo?: string;
  repo_path?: string;
  tags?: string[];
  source?: string;
  confidence?: number;
  usefulness?: number;
  updated_at_unix: number;
  heading_path: string;
  chunk_index: number;
  revision: number;
  url?: string;
};

export async function queryMemoryIndex(
  env: Env,
  vector: number[],
  namespaces: string[],
  filters: MemorySearchFilters & { limit?: number; candidateLimit?: number },
) {
  const topK = Math.min(filters.candidateLimit ?? filters.limit ?? 8, 50);
  const matches = await Promise.all(
    namespaces.map((namespace) =>
      env.MEMORY_INDEX.query(vector, {
        namespace,
        topK,
        returnMetadata: "indexed",
        filter: buildFilter(filters),
      }),
    ),
  );

  const hits: MemorySearchHit[] = [];
  for (const result of matches) {
    for (const match of result.matches) {
      const metadata = match.metadata as unknown as ChunkVectorMetadata | undefined;
      if (
        !metadata?.doc_id ||
        !metadata.snapshot_id ||
        !metadata.workdrive_file_id ||
        !metadata.path ||
        !metadata.title ||
        !metadata.project ||
        !metadata.memory_type ||
        !metadata.status
      ) {
        continue;
      }
      hits.push({
        documentId: metadata.doc_id,
        snapshotId: metadata.snapshot_id,
        vectorId: match.id,
        title: metadata.title,
        path: metadata.path,
        project: metadata.project,
        namespace: match.namespace ?? "shared",
        workdriveFileId: metadata.workdrive_file_id,
        memoryType: metadata.memory_type as MemorySearchHit["memoryType"],
        status: metadata.status as MemorySearchHit["status"],
        active: metadata.active,
        superseded: metadata.superseded,
        revision: metadata.revision,
        repo: metadata.repo,
        repoPath: metadata.repo_path,
        tags: metadata.tags ?? [],
        source: metadata.source,
        confidence: metadata.confidence,
        usefulness: metadata.usefulness,
        headingPath: metadata.heading_path,
        chunkIndex: metadata.chunk_index,
        chunkText: "",
        score: match.score,
        updatedAtUnix: metadata.updated_at_unix,
        url: metadata.url,
      });
    }
  }
  return hits;
}

export async function replaceDocumentVectors(
  env: Env,
  input: {
    namespace: string;
    documentId: string;
    snapshotId: string;
    workdriveFileId: string;
    title: string;
    path: string;
    project: string;
    memoryType: string;
    status: string;
    active: boolean;
    superseded: boolean;
    repo?: string | null;
    repoPath?: string | null;
    tags?: string[];
    source?: string | null;
    confidence?: number | null;
    usefulness?: number | null;
    revision: number;
    url?: string | null;
    chunks: ChunkRecord[];
    embeddings: number[][];
  },
) {
  const vectors = input.chunks.map((chunk, index) => ({
    id: chunk.vectorId,
    namespace: input.namespace,
    values: input.embeddings[index],
    metadata: {
      doc_id: input.documentId,
      snapshot_id: input.snapshotId,
      project: input.project,
      path: input.path,
      workdrive_file_id: input.workdriveFileId,
      title: input.title,
      memory_type: input.memoryType,
      status: input.status,
      active: input.active,
      superseded: input.superseded,
      ...(input.repo ? { repo: input.repo } : {}),
      ...(input.repoPath ? { repo_path: input.repoPath } : {}),
      ...(input.tags?.length ? { tags: input.tags } : {}),
      ...(input.source ? { source: input.source } : {}),
      ...(input.confidence !== undefined && input.confidence !== null
        ? { confidence: input.confidence }
        : {}),
      ...(input.usefulness !== undefined && input.usefulness !== null
        ? { usefulness: input.usefulness }
        : {}),
      updated_at_unix: chunk.updatedAtUnix,
      heading_path: chunk.headingPath,
      chunk_index: chunk.chunkIndex,
      revision: input.revision,
      ...(input.url ? { url: input.url } : {}),
    },
  }));

  await env.MEMORY_INDEX.upsert(vectors);
}

export async function deleteVectors(env: Env, vectorIds: string[]) {
  if (vectorIds.length === 0) {
    return;
  }
  await env.MEMORY_INDEX.deleteByIds(vectorIds);
}

function buildFilter(filters: MemorySearchFilters): VectorizeVectorMetadataFilter | undefined {
  const filter: VectorizeVectorMetadataFilter = {};

  if (filters.memoryTypes?.length) {
    filter.memory_type = {
      $in: [...filters.memoryTypes],
    };
  }

  if (filters.statuses?.length) {
    filter.status = {
      $in: [...filters.statuses],
    };
  }

  if (filters.activeOnly) {
    filter.active = true;
  }

  if (!filters.includeSuperseded) {
    filter.superseded = false;
  }

  if (filters.repo) {
    filter.repo = filters.repo.toLowerCase();
  }

  if (filters.path) {
    filter.path = filters.path;
  }

  if (filters.source) {
    filter.source = filters.source;
  }

  if (Object.keys(filter).length === 0) {
    return undefined;
  }

  return filter;
}
