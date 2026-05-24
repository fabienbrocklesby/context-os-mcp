#!/usr/bin/env node

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { readMemoryMcpConfig } from "./memory-mcp-config.mjs";

const usage = `Usage:
  memory-mcp list-tools
  memory-mcp <tool_name> '<json_arguments>'

Examples:
  memory-mcp prepare_work_session '{"project":"example-project","topic":"current state"}'
  memory-mcp search_memory '{"project":"example-project","query":"deployment notes"}'
`;

const [command, rawArgs = "{}"] = process.argv.slice(2);

if (!command || command === "--help" || command === "-h") {
  process.stdout.write(usage);
  process.exit(command ? 0 : 1);
}

const { url, token } = readMemoryMcpConfig();
const client = new Client(
  { name: "codex-memory-mcp-fallback", version: "1.0.0" },
  { capabilities: {} },
);

await client.connect(
  new StreamableHTTPClientTransport(new URL(url), {
    requestInit: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  }),
);

try {
  if (command === "list-tools") {
    const tools = await client.listTools();
    writeJson({
      tool_count: tools.tools.length,
      tools: tools.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
      })),
    });
  } else {
    const args = parseJsonArgs(rawArgs);
    const result = await client.callTool({ name: command, arguments: args });
    const text = result.content?.find((item) => item.type === "text")?.text;
    if (!text) {
      writeJson(result);
    } else {
      try {
        writeJson(JSON.parse(text));
      } catch {
        process.stdout.write(`${text}\n`);
      }
    }
  }
} finally {
  await client.close();
}

function parseJsonArgs(raw) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Tool arguments must be valid JSON. Received: ${raw}\n${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function writeJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}
