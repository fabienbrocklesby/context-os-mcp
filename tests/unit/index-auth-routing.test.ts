import { beforeEach, describe, expect, it, vi } from "vitest";

const oauthFetch = vi.fn();
const serveAuthenticatedMcpRequest = vi.fn();

vi.mock("~/auth/oauth", () => ({
  oauthProvider: {
    fetch: oauthFetch,
  },
}));

vi.mock("~/mcp/server", () => ({
  serveAuthenticatedMcpRequest,
}));

describe("Worker MCP auth routing", () => {
  beforeEach(() => {
    vi.resetModules();
    oauthFetch.mockReset();
    serveAuthenticatedMcpRequest.mockReset();
  });

  it("routes matching static bearer requests directly to the MCP handler", async () => {
    const worker = await import("~/index");
    const env = baseEnv({ MCP_BEARER_TOKEN: "codex-token" });
    const ctx = executionContext();
    const expected = new Response("ok");
    serveAuthenticatedMcpRequest.mockResolvedValue(expected);

    const response = await worker.default.fetch(
      workerRequest("https://memory.example.com/mcp", {
        headers: {
          authorization: "Bearer codex-token",
        },
      }),
      env,
      ctx,
    );

    expect(response).toBe(expected);
    expect(serveAuthenticatedMcpRequest).toHaveBeenCalledWith(
      expect.any(Request),
      env,
      ctx,
      {
        authType: "bearer",
        userId: "bearer",
        login: "bearer",
      },
    );
    expect(oauthFetch).not.toHaveBeenCalled();
  });

  it("normalizes text/plain OAuth failures on the MCP route to JSON", async () => {
    const worker = await import("~/index");
    const payload = {
      error: {
        message: "Encountered invalidated oauth token for user, failing request",
        code: "token_revoked",
      },
      status: 401,
    };
    oauthFetch.mockResolvedValue(
      new Response(JSON.stringify(payload), {
        status: 401,
        headers: {
          "content-type": "text/plain; charset=utf-8",
        },
      }),
    );

    const response = await worker.default.fetch(
      workerRequest("https://memory.example.com/mcp", {
        headers: {
          authorization: "Bearer stale-oauth-token",
        },
      }),
      baseEnv({ MCP_BEARER_TOKEN: "codex-token" }),
      executionContext(),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual(payload);
  });

  it("leaves non-MCP OAuth responses untouched", async () => {
    const worker = await import("~/index");
    const expected = new Response("Not found", {
      status: 404,
      headers: {
        "content-type": "text/plain; charset=utf-8",
      },
    });
    oauthFetch.mockResolvedValue(expected);

    const response = await worker.default.fetch(
      workerRequest("https://memory.example.com/unknown"),
      baseEnv({ MCP_BEARER_TOKEN: "codex-token" }),
      executionContext(),
    );

    expect(response).toBe(expected);
  });
});

function baseEnv(overrides: Partial<Env> = {}) {
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
    DB: {} as D1Database,
    ...overrides,
  } as Env;
}

function executionContext() {
  return {
    waitUntil() {},
    passThroughOnException() {},
  } as unknown as ExecutionContext;
}

function workerRequest(input: string, init?: RequestInit) {
  return new Request(input, init) as Request<unknown, IncomingRequestCfProperties>;
}
