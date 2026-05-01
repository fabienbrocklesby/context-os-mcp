import { describe, expect, it, vi } from "vitest";

const recordProjectFolderCheck = vi.fn();
const upsertProject = vi.fn();
const ensureFolderPath = vi.fn();

vi.mock("~/persistence/d1/repository", () => ({
  MemoryRepository: class {
    async getProject() {
      return null;
    }

    async recordProjectFolderCheck(input: unknown) {
      return recordProjectFolderCheck(input);
    }

    async upsertProject(input: { slug: string; displayName: string }) {
      upsertProject(input);
      return {
        slug: input.slug,
        displayName: input.displayName,
        description: null,
        status: "active",
        profile: {},
        ownerLogin: "codex",
        shared: false,
        workdriveRootFolderId: `${input.slug}-root`,
        contextCurrentFolderId: "context-current",
        contextHistoryFolderId: "context-history",
        decisionsFolderId: "decisions",
        sessionsFolderId: "sessions",
        snippetsFolderId: "snippets",
        repoIndexFolderId: "repo-index",
        lastHealth: null,
        createdAt: "now",
        updatedAt: "now",
      };
    }
  },
}));

vi.mock("~/integrations/zoho/client", () => ({
  ZohoWorkDriveClient: class {
    async ensureFolderPath(_rootFolderId: string, segments: string[]) {
      return ensureFolderPath(_rootFolderId, segments);
    }
  },
}));

describe("project provisioning", () => {
  it("ensures the project WorkDrive folder tree and persists project metadata", async () => {
    const { MemoryService } = await import("~/domain/service");
    ensureFolderPath.mockImplementation(async (_root: string, segments: string[]) => ({
      folder: {
        id: segments.join("-"),
        name: segments.at(-1) ?? "root",
        parentId: "parent",
      },
      created: segments.length === 1 ? [{ id: segments[0], name: segments[0], parentId: "projects" }] : [],
    }));

    const service = new MemoryService(baseEnv(), {
      authType: "bearer",
      userId: "test",
      login: "codex",
    });

    const result = await service.ensureProject({
      project: "Memory System MCP",
      displayName: "Memory System MCP",
    });

    expect(result.project?.slug).toBe("memory-system-mcp");
    expect(ensureFolderPath).toHaveBeenCalledWith("projects-root", [
      "memory-system-mcp",
    ]);
    expect(ensureFolderPath).toHaveBeenCalledWith("projects-root", [
      "memory-system-mcp",
      "repo-index",
    ]);
    expect(recordProjectFolderCheck).toHaveBeenCalledWith(
      expect.objectContaining({
        projectSlug: "memory-system-mcp",
        folderPath: "/memory/projects/memory-system-mcp/context/current",
        status: "ok",
      }),
    );
    expect(upsertProject).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: "memory-system-mcp",
        displayName: "Memory System MCP",
        snippetsFolderId: "memory-system-mcp-snippets",
        repoIndexFolderId: "memory-system-mcp-repo-index",
      }),
    );
  });
});

function baseEnv() {
  return {
    APP_BASE_URL: "https://memory.example.com",
    MCP_ROUTE: "/mcp",
    GITHUB_OAUTH_AUTHORIZE_URL: "https://github.com/login/oauth/authorize",
    GITHUB_OAUTH_TOKEN_URL: "https://github.com/login/oauth/access_token",
    GITHUB_OAUTH_USER_URL: "https://api.github.com/user",
    GITHUB_OAUTH_EMAILS_URL: "https://api.github.com/user/emails",
    ZOHO_WORKDRIVE_API_BASE_URL: "https://workdrive.zoho.com/api/v1",
    ZOHO_ACCOUNTS_BASE_URL: "https://accounts.zoho.com",
    WORKERS_AI_EMBEDDING_MODEL: "@cf/baai/bge-base-en-v1.5",
    WORKDRIVE_PROJECTS_ROOT_FOLDER_ID: "projects-root",
    WORKDRIVE_SHARED_ROOT_FOLDER_ID: "shared-root",
    DB: {} as D1Database,
  } as Env;
}
