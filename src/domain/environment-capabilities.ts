import type { ClientEnvironment, EnvironmentCapability, ToolCapability } from "~/domain/memory";
import { connectorPolicyFor } from "~/domain/tool-policy";
import { isToolAvailable, normalizeToolName } from "~/domain/tool-availability";

export type EnvironmentToolUseInput = {
  environment?: string;
  userIntent: string;
  projectOrTopic?: string;
  availableTools?: string[];
  activeSources?: string[];
  proposedAction?: string;
  includeInstructions?: boolean;
  environments?: ClientEnvironment[];
  capabilities?: ToolCapability[];
  environmentCapabilities?: EnvironmentCapability[];
};

export type EnvironmentToolGuidance = {
  environment: {
    slug: string;
    display_name: string;
    default_tool_style: string;
  };
  available_capabilities: Array<{
    capability: string;
    display_name: string;
    source_kind: string;
    action_kind: string;
    invocation_style: string;
    tool_name: string | null;
    save_policy: string;
    source_of_truth: boolean;
    volatile: boolean;
  }>;
  unavailable_required_capabilities: Array<{
    capability: string;
    display_name: string;
    reason: string;
    fallback: string;
  }>;
  relevant_capabilities: Array<{
    capability: string;
    display_name: string;
    source_kind: string;
    required: boolean;
    available: boolean;
  }>;
  required_live_checks: Array<{ capability: string; source_kind: string; reason: string }>;
  live_checks_to_perform: Array<{ capability: string; source_kind: string; executor: "client" | "contextos" }>;
  contextos_can_execute: string[];
  client_must_execute: string[];
  client_instructions: string[];
  confirmation_required: Array<{ action: string; reason: string }>;
  write_back_policy: {
    mode: string;
    rules: string[];
    connector_policies: Record<string, ReturnType<typeof connectorPolicyFor>>;
  };
  unavailable_tool_warnings: string[];
  fallback_plan: string[];
};

const DEFAULT_ENVIRONMENTS: ClientEnvironment[] = [
  makeEnv("claude", "Claude", "mcp_tool"),
  makeEnv("chatgpt", "ChatGPT", "chatgpt_app"),
  makeEnv("codex", "Codex", "terminal_command"),
  makeEnv("generic_mcp", "Generic MCP Client", "mcp_tool"),
  makeEnv("local_cli", "Local CLI", "terminal_command"),
  makeEnv("other", "Other", "manual_instruction"),
];

const DEFAULT_CAPABILITIES: ToolCapability[] = [
  makeCap("contextos_memory", "ContextOS Memory", "memory", "search", true, false, "internal", false, false, "durable_summary", "Call prepare_assistant_session first."),
  makeCap("github_live", "GitHub Live Repo", "github", "inspect", true, true, "internal", false, false, "durable_summary", "Use live GitHub/repo tools before code claims."),
  makeCap("workdrive_live", "WorkDrive Canonical Memory", "workdrive", "read", true, true, "confidential", false, false, "durable_summary", "Treat WorkDrive Markdown as canonical durable memory."),
  makeCap("zoho_crm_live", "Zoho CRM Live Data", "zoho_crm", "read", true, true, "confidential", false, false, "durable_summary", "Check live CRM for account/deal/customer state."),
  makeCap("zoho_mail_live", "Zoho Mail Live Threads", "zoho_mail", "read", true, true, "sensitive", false, false, "requires_approval", "Keep raw email live-only."),
  makeCap("calendar_live", "Calendar Live Availability", "calendar", "read", true, true, "confidential", false, false, "durable_summary", "Check calendar before dated commitments."),
  makeCap("shopify_live", "Shopify Live Store", "shopify", "read", true, true, "confidential", false, false, "durable_summary", "Check live Shopify before ecommerce claims."),
  makeCap("cloudflare_live", "Cloudflare Live Platform", "cloudflare", "deploy", true, true, "internal", true, true, "durable_summary", "Use Wrangler/API; require confirmation for destructive operations."),
  makeCap("terminal_local", "Local Terminal", "terminal", "execute", true, true, "internal", true, false, "durable_summary", "Use terminal for local repo inspection and tests."),
  makeCap("memory_migration", "Memory Migration/Reconciliation", "memory", "migrate", false, false, "internal", true, false, "durable_summary", "Analyze first; apply only non-destructive metadata-safe changes."),
  makeCap("durable_writeback", "Durable Write-Back", "memory", "write", false, false, "internal", true, false, "durable_summary", "Write concise durable summaries, decisions, tasks, source events, and links."),
];

const DEFAULT_ENV_CAPS: EnvironmentCapability[] = [
  makeEnvCap("codex", "contextos_memory", "available", "mcp_tool", "memory.prepare_assistant_session", 10),
  makeEnvCap("codex", "terminal_local", "available", "terminal_command", "terminal", 20),
  makeEnvCap("codex", "github_live", "user_configured", "connector", "github", 30),
  makeEnvCap("codex", "cloudflare_live", "user_configured", "terminal_command", "wrangler", 40),
  makeEnvCap("claude", "contextos_memory", "available", "mcp_tool", "prepare_assistant_session", 10),
  makeEnvCap("chatgpt", "contextos_memory", "available", "mcp_tool", "prepare_assistant_session", 10),
  makeEnvCap("generic_mcp", "contextos_memory", "available", "mcp_tool", "prepare_assistant_session", 10),
  makeEnvCap("local_cli", "contextos_memory", "available", "terminal_command", "memory-mcp", 10),
];

export function defaultClientEnvironments() {
  return DEFAULT_ENVIRONMENTS;
}

export function defaultToolCapabilities() {
  return DEFAULT_CAPABILITIES;
}

export function defaultEnvironmentCapabilities() {
  return DEFAULT_ENV_CAPS;
}

export function planEnvironmentToolUse(input: EnvironmentToolUseInput): EnvironmentToolGuidance {
  const environments = mergeBySlug(DEFAULT_ENVIRONMENTS, input.environments ?? []);
  const capabilities = mergeBySlug(DEFAULT_CAPABILITIES, input.capabilities ?? []);
  const envCaps = mergeEnvCaps(DEFAULT_ENV_CAPS, input.environmentCapabilities ?? []);
  const resolvedEnvironment = resolveEnvironment(input.environment, input.availableTools, environments);
  const env = environments.find((item) => item.slug === resolvedEnvironment) ?? environments.find((item) => item.slug === "other")!;
  const intent = input.userIntent.toLowerCase();
  const activeSourceKeys = new Set((input.activeSources ?? []).map(normalizeToolName));
  const required = requiredCapabilitySlugs(intent, input.proposedAction, activeSourceKeys);
  const bySlug = new Map(capabilities.map((capability) => [capability.slug, capability]));
  const envCapsForEnv = envCaps
    .filter((capability) => capability.environmentSlug === resolvedEnvironment)
    .sort((left, right) => left.priority - right.priority);
  const envCapByCapability = new Map(envCapsForEnv.map((capability) => [capability.capabilitySlug, capability]));

  const relevant = capabilities.filter((capability) =>
    required.has(capability.slug) ||
    activeSourceKeys.has(normalizeToolName(capability.sourceKind)) ||
    mentionsCapability(intent, capability),
  );
  const relevantWithMemory = relevant.some((capability) => capability.slug === "contextos_memory")
    ? relevant
    : [bySlug.get("contextos_memory")!, ...relevant];

  const availableCapabilities = relevantWithMemory.flatMap((capability) => {
    const envCap = envCapByCapability.get(capability.slug);
    const available = capabilityAvailable(capability, envCap, input.availableTools);
    if (!available) {
      return [];
    }
    return [{
      capability: capability.slug,
      display_name: capability.displayName,
      source_kind: capability.sourceKind,
      action_kind: capability.actionKind,
      invocation_style: envCap?.invocationStyle ?? env.defaultToolStyle ?? "manual_instruction",
      tool_name: envCap?.toolName ?? capability.slug,
      save_policy: capability.savePolicy,
      source_of_truth: capability.sourceOfTruth,
      volatile: capability.volatile,
    }];
  });

  const unavailableRequired = [...required].flatMap((slug) => {
    const capability = bySlug.get(slug);
    if (!capability) {
      return [];
    }
    const envCap = envCapByCapability.get(slug);
    if (capabilityAvailable(capability, envCap, input.availableTools)) {
      return [];
    }
    return [{
      capability: slug,
      display_name: capability.displayName,
      reason: `${capability.displayName} is required for this request but is not available in ${env.displayName}.`,
      fallback: fallbackForCapability(capability),
    }];
  });

  const requiredLiveChecks = relevantWithMemory
    .filter((capability) => required.has(capability.slug) && capability.volatile)
    .map((capability) => ({
      capability: capability.slug,
      source_kind: capability.sourceKind,
      reason: `Check live ${capability.sourceKind} before relying on current state.`,
    }));
  const liveChecks = requiredLiveChecks.map((check) => ({
    ...check,
    executor: contextosCanExecute(check.source_kind) ? "contextos" as const : "client" as const,
  }));
  const confirmationRequired = relevantWithMemory
    .filter((capability) => capability.requiresConfirmation || capability.destructive)
    .map((capability) => ({
      action: capability.displayName,
      reason: capability.destructive
        ? "Destructive or externally mutating operations require explicit user confirmation."
        : "This capability may write or expose sensitive state and requires confirmation before applying changes.",
    }));
  const sources = [...new Set(relevantWithMemory.map((capability) => capability.sourceKind))];

  return {
    environment: {
      slug: env.slug,
      display_name: env.displayName,
      default_tool_style: env.defaultToolStyle ?? "manual_instruction",
    },
    available_capabilities: availableCapabilities,
    unavailable_required_capabilities: unavailableRequired,
    relevant_capabilities: relevantWithMemory.map((capability) => ({
      capability: capability.slug,
      display_name: capability.displayName,
      source_kind: capability.sourceKind,
      required: required.has(capability.slug),
      available: capabilityAvailable(capability, envCapByCapability.get(capability.slug), input.availableTools),
    })),
    required_live_checks: requiredLiveChecks,
    live_checks_to_perform: liveChecks,
    contextos_can_execute: liveChecks.filter((check) => check.executor === "contextos").map((check) => check.capability),
    client_must_execute: liveChecks.filter((check) => check.executor === "client").map((check) => check.capability),
    client_instructions: input.includeInstructions === false ? [] : buildClientInstructions(env.slug, relevantWithMemory, envCapByCapability),
    confirmation_required: confirmationRequired,
    write_back_policy: {
      mode: "selective_durable_facts",
      rules: [
        "Store durable summaries, decisions, deadlines, relationships, and source links.",
        "Keep raw external payloads, full private emails, attachments, and sensitive PII live-only unless explicitly approved.",
        "Prefer source_event + fact/task/entity writes over large copied documents.",
      ],
      connector_policies: Object.fromEntries(sources.map((source) => [source, connectorPolicyFor(source)])),
    },
    unavailable_tool_warnings: unavailableRequired.map((item) => item.reason),
    fallback_plan: unavailableRequired.length
      ? unavailableRequired.map((item) => item.fallback)
      : ["Proceed with available live checks, then write back only concise durable summaries."],
  };
}

function resolveEnvironment(environment: string | undefined, availableTools: string[] | undefined, environments: ClientEnvironment[]) {
  const explicit = environment ? normalizeToolName(environment) : "";
  const aliases: Record<string, string> = {
    claude_desktop: "claude",
    chat_gpt: "chatgpt",
    openai: "chatgpt",
    codex_cli: "codex",
    codex_app: "codex",
    generic: "generic_mcp",
    mcp: "generic_mcp",
    local: "local_cli",
  };
  const candidate = aliases[explicit] ?? explicit;
  if (environments.some((item) => item.slug === candidate)) {
    return candidate;
  }
  const tools = (availableTools ?? []).map(normalizeToolName).join(" ");
  if (tools.includes("exec_command") || tools.includes("terminal") || tools.includes("wrangler")) {
    return "codex";
  }
  return "generic_mcp";
}

function requiredCapabilitySlugs(intent: string, proposedAction: string | undefined, activeSources: Set<string>) {
  const required = new Set<string>(["contextos_memory"]);
  const text = `${intent} ${proposedAction ?? ""}`.toLowerCase();
  if (/\b(repo|code|github|pull request|issue|commit|branch)\b/.test(text)) {
    required.add("github_live");
  }
  if (/\b(customer|deal|crm|sales|account|lead)\b/.test(text) || activeSources.has("zoho_crm")) {
    required.add("zoho_crm_live");
  }
  if (/\b(email|mail|thread|inbox|reply|outreach)\b/.test(text) || activeSources.has("zoho_mail")) {
    required.add("zoho_mail_live");
  }
  if (/\b(calendar|meeting|schedule|availability|today|tomorrow|week|reminder)\b/.test(text) || activeSources.has("calendar")) {
    required.add("calendar_live");
  }
  if (/\b(shopify|order|product|inventory|store)\b/.test(text) || activeSources.has("shopify")) {
    required.add("shopify_live");
  }
  if (/\b(cloudflare|wrangler|deploy|migration|d1|vectorize|worker)\b/.test(text)) {
    required.add("cloudflare_live");
  }
  if (/\b(local|terminal|shell|test|tests|typecheck|build)\b/.test(text)) {
    required.add("terminal_local");
  }
  if (/\b(migration|reconcile|duplicate|superseded|canonical|alias)\b/.test(text)) {
    required.add("memory_migration");
  }
  if (/\b(save|record|write back|decision|task|source event|summary)\b/.test(text)) {
    required.add("durable_writeback");
  }
  return required;
}

function capabilityAvailable(capability: ToolCapability, envCap: EnvironmentCapability | undefined, availableTools?: string[]) {
  if (envCap?.availability === "unavailable") {
    return false;
  }
  if (!availableTools?.length) {
    return envCap?.availability !== "unknown";
  }
  if (isToolAvailable(envCap?.toolName ?? capability.slug, capability.sourceKind, availableTools)) {
    return true;
  }
  return envCap?.availability === "available" && capability.sourceKind === "memory";
}

function contextosCanExecute(sourceKind: string) {
  return ["memory", "github", "workdrive"].includes(sourceKind);
}

function fallbackForCapability(capability: ToolCapability) {
  if (capability.sourceKind === "memory") {
    return "Say ContextOS memory was unavailable and proceed only from visible context with lower confidence.";
  }
  return `Ask the client/user to check ${capability.sourceKind}, or proceed with a clear unverified-source warning.`;
}

function mentionsCapability(intent: string, capability: ToolCapability) {
  return intent.includes(capability.sourceKind.replace("_", " ")) ||
    intent.includes(capability.sourceKind) ||
    intent.includes(capability.displayName.toLowerCase());
}

function buildClientInstructions(envSlug: string, capabilities: ToolCapability[], envCaps: Map<string, EnvironmentCapability>) {
  const intro = envSlug === "codex"
    ? "In Codex, use ContextOS first, then local terminal/GitHub/Cloudflare tools that are actually available."
    : "Call ContextOS first, then perform the returned live checks using tools available in this client.";
  return [
    intro,
    ...capabilities.map((capability) => {
      const envCap = envCaps.get(capability.slug);
      const tool = envCap?.toolName ? ` via ${envCap.toolName}` : "";
      const usage = envCap?.usageInstructionsMarkdown ?? capability.instructionsMarkdown ?? "";
      return `${capability.displayName}${tool}: ${usage}`.trim();
    }),
    "If a required tool is unavailable, say what was not checked and downgrade confidence.",
    "Write back only durable summaries, decisions, tasks, source events, facts, and links unless raw private data is explicitly approved.",
  ];
}

function makeEnv(slug: string, displayName: string, defaultToolStyle: string): ClientEnvironment {
  return {
    id: `env-${slug}`,
    slug,
    displayName,
    description: null,
    defaultToolStyle,
    notes: null,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };
}

function makeCap(
  slug: string,
  displayName: string,
  sourceKind: string,
  actionKind: string,
  sourceOfTruth: boolean,
  volatile: boolean,
  sensitivity: ToolCapability["sensitivity"],
  requiresConfirmation: boolean,
  destructive: boolean,
  savePolicy: ToolCapability["savePolicy"],
  instructionsMarkdown: string,
): ToolCapability {
  return {
    id: `cap-${slug}`,
    slug,
    displayName,
    sourceKind,
    actionKind,
    sourceOfTruth,
    volatile,
    sensitivity,
    requiresConfirmation,
    destructive,
    savePolicy,
    instructionsMarkdown,
    inputHints: {},
    outputHints: {},
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };
}

function makeEnvCap(
  environmentSlug: string,
  capabilitySlug: string,
  availability: EnvironmentCapability["availability"],
  invocationStyle: EnvironmentCapability["invocationStyle"],
  toolName: string,
  priority: number,
): EnvironmentCapability {
  return {
    id: `ec-${environmentSlug}-${capabilitySlug}`,
    environmentSlug,
    capabilitySlug,
    availability,
    invocationStyle,
    toolName,
    usageInstructionsMarkdown: null,
    limitationsMarkdown: null,
    priority,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };
}

function mergeBySlug<T extends { slug: string }>(defaults: T[], custom: T[]) {
  const map = new Map(defaults.map((item) => [item.slug, item]));
  for (const item of custom) {
    map.set(item.slug, item);
  }
  return [...map.values()];
}

function mergeEnvCaps(defaults: EnvironmentCapability[], custom: EnvironmentCapability[]) {
  const map = new Map(defaults.map((item) => [`${item.environmentSlug}:${item.capabilitySlug}`, item]));
  for (const item of custom) {
    map.set(`${item.environmentSlug}:${item.capabilitySlug}`, item);
  }
  return [...map.values()];
}
