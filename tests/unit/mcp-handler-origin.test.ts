import { describe, expect, it, vi } from "vitest";

vi.mock("agents/mcp", () => ({
  createMcpHandler: vi.fn(() => async () => new Response("ok")),
}));

describe("serveAuthenticatedMcpRequest", () => {
  it("rejects requests from disallowed origins before invoking the MCP transport", async () => {
    const { serveAuthenticatedMcpRequest } = await import("~/mcp/server");

    const response = await serveAuthenticatedMcpRequest(
      new Request("https://memory.example.com/mcp", {
        method: "POST",
        headers: {
          origin: "https://evil.example.com",
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-03-26",
            capabilities: {},
            clientInfo: { name: "vitest", version: "1.0.0" },
          },
        }),
      }),
      {
        APP_BASE_URL: "https://memory.example.com",
        MCP_ROUTE: "/mcp",
        ALLOWED_ORIGINS: "https://allowed.example.com",
        GITHUB_OAUTH_AUTHORIZE_URL: "https://github.com/login/oauth/authorize",
        GITHUB_OAUTH_TOKEN_URL: "https://github.com/login/oauth/access_token",
        GITHUB_OAUTH_USER_URL: "https://api.github.com/user",
        GITHUB_OAUTH_EMAILS_URL: "https://api.github.com/user/emails",
        ZOHO_WORKDRIVE_API_BASE_URL: "https://workdrive.zoho.com/api/v1",
        ZOHO_ACCOUNTS_BASE_URL: "https://accounts.zoho.com",
        WORKERS_AI_EMBEDDING_MODEL: "@cf/baai/bge-base-en-v1.5",
        DB: {} as D1Database,
      } as Env,
      {
        props: {},
        waitUntil() {},
        passThroughOnException() {},
      },
      {
        authType: "bearer",
        userId: "test",
        login: "test",
      },
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "Origin https://evil.example.com is not allowed to access this MCP server.",
    });
  });
});
