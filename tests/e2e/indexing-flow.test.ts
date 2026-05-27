import { beforeEach, describe, expect, it, vi } from "vitest";

const downloadMarkdown = vi.fn();
const upsertIndexedDocument = vi.fn();
const recordSupersession = vi.fn();
const embedTexts = vi.fn();
const replaceDocumentVectors = vi.fn();
const deleteVectors = vi.fn();

vi.mock("~/integrations/zoho/client", () => ({
  ZohoWorkDriveClient: class {
    async downloadMarkdown(fileId: string) {
      return downloadMarkdown(fileId);
    }
  },
}));

vi.mock("~/persistence/d1/repository", () => ({
  MemoryRepository: class {
    async getDocumentByWorkDriveFileId() {
      return null;
    }

    async getDocumentByPath() {
      return null;
    }

    async getChunkVectorIdsForDocument() {
      return [];
    }

    async upsertIndexedDocument(input: unknown) {
      return upsertIndexedDocument(input);
    }

    async recordSupersession(input: unknown) {
      return recordSupersession(input);
    }
  },
}));

vi.mock("~/integrations/workers-ai/embeddings", () => ({
  embedTexts: (...args: unknown[]) => embedTexts(...args),
}));

vi.mock("~/integrations/vectorize/client", () => ({
  replaceDocumentVectors: (...args: unknown[]) => replaceDocumentVectors(...args),
  deleteVectors: (...args: unknown[]) => deleteVectors(...args),
}));

describe("indexing flow", () => {
  beforeEach(() => {
    downloadMarkdown.mockReset();
    upsertIndexedDocument.mockReset();
    recordSupersession.mockReset();
    embedTexts.mockReset();
    replaceDocumentVectors.mockReset();
    deleteVectors.mockReset();
  });

  it("orchestrates download, chunking, embeddings, vector upsert, and repository persistence", async () => {
    const { reindexWorkDriveDocument } = await import("~/domain/service");

    downloadMarkdown.mockResolvedValue({
      file: {
        id: "file-123",
        name: "vision.md",
        parentId: "folder-1",
        permalink: "https://workdrive.example.com/file-123",
        downloadUrl: "https://download.example.com/file-123",
        modifiedTimeMillis: 1_710_000_000_000,
      },
      markdown: `---
id: doc-123
title: Vision
project: shared
memory_type: current_context
status: active
revision: 2
tags:
  - roadmap
created_at: 2026-04-20T00:00:00.000Z
updated_at: 2026-04-23T00:00:00.000Z
author_client: codex
supersedes: []
superseded_by: []
canonical: true
---

# Vision

The canonical source of truth lives in Zoho WorkDrive.

## Retrieval

Vectorize stores chunk embeddings for retrieval.`,
    });
    embedTexts.mockResolvedValue([
      [0.1, 0.2, 0.3],
      [0.4, 0.5, 0.6],
    ]);
    upsertIndexedDocument.mockResolvedValue({
      oldVectorIds: [],
    });
    replaceDocumentVectors.mockResolvedValue(undefined);
    deleteVectors.mockResolvedValue(undefined);

    const env = {
      DB: {} as D1Database,
      APP_BASE_URL: "https://memory.example.com",
      MCP_ROUTE: "/mcp",
      ZOHO_WORKDRIVE_API_BASE_URL: "https://workdrive.zoho.com/api/v1",
      ZOHO_ACCOUNTS_BASE_URL: "https://accounts.zoho.com",
      ZOHO_ACCESS_TOKEN: "zoho-access",
      GITHUB_OAUTH_AUTHORIZE_URL: "https://github.com/login/oauth/authorize",
      GITHUB_OAUTH_TOKEN_URL: "https://github.com/login/oauth/access_token",
      GITHUB_OAUTH_USER_URL: "https://api.github.com/user",
      GITHUB_OAUTH_EMAILS_URL: "https://api.github.com/user/emails",
      WORKERS_AI_EMBEDDING_MODEL: "@cf/baai/bge-base-en-v1.5",
      MEMORY_INDEX: {} as VectorizeIndex,
      AI: {} as Ai,
    } as unknown as Env;

    await reindexWorkDriveDocument(
      env,
      "file-123",
      "/memory/shared/context/current/vision.md",
    );

    expect(downloadMarkdown).toHaveBeenCalledWith("file-123");
    expect(embedTexts).toHaveBeenCalledTimes(1);
    expect(replaceDocumentVectors).toHaveBeenCalledWith(
      env,
      expect.objectContaining({
        namespace: "shared",
        workdriveFileId: "file-123",
        title: "Vision",
        memoryType: "current_context",
        status: "active",
        revision: 2,
      }),
    );
    expect(upsertIndexedDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        workdriveFileId: "file-123",
        path: "/memory/shared/context/current/vision.md",
        title: "Vision",
        project: "shared",
        namespace: "shared",
        memoryType: "current_context",
        status: "active",
        revision: 2,
      }),
    );
    expect(deleteVectors).toHaveBeenCalledWith(env, []);
    expect(recordSupersession).not.toHaveBeenCalled();
  });

  it("keeps historical session summaries active for background retrieval", async () => {
    const { reindexWorkDriveDocument } = await import("~/domain/service");

    downloadMarkdown.mockResolvedValue({
      file: {
        id: "file-session",
        name: "2026-05-24T00-00-00-000Z-session.md",
        parentId: "folder-1",
        permalink: "https://workdrive.example.com/file-session",
        downloadUrl: "https://download.example.com/file-session",
        modifiedTimeMillis: 1_710_000_000_000,
      },
      markdown: `---
id: session-123
title: Useful Historical Session
project: light-lane
memory_type: session_summary
status: historical
revision: 1
tags:
  - sales
created_at: 2026-05-24T00:00:00.000Z
updated_at: 2026-05-24T00:00:00.000Z
author_client: codex
supersedes: []
superseded_by: []
canonical: false
---

# Useful Historical Session

This summary contains important sales context that should remain searchable as background memory.`,
    });
    embedTexts.mockResolvedValue([[0.1, 0.2, 0.3]]);
    upsertIndexedDocument.mockResolvedValue({ oldVectorIds: [] });
    replaceDocumentVectors.mockResolvedValue(undefined);
    deleteVectors.mockResolvedValue(undefined);

    const env = {
      DB: {} as D1Database,
      APP_BASE_URL: "https://memory.example.com",
      MCP_ROUTE: "/mcp",
      ZOHO_WORKDRIVE_API_BASE_URL: "https://workdrive.zoho.com/api/v1",
      ZOHO_ACCOUNTS_BASE_URL: "https://accounts.zoho.com",
      ZOHO_ACCESS_TOKEN: "zoho-access",
      GITHUB_OAUTH_AUTHORIZE_URL: "https://github.com/login/oauth/authorize",
      GITHUB_OAUTH_TOKEN_URL: "https://github.com/login/oauth/access_token",
      GITHUB_OAUTH_USER_URL: "https://api.github.com/user",
      GITHUB_OAUTH_EMAILS_URL: "https://api.github.com/user/emails",
      WORKERS_AI_EMBEDDING_MODEL: "@cf/baai/bge-base-en-v1.5",
      MEMORY_INDEX: {} as VectorizeIndex,
      AI: {} as Ai,
    } as unknown as Env;

    await reindexWorkDriveDocument(
      env,
      "file-session",
      "/memory/projects/light-lane/sessions/2026-05-24T00-00-00-000Z-session.md",
    );

    expect(replaceDocumentVectors).toHaveBeenCalledWith(
      env,
      expect.objectContaining({
        memoryType: "session_summary",
        status: "historical",
        active: true,
        superseded: false,
      }),
    );
    expect(upsertIndexedDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        memoryType: "session_summary",
        status: "historical",
        active: true,
      }),
    );
  });
});
