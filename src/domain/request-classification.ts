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
