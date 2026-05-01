import { afterEach, describe, expect, it, vi } from "vitest";

import { ZohoWorkDriveClient } from "~/integrations/zoho/client";

const baseEnv = {
  APP_BASE_URL: "https://memory.example.com",
  MCP_ROUTE: "/mcp",
  ZOHO_WORKDRIVE_API_BASE_URL: "https://workdrive.zoho.com/api/v1",
  ZOHO_ACCOUNTS_BASE_URL: "https://accounts.zoho.com",
  ZOHO_WORKDRIVE_UPLOAD_URL: "https://upload.zoho.com/workdrive/upload",
  ZOHO_CLIENT_ID: "zoho-client",
  ZOHO_CLIENT_SECRET: "zoho-secret",
  ZOHO_REFRESH_TOKEN: "refresh-token",
  GITHUB_OAUTH_AUTHORIZE_URL: "https://github.com/login/oauth/authorize",
  GITHUB_OAUTH_TOKEN_URL: "https://github.com/login/oauth/access_token",
  GITHUB_OAUTH_USER_URL: "https://api.github.com/user",
  GITHUB_OAUTH_EMAILS_URL: "https://api.github.com/user/emails",
  WORKERS_AI_EMBEDDING_MODEL: "@cf/baai/bge-base-en-v1.5",
} as unknown as Env;

describe("ZohoWorkDriveClient", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("refreshes an OAuth token and downloads markdown through the WorkDrive API download endpoint", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: "zoho-access", expires_in: 3600 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              id: "file-1",
              type: "files",
              attributes: {
                name: "vision.md",
                download_url: "https://download.example.com/file-1",
                parent_id: "folder-1",
              },
            },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      )
      .mockResolvedValueOnce(new Response("# Vision\n\nCanonical truth", { status: 200 }));

    const client = new ZohoWorkDriveClient(baseEnv, fetchImpl);
    const downloaded = await client.downloadMarkdown("file-1");

    expect(downloaded.file.id).toBe("file-1");
    expect(downloaded.markdown).toContain("Canonical truth");
    expect(fetchImpl).toHaveBeenNthCalledWith(
      3,
      "https://workdrive.zoho.com/api/v1/download/file-1",
      expect.objectContaining({
        headers: {
          Accept: "text/markdown,text/plain,*/*",
          Authorization: "Zoho-oauthtoken zoho-access",
        },
      }),
    );
  });

  it("falls back to the metadata download URL when the API download endpoint fails", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              id: "file-1",
              type: "files",
              attributes: {
                name: "vision.md",
                download_url: "https://download.example.com/file-1",
                parent_id: "folder-1",
              },
            },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      )
      .mockResolvedValueOnce(new Response("wrong endpoint", { status: 404 }))
      .mockResolvedValueOnce(new Response("# Vision\n\nFallback truth", { status: 200 }));

    const client = new ZohoWorkDriveClient(
      { ...baseEnv, ZOHO_ACCESS_TOKEN: "static-access" } as Env,
      fetchImpl,
    );
    const downloaded = await client.downloadMarkdown("file-1");

    expect(downloaded.markdown).toContain("Fallback truth");
    expect(fetchImpl).toHaveBeenNthCalledWith(
      3,
      "https://download.example.com/file-1",
      expect.objectContaining({
        headers: {
          Accept: "text/markdown,text/plain,*/*",
          Authorization: "Zoho-oauthtoken static-access",
        },
      }),
    );
  });

  it("rejects write operations when the upload endpoint is not configured", async () => {
    const env = {
      ...baseEnv,
      ZOHO_WORKDRIVE_UPLOAD_URL: undefined,
      ZOHO_ACCESS_TOKEN: "static-access",
    } as unknown as Env;
    const client = new ZohoWorkDriveClient(env, vi.fn<typeof fetch>());

    await expect(
      client.uploadMarkdownFile({
        folderId: "folder-1",
        fileName: "note.md",
        markdown: "# Note",
        overrideExisting: false,
      }),
    ).rejects.toThrow("ZOHO_WORKDRIVE_UPLOAD_URL is required");
  });

  it("creates missing folders while ensuring a folder path", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              id: "root",
              type: "files",
              attributes: {
                name: "projects",
                type: "folder",
                is_folder: true,
              },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              id: "project-folder",
              type: "files",
              attributes: {
                name: "memory-system-mcp",
                parent_id: "root",
                type: "folder",
                is_folder: true,
              },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );

    const client = new ZohoWorkDriveClient(
      { ...baseEnv, ZOHO_ACCESS_TOKEN: "static-access" } as Env,
      fetchImpl,
    );
    const ensured = await client.ensureFolderPath("root", ["memory-system-mcp"]);

    expect(ensured.folder.id).toBe("project-folder");
    expect(ensured.created.map((folder) => folder.id)).toEqual(["project-folder"]);
    expect(fetchImpl).toHaveBeenNthCalledWith(
      3,
      "https://workdrive.zoho.com/api/v1/files",
      expect.objectContaining({
        method: "POST",
      }),
    );
  });
});
