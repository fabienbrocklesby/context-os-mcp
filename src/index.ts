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
      isBearerAuthorized(request, config.bearerToken)
    ) {
      const { serveAuthenticatedMcpRequest } = await import("~/mcp/server");
      return serveAuthenticatedMcpRequest(request, env, ctx, BEARER_PRINCIPAL);
    }

    return oauthProvider.fetch(request, env, ctx);
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

function isBearerAuthorized(request: Request, bearerToken?: string) {
  if (!bearerToken) {
    return false;
  }
  const header = request.headers.get("authorization");
  return header === `Bearer ${bearerToken}`;
}
