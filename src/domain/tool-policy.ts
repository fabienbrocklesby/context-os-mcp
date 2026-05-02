import type { RequestClassification } from "~/domain/request-classification";

export type ToolPlan = {
  required_tools: Array<{
    tool: string;
    reason: string;
    timing: "before_answer" | "before_action" | "before_write";
  }>;
  optional_tools: Array<{ tool: string; reason: string }>;
  forbidden_without_confirmation: Array<{ action: string; reason: string }>;
  write_back_recommendations: Array<{
    tool: string;
    when: string;
    content_types: string[];
  }>;
  connector_policy_defaults: Record<string, ConnectorPolicyDefault>;
};

export type ConnectorPolicyDefault = {
  save_policy: "durable_summary" | "live_only" | "requires_approval";
  durable: string[];
  requires_approval: string[];
  live_only: string[];
};

export type ToolPolicyInput = {
  classification: RequestClassification;
  activeSources?: string[];
  availableTools?: string[];
};

const DEFAULT_CONNECTORS = [
  "zoho_crm",
  "zoho_mail",
  "zoho_calendar",
  "zoho_notes",
  "github",
  "shopify",
  "workdrive",
];

export function buildToolPlan(input: ToolPolicyInput): ToolPlan {
  const activeSources = input.activeSources?.length ? input.activeSources : DEFAULT_CONNECTORS;
  const required = new Map<string, ToolPlan["required_tools"][number]>();
  const optional = new Map<string, ToolPlan["optional_tools"][number]>();
  const forbidden = new Map<string, ToolPlan["forbidden_without_confirmation"][number]>();
  const writeBack = new Map<string, ToolPlan["write_back_recommendations"][number]>();
  const categories = input.classification.categories;

  if (categories.planning_scheduling) {
    addRequired(required, {
      tool: "get_operational_context",
      reason: "Validate actual date, weekday, timezone, business-day status, and business hours before planning.",
      timing: "before_answer",
    });
    addOptional(optional, {
      tool: "calendar",
      reason: "Check live availability when the request depends on meetings, reminders, or dated commitments.",
    });
  }

  if (categories.code_repo) {
    addRequired(required, {
      tool: "github_project_repos",
      reason: "Identify the live repository associated with the project before making repo claims.",
      timing: "before_answer",
    });
    addRequired(required, {
      tool: "github_search_code",
      reason: "Inspect live code before diagnosing or planning code changes.",
      timing: "before_action",
    });
    addOptional(optional, {
      tool: "github_get_file",
      reason: "Fetch exact files when search results identify relevant paths.",
    });
  }

  if (categories.customer_sales_business) {
    addRequired(required, {
      tool: "crm",
      reason: "Check live account/deal state before customer or sales recommendations.",
      timing: "before_action",
    });
    addRequired(required, {
      tool: "email",
      reason: "Check recent thread state before outreach or follow-up recommendations.",
      timing: "before_action",
    });
    addOptional(optional, {
      tool: "calendar",
      reason: "Check live schedule before recommending calls or meetings.",
    });
  }

  if (categories.memory_context) {
    addRequired(required, {
      tool: "prepare_assistant_session",
      reason: "Resolve project context and durable memory before relying on remembered facts.",
      timing: "before_answer",
    });
    addOptional(optional, {
      tool: "search_memory",
      reason: "Search project-scoped memory for deeper recall when the session plan is not enough.",
    });
  }

  if (categories.external_source_dependent) {
    for (const source of activeSources) {
      addRequired(required, {
        tool: source,
        reason: `Check live ${source} state because the request depends on current or recent information.`,
        timing: "before_answer",
      });
    }
  }

  if (categories.destructive_write_action) {
    for (const action of [
      "send messages or emails",
      "update external records",
      "delete, archive, cancel, purchase, deploy, push, or commit",
      "write raw private data to memory",
    ]) {
      addForbidden(forbidden, {
        action,
        reason: "Write or destructive actions require explicit user confirmation and relevant live context.",
      });
    }
  }

  if (categories.memory_context || categories.destructive_write_action || categories.external_source_dependent) {
    addWriteBack(writeBack, {
      tool: "finish_work_session",
      when: "At the end of meaningful work.",
      content_types: ["summary", "decisions", "verified commands", "remaining risks"],
    });
  }
  if (categories.planning_scheduling) {
    addWriteBack(writeBack, {
      tool: "upsert_task",
      when: "When the user asks to persist a task, reminder, or follow-up.",
      content_types: ["task title", "due date", "reminder date", "source link"],
    });
  }
  if (categories.external_source_dependent || categories.customer_sales_business) {
    addWriteBack(writeBack, {
      tool: "save_source_event",
      when: "When a live source changes durable project context.",
      content_types: ["durable summary", "source id", "source URL", "sensitivity"],
    });
  }
  addWriteBack(writeBack, {
    tool: "extract_durable_facts",
    when: "When user-approved text contains durable facts or decisions.",
    content_types: ["fact candidates", "source", "confidence"],
  });

  return {
    required_tools: [...required.values()],
    optional_tools: [...optional.values()],
    forbidden_without_confirmation: [...forbidden.values()],
    write_back_recommendations: [...writeBack.values()],
    connector_policy_defaults: Object.fromEntries(
      activeSources.map((source) => [source, connectorPolicyFor(source)]),
    ),
  };
}

export function connectorPolicyFor(source: string): ConnectorPolicyDefault {
  const key = source.toLowerCase().replace(/[-\s]+/g, "_");
  const policies: Record<string, ConnectorPolicyDefault> = {
    zoho_crm: {
      save_policy: "durable_summary",
      durable: ["deal stage changes", "account updates", "contact summaries", "follow-up tasks"],
      requires_approval: ["full records", "private notes", "attachments"],
      live_only: ["raw CRM payloads"],
    },
    zoho_mail: {
      save_policy: "requires_approval",
      durable: ["thread summaries", "commitments", "deadlines", "decisions"],
      requires_approval: ["raw body", "attachments", "full thread"],
      live_only: ["message body", "attachments"],
    },
    zoho_calendar: {
      save_policy: "durable_summary",
      durable: ["meeting summaries", "deadlines", "follow-ups"],
      requires_approval: ["private descriptions", "full attendee lists"],
      live_only: ["raw event payloads"],
    },
    zoho_notes: {
      save_policy: "durable_summary",
      durable: ["note summaries", "decisions", "ideas", "tasks"],
      requires_approval: ["full private notes"],
      live_only: ["raw note payloads"],
    },
    github: {
      save_policy: "durable_summary",
      durable: ["repo changes", "issues", "pull requests", "release summaries"],
      requires_approval: ["large diffs", "private repo file bodies"],
      live_only: ["raw diffs"],
    },
    shopify: {
      save_policy: "durable_summary",
      durable: ["product updates", "order summaries without PII", "inventory changes"],
      requires_approval: ["customer PII", "order line items with identifying data"],
      live_only: ["raw order payloads"],
    },
    workdrive: {
      save_policy: "durable_summary",
      durable: ["document summaries", "decisions", "plans", "context updates"],
      requires_approval: ["full private documents"],
      live_only: ["binary files"],
    },
  };
  return policies[key] ?? {
    save_policy: "requires_approval",
    durable: ["durable summary with source link"],
    requires_approval: ["raw source content"],
    live_only: ["unknown connector payloads"],
  };
}

function addRequired(
  map: Map<string, ToolPlan["required_tools"][number]>,
  item: ToolPlan["required_tools"][number],
) {
  map.set(item.tool, item);
}

function addOptional(
  map: Map<string, ToolPlan["optional_tools"][number]>,
  item: ToolPlan["optional_tools"][number],
) {
  map.set(item.tool, item);
}

function addForbidden(
  map: Map<string, ToolPlan["forbidden_without_confirmation"][number]>,
  item: ToolPlan["forbidden_without_confirmation"][number],
) {
  map.set(item.action, item);
}

function addWriteBack(
  map: Map<string, ToolPlan["write_back_recommendations"][number]>,
  item: ToolPlan["write_back_recommendations"][number],
) {
  map.set(item.tool, item);
}
