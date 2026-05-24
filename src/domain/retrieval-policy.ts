import type { MemorySearchHit } from "~/domain/memory";

export type TaskProfile = "sales_proposal" | "code_repo" | "daily_priority" | "general";

export type RequiredContextPack = {
  project: string;
  task_profile: TaskProfile;
  required_documents: string[];
  required_live_checks: string[];
  retrieval_rules: string[];
};

export function inferTaskProfile(userIntent?: string | null): TaskProfile {
  const normalized = (userIntent ?? "").toLowerCase();
  if (/\b(proposal|pitch|sales|sell|quote|outreach|objection|customer|deal)\b/.test(normalized)) {
    return "sales_proposal";
  }
  if (/\b(repo|code|github|pull request|bug|typecheck|test|deploy|implementation)\b/.test(normalized)) {
    return "code_repo";
  }
  if (/\b(today|tomorrow|priority|priorities|daily|weekly|week plan|focus)\b/.test(normalized)) {
    return "daily_priority";
  }
  return "general";
}

export function buildRequiredContextPack(input: {
  project?: string;
  taskProfile?: TaskProfile;
  userIntent?: string | null;
}): RequiredContextPack {
  const project = input.project ?? "shared";
  const taskProfile = input.taskProfile ?? inferTaskProfile(input.userIntent);
  if (project === "light-lane" && taskProfile === "sales_proposal") {
    return {
      project,
      task_profile: taskProfile,
      required_documents: [
        "light-lane-entrypoint",
        "full-system-positioning",
        "core-sales-thesis",
        "answering-rules",
        "claim-boundaries",
        "relevant-use-cases",
        "source-trust",
        "current-deal-account-state",
      ],
      required_live_checks: [
        "crm_current_deal_state",
        "email_recent_customer_replies",
        "calendar_recent_or_upcoming_customer_meetings",
      ],
      retrieval_rules: [
        "Start from customer operations and commercial outcomes before technical detail.",
        "Retrieve full Light Lane system positioning before repo-specific material.",
        "Use structured entity states and recent source events for current opportunities.",
        "Treat old sessions as background only when current CRM/email state is unavailable.",
        "Include claim boundaries, integration guardrails, and timeline/material safety rules.",
      ],
    };
  }

  if (taskProfile === "code_repo") {
    return {
      project,
      task_profile: taskProfile,
      required_documents: ["repo-index", "current-context", "recent-decisions"],
      required_live_checks: ["local_git_status", "test_status"],
      retrieval_rules: [
        "Prefer current repo inspection over stale semantic memory for live code state.",
        "Use repo indexes as orientation, not as proof of current file contents.",
      ],
    };
  }

  if (taskProfile === "daily_priority") {
    return {
      project,
      task_profile: taskProfile,
      required_documents: ["current-context", "active-tasks", "recent-source-events"],
      required_live_checks: ["calendar", "crm_or_project_systems_when_relevant"],
      retrieval_rules: [
        "Use operational date and actionability before planning synchronous work.",
        "Prefer structured active tasks and recent source events over old sessions.",
      ],
    };
  }

  return {
    project,
    task_profile: taskProfile,
    required_documents: ["current-context"],
    required_live_checks: [],
    retrieval_rules: ["Prefer canonical current context, then structured facts, then semantic background."],
  };
}

export function applyDocumentDiversity(
  hits: MemorySearchHit[],
  options: {
    maxChunksPerDocument?: number;
    limit?: number;
  } = {},
) {
  const maxChunksPerDocument = options.maxChunksPerDocument ?? 2;
  const limit = options.limit ?? hits.length;
  const countsByDocumentId = new Map<string, number>();
  const diverse: MemorySearchHit[] = [];

  for (const hit of hits) {
    const count = countsByDocumentId.get(hit.documentId) ?? 0;
    if (count >= maxChunksPerDocument) {
      continue;
    }
    diverse.push(hit);
    countsByDocumentId.set(hit.documentId, count + 1);
    if (diverse.length >= limit) {
      break;
    }
  }

  return diverse;
}
