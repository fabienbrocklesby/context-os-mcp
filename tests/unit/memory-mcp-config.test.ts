import { describe, expect, it } from "vitest";

// @ts-expect-error The local fallback script is plain ESM JavaScript.
import { readMemoryMcpConfigFromText } from "../../scripts/memory-mcp-config.mjs";

describe("memory MCP fallback config", () => {
  it("reads a bearer token from a configured token file", () => {
    const config = `
[mcp_servers.context_os_memory]
enabled = true
url = "https://memory.example.com/mcp"
bearer_token_file = "~/.codex/secrets/context_os_memory_token"
`;

    const result = readMemoryMcpConfigFromText(config, {
      homeDir: "/Users/example",
      env: {},
      readFileSync: (path: string) => {
        expect(path).toBe("/Users/example/.codex/secrets/context_os_memory_token");
        return "token-from-file\n";
      },
    });

    expect(result).toEqual({
      url: "https://memory.example.com/mcp",
      token: "token-from-file",
    });
  });
});
