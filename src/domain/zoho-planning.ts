export type LightLaneLiveStateInput = {
  project?: string;
  userIntent?: string;
  availableTools?: string[];
  force?: boolean;
};

export type ZohoExternalWriteInput = {
  project?: string;
  requestedAction: string;
  writeCapableConnectorName?: string;
};

export type LightLaneLiveStatePlan = {
  project: string;
  eligible: boolean;
  mode: "read_only_live_refresh" | "not_applicable";
  reason: string;
  read_connector: {
    name: string;
    required: boolean;
    allowed_operations: string[];
  };
  required_source_kinds: string[];
  recommended_state_keys: string[];
  stale_after_minutes: number;
  allowed_durable_writes: string[];
  forbidden_actions: string[];
  connector_health: {
    available: boolean;
    status: "available" | "unavailable";
    checked_from_available_tools: boolean;
    warning?: string;
  };
  fallback: string;
};

export type ZohoExternalWritePlan = {
  project: string;
  requested_action: string;
  contextos_can_execute: false;
  delegate_to: "write_capable_zoho_mcp";
  recommended_connector: string;
  confirmation_required: true;
  required_before_write: string[];
  post_action_write_back: string[];
  forbidden_contextos_actions: string[];
  privacy_rules: string[];
};

const LIGHT_LANE_ZOHO_PROJECTS = new Set([
  "light-lane",
  "lightlane",
  "fivestar-print",
]);

const READ_ONLY_TOOL_ALIASES = [
  "lightlane_readonly_zoho_mcp",
  "light_lane_readonly_zoho_mcp",
  "lightlane_read_only_zoho_mcp",
  "light_lane_read_only_zoho_mcp",
  "zoho_mcp_readonly",
  "zoho_mcp_read_only",
  "read_only_zoho",
  "readonly_zoho",
];

const ALLOWED_DURABLE_WRITES = [
  "entity_state",
  "source_event",
  "task",
  "fact",
  "decision",
];

const FORBIDDEN_ACTIONS = [
  "update_zoho_record",
  "send_email",
  "mark_email_read",
  "create_calendar_event",
  "update_calendar_event",
  "delete_calendar_event",
  "store_raw_crm_payload",
  "store_raw_email_body",
  "store_raw_calendar_payload",
];

export function isLightLaneZohoEligibleProject(project?: string) {
  return LIGHT_LANE_ZOHO_PROJECTS.has(normalize(project));
}

export function buildLightLaneLiveStatePlan(input: LightLaneLiveStateInput): LightLaneLiveStatePlan {
  const project = normalize(input.project || "light-lane");
  const eligible = input.force === true || isLightLaneZohoEligibleProject(project);
  const requiredSourceKinds = eligible ? sourceKindsForIntent(input.userIntent) : [];
  const connectorAvailable = hasReadOnlyZohoTool(input.availableTools);

  return {
    project,
    eligible,
    mode: eligible ? "read_only_live_refresh" : "not_applicable",
    reason: eligible
      ? "Light Lane current-state work can use read-only Zoho live checks and safe structured write-back."
      : "Project is not configured for Light Lane Zoho live-state maintenance.",
    read_connector: {
      name: "LightLane-ReadOnly Zoho MCP",
      required: eligible,
      allowed_operations: [
        "search_crm_records",
        "list_crm_records",
        "get_crm_record",
        "search_mail",
        "list_mail_metadata",
        "get_mail_for_summary",
        "search_calendar_events",
        "list_calendar_events",
        "read_workdrive_or_notebook_context",
      ],
    },
    required_source_kinds: requiredSourceKinds,
    recommended_state_keys: stateKeysForSources(requiredSourceKinds),
    stale_after_minutes: 240,
    allowed_durable_writes: [...ALLOWED_DURABLE_WRITES],
    forbidden_actions: [...FORBIDDEN_ACTIONS],
    connector_health: {
      available: connectorAvailable,
      status: connectorAvailable ? "available" : "unavailable",
      checked_from_available_tools: Boolean(input.availableTools?.length),
      ...(connectorAvailable
        ? {}
        : {
            warning:
              "Read-only Zoho MCP was not advertised by the client; require a live check or report lower confidence.",
          }),
    },
    fallback:
      "If read-only Zoho is unavailable, use existing current_truth/entity_states only with a freshness warning and ask the client to check Zoho.",
  };
}

export function buildZohoExternalWritePlan(input: ZohoExternalWriteInput): ZohoExternalWritePlan {
  const project = normalize(input.project || "light-lane");
  return {
    project,
    requested_action: input.requestedAction,
    contextos_can_execute: false,
    delegate_to: "write_capable_zoho_mcp",
    recommended_connector: input.writeCapableConnectorName ?? "LightLane Zoho MCP",
    confirmation_required: true,
    required_before_write: [
      "resolve current project and entity",
      "check live CRM/mail/calendar state with read-only tools first",
      "get explicit user confirmation for the exact external write",
      "use the separate write-capable Zoho MCP for the mutation",
    ],
    post_action_write_back: [
      "source_event",
      "entity_state",
      "task",
    ],
    forbidden_contextos_actions: [...FORBIDDEN_ACTIONS],
    privacy_rules: [
      "Do not store raw CRM payloads.",
      "Do not store raw email bodies or attachments.",
      "Do not store full private calendar details.",
      "Write only concise durable summaries, observed timestamps, confidence, and source pointers.",
    ],
  };
}

export function hasReadOnlyZohoTool(availableTools?: string[]) {
  if (!availableTools?.length) {
    return false;
  }
  const normalizedTools = new Set(availableTools.map(normalizeToolSignal));
  return READ_ONLY_TOOL_ALIASES.some((alias) => normalizedTools.has(alias));
}

function sourceKindsForIntent(userIntent?: string) {
  const text = (userIntent ?? "").toLowerCase();
  const sources: string[] = [];
  if (/\b(deal|lead|account|contact|crm|pipeline|stage|opportunity|quote|proposal)\b/i.test(text)) {
    sources.push("zoho_crm");
  }
  if (/\b(email|mail|reply|thread|inbox|outreach|respond|message)\b/i.test(text)) {
    sources.push("zoho_mail");
  }
  if (/\b(calendar|meeting|schedule|availability|call|today|tomorrow|week)\b/i.test(text)) {
    sources.push("calendar");
  }
  if (/\b(note|notebook|workdrive|document|proposal|file)\b/i.test(text)) {
    sources.push("workdrive");
  }
  return sources.length ? [...new Set(sources)] : ["zoho_crm", "zoho_mail"];
}

function stateKeysForSources(sourceKinds: string[]) {
  const stateKeys = new Set<string>();
  for (const source of sourceKinds) {
    if (source === "zoho_crm") {
      stateKeys.add("deal_stage");
      stateKeys.add("deal_amount");
      stateKeys.add("closing_date");
      stateKeys.add("next_action");
    }
    if (source === "zoho_mail") {
      stateKeys.add("latest_thread_summary");
      stateKeys.add("reply_status");
      stateKeys.add("commitments");
    }
    if (source === "calendar") {
      stateKeys.add("meeting_status");
      stateKeys.add("availability_window");
    }
    if (source === "workdrive") {
      stateKeys.add("supporting_document_summary");
    }
  }
  return [...stateKeys];
}

function normalize(value?: string) {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_/g, "-");
}

function normalizeToolSignal(value?: string) {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}
