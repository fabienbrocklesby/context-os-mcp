import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function readMemoryMcpConfig(configPath = `${os.homedir()}/.codex/config.toml`) {
  return readMemoryMcpConfigFromText(fs.readFileSync(configPath, "utf8"), {
    homeDir: os.homedir(),
    env: process.env,
    readFileSync: fs.readFileSync,
    configPath,
  });
}

export function readMemoryMcpConfigFromText(
  config,
  {
    homeDir = os.homedir(),
    env = process.env,
    readFileSync = fs.readFileSync,
    configPath = `${homeDir}/.codex/config.toml`,
  } = {},
) {
  const candidates = ["context_os_memory", "context-os-memory", "memory"];

  for (const name of candidates) {
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const block =
      config.match(new RegExp(`\\[mcp_servers\\.${escapedName}\\][\\s\\S]*?(?=\\n\\[|\\s*$)`))?.[0] ??
      "";
    const headerBlock =
      config.match(
        new RegExp(`\\[mcp_servers\\.${escapedName}\\.http_headers\\][\\s\\S]*?(?=\\n\\[|\\s*$)`),
      )?.[0] ?? "";
    const url = block.match(/url\s*=\s*"([^"]+)"/)?.[1];
    const envVar = block.match(/bearer_token_env_var\s*=\s*"([^"]+)"/)?.[1];
    const tokenFile = block.match(/bearer_token_file\s*=\s*"([^"]+)"/)?.[1];
    const token =
      block.match(/bearer_token\s*=\s*"([^"]+)"/)?.[1] ??
      (envVar ? env[envVar] : undefined) ??
      (tokenFile ? readTokenFile(tokenFile, { homeDir, readFileSync }) : undefined) ??
      headerBlock.match(/Authorization\s*=\s*"Bearer\s+([^"]+)"/)?.[1];

    if (url && token) {
      return { url, token };
    }
  }

  throw new Error(
    `Could not find context_os_memory or memory MCP url and Authorization bearer token in ${configPath}.`,
  );
}

function readTokenFile(tokenFile, { homeDir, readFileSync }) {
  const resolved = tokenFile.startsWith("~/")
    ? path.join(homeDir, tokenFile.slice(2))
    : tokenFile;
  try {
    return String(readFileSync(resolved, "utf8")).trim() || undefined;
  } catch {
    return undefined;
  }
}
