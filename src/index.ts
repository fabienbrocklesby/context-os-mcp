import { loadConfig } from "~/config/env";
import type { MemoryPrincipal } from "~/domain/memory";
import { processIndexQueueMessage, runReconciliation } from "~/domain/service";
import { oauthProvider } from "~/auth/oauth";

const BEARER_PRINCIPAL: MemoryPrincipal = {
  authType: "bearer",
  userId: "bearer",
  login: "bearer",
};

export default {
  async fetch(request, env, ctx) {
    const config = loadConfig(env);
    const url = new URL(request.url);

    if (
      url.pathname === config.mcpRoute &&
      isBearerAuthorized(request, [config.bearerToken, ...config.extraBearerTokens])
    ) {
      const { serveAuthenticatedMcpRequest } = await import("~/mcp/server");
      return serveAuthenticatedMcpRequest(request, env, ctx, BEARER_PRINCIPAL);
    }

    const response = await oauthProvider.fetch(request, env, ctx);
    if (url.pathname === config.mcpRoute) {
      return normalizeMcpAuthErrorResponse(response);
    }
    return response;
  },

  async queue(batch, env, _ctx) {
    for (const message of batch.messages) {
      try {
        await processIndexQueueMessage(env, message.body as import("~/domain/service").IndexQueueMessage);
        message.ack();
      } catch (error) {
        console.error("Queue processing failed", error);
        message.retry();
      }
    }
  },

  async scheduled(_event, env, _ctx) {
    await runReconciliation(env, "cron");
  },
} satisfies ExportedHandler<Env>;

function isBearerAuthorized(request: Request, bearerTokens: Array<string | undefined>) {
  const header = request.headers.get("authorization");
  return bearerTokens.some((token) => token && header === `Bearer ${token}`);
}

async function normalizeMcpAuthErrorResponse(response: Response) {
  if (response.status !== 401 && response.status !== 403) {
    return response;
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("text/plain")) {
    return response;
  }

  const body = await response.text();
  const headers = new Headers(response.headers);
  headers.set("content-type", "application/json; charset=utf-8");

  try {
    return Response.json(JSON.parse(body), {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } catch {
    return Response.json(
      {
        error: {
          message: body || "MCP authorization failed.",
          code: response.status === 401 ? "unauthorized" : "forbidden",
        },
        status: response.status,
      },
      {
        status: response.status,
        statusText: response.statusText,
        headers,
      },
    );
  }
}
