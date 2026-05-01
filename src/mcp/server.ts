import { createMcpHandler } from "agents/mcp";

import { loadConfig } from "~/config/env";
import type { MemoryPrincipal } from "~/domain/memory";
import { createMemoryMcpServer } from "~/mcp/tools";

export function serveAuthenticatedMcpRequest(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  principal: MemoryPrincipal,
) {
  const config = loadConfig(env);
  const originError = validateOrigin(request, config.allowedOrigins);
  if (originError) {
    return originError;
  }
  const server = createMemoryMcpServer(env, principal);
  return createMcpHandler(server, {
    route: config.mcpRoute,
    corsOptions: {
      origin: "*",
      methods: "GET, POST, OPTIONS",
      headers: "Content-Type, Authorization, Mcp-Session-Id, Last-Event-ID",
      exposeHeaders: "Mcp-Session-Id",
      maxAge: 86400,
    },
  })(request, env, ctx);
}

function validateOrigin(request: Request, allowedOrigins: string[]) {
  const origin = request.headers.get("origin");
  if (!origin || allowedOrigins.length === 0) {
    return null;
  }
  if (!allowedOrigins.includes(origin)) {
    return Response.json(
      {
        error: `Origin ${origin} is not allowed to access this MCP server.`,
      },
      { status: 403 },
    );
  }
  return null;
}
