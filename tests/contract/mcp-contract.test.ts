import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import type { MemoryPrincipal } from "~/domain/memory";

vi.mock("~/domain/service", () => {
  class MockMemoryService {
    async searchMemory() {
      return {
        results: [
          {
            id: "doc-1",
            title: "Vision",
            path: "/memory/shared/context/current/vision.md",
            url: "https://memory.example.com/doc-1",
            text: "Canonical truth",
            score: 0.91,
            memory_type: "current_context",
            status: "active",
            heading_path: "Vision",
          },
        ],
        documents: [],
      };
    }

    async getDocument() {
      return {
        document: {
          id: "doc-1",
          title: "Vision",
          path: "/memory/shared/context/current/vision.md",
          permalink: "https://memory.example.com/doc-1",
          project: "shared",
          memoryType: "current_context",
          status: "active",
          revision: 2,
        },
        snapshot: {
          rawMarkdown: "# Vision\n\nCanonical truth",
        },
        authoritative_markdown: "# Vision\n\nCanonical truth",
      };
    }

    async getCurrentContext() {
      return { items: [] };
    }

    async prepareAssistantSession() {
      return {
        active_project: {
          slug: "memory-system-mcp",
          displayName: "Memory System MCP",
        },
        context_resolution: {
          project_switching: {
            selected: "memory-system-mcp",
            reason: "Exact project or alias match.",
          },
        },
        grouped_memory: {
          grouped: {
            current_context: [],
          },
        },
        recommended_live_mcp_checks: ["Check live github for fresh context before writing durable summaries."],
        write_back_policy: {
          mode: "selective_durable_facts",
        },
      };
    }

    async resolveContext() {
      return {
        active_project: { slug: "memory-system-mcp" },
        candidates: [],
        project_switching: { selected: "memory-system-mcp" },
      };
    }

    async listInitiatives() {
      return { initiatives: [] };
    }

    async getInitiativeContext() {
      return { initiative: { slug: "assistant-context-os" }, projects: [] };
    }

    async upsertInitiative() {
      return { initiative: { slug: "assistant-context-os" }, projects: [] };
    }

    async linkMemory() {
      return { links: [] };
    }

    async saveSourceEvent() {
      return { saved: true, source_event: { title: "CRM update" } };
    }

    async extractDurableFacts() {
      return { facts: [], saved: [] };
    }

    async upsertTask() {
      return { task: { title: "Follow up" } };
    }

    async dailyBriefing() {
      return { due_or_upcoming_tasks: [], active_initiatives: [] };
    }

    async contextHealthCheck() {
      return { warnings: [] };
    }

    async writeSessionSummary() {
      return { path: "/memory/shared/sessions/test.md", workdrive_file_id: "wd-1", job_id: "job-1" };
    }

    async updateContextDocument() {
      return { path: "/memory/shared/context/current/vision.md", workdrive_file_id: "wd-1", job_id: "job-1" };
    }

    async recordDecision() {
      return { path: "/memory/shared/decisions/decision.md", workdrive_file_id: "wd-2", job_id: "job-2" };
    }

    async reindexDocument() {
      return { job_id: "job-3", path: "/memory/shared/context/current/vision.md" };
    }

    async reindexAll() {
      return { job_id: "job-4" };
    }
  }

  return {
    MemoryService: MockMemoryService,
  };
});

describe("MCP contract", () => {
  let env: Env;
  let principal: MemoryPrincipal;

  beforeEach(() => {
    env = {
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
    } as Env;
    principal = {
      authType: "bearer",
      userId: "test",
      login: "test",
    };
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("registers the expected tool surface with annotations", async () => {
    const client = await connectTestClient(env, principal);
    const listed = await client.listTools();

    expect(listed.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        "search",
        "fetch",
        "prepare_work_session",
        "finish_work_session",
        "bootstrap_project_context",
        "ensure_project",
        "list_projects",
        "get_project",
        "update_project_profile",
        "project_status",
        "prepare_assistant_session",
        "resolve_context",
        "search_memory",
        "get_document",
        "get_current_context",
        "write_session_summary",
        "save_snippet",
        "update_context_document",
        "record_decision",
        "github_find_repos",
        "github_project_repos",
        "github_associate_repo",
        "github_inspect_repo_structure",
        "github_index_repo_overview",
        "list_initiatives",
        "get_initiative_context",
        "upsert_initiative",
        "link_memory",
        "save_source_event",
        "extract_durable_facts",
        "upsert_task",
        "daily_briefing",
        "context_health_check",
        "reindex_document",
        "reindex_all",
        "admin_status",
        "admin_reconcile_workdrive",
        "admin_reindex_document",
        "admin_reindex_all",
        "retrieval_diagnostics",
      ]),
    );
    expect(
      listed.tools.find((tool) => tool.name === "search")?.annotations?.readOnlyHint,
    ).toBe(true);
    expect(
      listed.tools.find((tool) => tool.name === "write_session_summary")?.annotations?.destructiveHint,
    ).toBe(true);
  });

  it("returns Assistant Context OS session payloads", async () => {
    const client = await connectTestClient(env, principal);

    const response = await client.callTool({
      name: "prepare_assistant_session",
      arguments: {
        project_or_topic: "memory-system-mcp",
        user_intent: "plan context orchestration",
        active_sources: ["github"],
      },
    });
    const payload = JSON.parse(readFirstTextContent(response));

    expect(payload).toMatchObject({
      active_project: {
        slug: "memory-system-mcp",
      },
      write_back_policy: {
        mode: "selective_durable_facts",
      },
    });
    expect(payload.recommended_live_mcp_checks[0]).toContain("github");
  });

  it("returns OpenAI-compatible search and fetch payload shapes", async () => {
    const client = await connectTestClient(env, principal);

    const searchResponse = await client.callTool({
      name: "search",
      arguments: { query: "vision" },
    });
    const searchPayload = JSON.parse(readFirstTextContent(searchResponse));
    expect(searchPayload.results[0]).toMatchObject({
      id: "doc-1",
      title: "Vision",
      text: "Canonical truth",
      url: "https://memory.example.com/doc-1",
    });

    const fetchResponse = await client.callTool({
      name: "fetch",
      arguments: { id: "doc-1" },
    });
    const fetchPayload = JSON.parse(readFirstTextContent(fetchResponse));
    expect(fetchPayload).toMatchObject({
      id: "doc-1",
      title: "Vision",
      text: "# Vision\n\nCanonical truth",
      url: "https://memory.example.com/doc-1",
    });
  });
});

async function connectTestClient(env: Env, principal: MemoryPrincipal) {
  const { createMemoryMcpServer } = await import("~/mcp/tools");
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  const server = createMemoryMcpServer(env, principal);
  await server.connect(serverTransport);

  const client = new Client(
    {
      name: "vitest-client",
      version: "1.0.0",
    },
    {
      capabilities: {},
    },
  );
  await client.connect(clientTransport);
  return client;
}

function readFirstTextContent(result: unknown) {
  const content = (
    result &&
    typeof result === "object" &&
    "content" in result &&
    Array.isArray(result.content)
      ? result.content
      : []
  ) as Array<{ type: string; text?: string }>;
  const textBlock = content.find((item) => item.type === "text");
  if (!textBlock?.text) {
    throw new Error(`Expected a text content block, got ${JSON.stringify(result)}`);
  }
  return textBlock.text;
}
