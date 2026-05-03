const MEMORY_ALIASES = new Set([
  "context_os_memory",
  "contextos_memory",
  "context_os",
  "contextos",
  "memory",
  "memory_system_mcp",
  "prepare_assistant_session",
  "prepare_work_session",
  "search_memory",
  "get_current_context",
  "mcp__codex_apps__memory",
  "mcp_codex_apps_memory",
]);

export function normalizeToolName(tool: string) {
  return tool.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

export function isMemoryToolSignal(tool: string) {
  const normalized = normalizeToolName(tool);
  if (MEMORY_ALIASES.has(normalized)) {
    return true;
  }
  return normalized.includes("memory_prepare_assistant_session") ||
    normalized.endsWith("_prepare_assistant_session") ||
    normalized.endsWith("_search_memory") ||
    normalized.includes("contextos");
}

export function isToolAvailable(tool: string, sourceKind: string, availableTools?: string[]) {
  if (!availableTools?.length) {
    return true;
  }
  const normalized = new Set(availableTools.map(normalizeToolName));
  const normalizedTool = normalizeToolName(tool);
  const normalizedSource = normalizeToolName(sourceKind);
  if (normalized.has(normalizedTool) || normalized.has(normalizedSource)) {
    return true;
  }
  if ((normalizedSource === "memory" || normalizedTool === "prepare_assistant_session") &&
    availableTools.some(isMemoryToolSignal)) {
    return true;
  }
  if (normalizedSource === "github" && normalized.has("github")) {
    return true;
  }
  if (normalizedSource === "calendar") {
    return normalized.has("calendar") ||
      normalized.has("zoho_calendar") ||
      normalized.has("google_calendar") ||
      normalized.has("outlook_calendar");
  }
  if (normalizedSource === "zoho_crm") {
    return normalized.has("crm") || normalized.has("zoho") || normalized.has("zoho_crm");
  }
  if (normalizedSource === "zoho_mail") {
    return normalized.has("email") || normalized.has("mail") || normalized.has("zoho") || normalized.has("zoho_mail");
  }
  if (normalizedSource === "terminal") {
    return normalized.has("terminal") || normalized.has("shell") || normalized.has("exec_command");
  }
  if (normalizedSource === "cloudflare") {
    return normalized.has("cloudflare") || normalized.has("wrangler");
  }
  return false;
}
