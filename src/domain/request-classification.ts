export type RequestPrimaryCategory =
  | "planning_scheduling"
  | "code_repo"
  | "customer_sales_business"
  | "memory_context"
  | "external_source_dependent"
  | "general";

export type RequestClassification = {
  primary_category: RequestPrimaryCategory;
  categories: {
    planning_scheduling: boolean;
    code_repo: boolean;
    customer_sales_business: boolean;
    memory_context: boolean;
    external_source_dependent: boolean;
    destructive_write_action: boolean;
  };
  matched_rules: string[];
  risk_level: "low" | "medium" | "high";
};

type Rule = {
  category: keyof RequestClassification["categories"];
  name: string;
  pattern: RegExp;
};

const RULES: Rule[] = [
  {
    category: "planning_scheduling",
    name: "planning/scheduling terms",
    pattern: /\b(plan|schedule|week|daily|day|today|tomorrow|next week|prioriti[sz]e|roadmap|agenda|due|reminder)\b/i,
  },
  {
    category: "code_repo",
    name: "code/repo terms",
    pattern: /\b(repo|repository|branch|pr|pull request|issue|commit|diff|ci|test|build|deploy|stack trace|typescript|javascript|migration)\b|[`][^`]+[`]|\b[\w.-]+\/[\w./-]+\.(ts|tsx|js|jsx|md|json|sql)\b/i,
  },
  {
    category: "customer_sales_business",
    name: "customer/sales/business terms",
    pattern: /\b(customer|lead|account|deal|crm|invoice|sales|follow-?up|call|email|meeting|supplier|business)\b/i,
  },
  {
    category: "memory_context",
    name: "memory/context terms",
    pattern: /\b(remember|recall|context|previous|decision|fact|task|source event|current context|finish session|memory)\b/i,
  },
  {
    category: "external_source_dependent",
    name: "live/external freshness terms",
    pattern: /\b(latest|current|today's|todays|status|live|recent|calendar|email|crm|shopify|github|workdrive|what happened)\b/i,
  },
  {
    category: "destructive_write_action",
    name: "write/destructive action terms",
    pattern: /\b(send|create|update|delete|archive|cancel|purchase|deploy|push|commit|write back|modify|overwrite)\b/i,
  },
];

export function classifyRequest(userIntent?: string): RequestClassification {
  const text = userIntent?.trim() ?? "";
  const matchedRules: string[] = [];
  const categories = {
    planning_scheduling: false,
    code_repo: false,
    customer_sales_business: false,
    memory_context: false,
    external_source_dependent: false,
    destructive_write_action: false,
  };

  for (const rule of RULES) {
    if (rule.pattern.test(text)) {
      categories[rule.category] = true;
      matchedRules.push(rule.name);
    }
  }

  return {
    primary_category: primaryCategory(categories),
    categories,
    matched_rules: matchedRules,
    risk_level: categories.destructive_write_action
      ? "high"
      : categories.external_source_dependent ||
          categories.customer_sales_business ||
          categories.code_repo
        ? "medium"
        : "low",
  };
}

export type RetrievalIntent = "planning" | "knowledge" | "status" | "historical" | "general";

export function deriveRetrievalIntent(
  classification: RequestClassification,
  userIntent?: string,
): RetrievalIntent {
  const text = (userIntent ?? "").toLowerCase();

  if (/\b(history|what happened|walk me through|recap)\b/.test(text)) {
    return "historical";
  }

  if (/\b(what is the status|status of|where are we with|update on|latest on)\b/.test(text)) {
    return "status";
  }

  if (
    classification.categories.planning_scheduling ||
    /\b(what should i|push on|focus on|work on|prioriti[sz]e|most important|best move|what.s next)\b/.test(text)
  ) {
    return "planning";
  }

  if (/\b(explain|tell me about|how does|describe|what is|what are)\b/.test(text)) {
    return "knowledge";
  }

  return "general";
}

/**
 * Whether a classified request depends on live external state (CRM, mail, calendar,
 * shopify, etc.) and should therefore trigger external-source live checks. Pure memory
 * or code-repo intents do not; current-state queries are covered separately via the
 * current-truth required_live_checks.
 */
export function requiresExternalStateChecks(classification: RequestClassification): boolean {
  return (
    classification.categories.customer_sales_business ||
    classification.categories.planning_scheduling ||
    classification.categories.external_source_dependent
  );
}

function primaryCategory(categories: RequestClassification["categories"]): RequestPrimaryCategory {
  if (categories.code_repo) {
    return "code_repo";
  }
  if (categories.customer_sales_business) {
    return "customer_sales_business";
  }
  if (categories.planning_scheduling) {
    return "planning_scheduling";
  }
  if (categories.memory_context) {
    return "memory_context";
  }
  if (categories.external_source_dependent) {
    return "external_source_dependent";
  }
  return "general";
}
