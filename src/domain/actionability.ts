import { nextBusinessStartLabel, type TimeContext } from "~/domain/time-context";
import type { RequestClassification } from "~/domain/request-classification";
import type { ToolPlan } from "~/domain/tool-policy";
import { isToolAvailable } from "~/domain/tool-availability";

export type ActionabilityAssessment = {
  label:
    | "actionable_now"
    | "prep_or_async_only"
    | "defer_to_business_hours"
    | "requires_live_context"
    | "requires_confirmation"
    | "blocked";
  reasons: string[];
  recommended_now: string[];
  defer_until?: string;
  guardrails: string[];
};

export function assessActionability(input: {
  timeContext: TimeContext;
  classification: RequestClassification;
  toolPlan: ToolPlan;
  availableTools?: string[];
}): ActionabilityAssessment {
  const { timeContext, classification } = input;
  const categories = classification.categories;
  const reasons: string[] = [
    `Validated local time as ${timeContext.weekday} ${timeContext.local_date} ${timeContext.local_time} in ${timeContext.timezone}.`,
  ];
  const recommendedNow: string[] = [];
  const guardrails: string[] = [
    "Do not infer public holiday status; Phase 1 has no holiday calendar configured.",
  ];

  if (categories.destructive_write_action) {
    reasons.push("The request includes a write or destructive action.");
    guardrails.push("Get explicit user confirmation before any write or destructive external action.");
    return {
      label: "requires_confirmation",
      reasons,
      recommended_now: ["Gather context, explain the intended action, and ask for confirmation before executing."],
      guardrails,
    };
  }

  if (missingRequiredTools(input.toolPlan, input.availableTools).length > 0) {
    reasons.push("One or more required live tools are not available in the provided tool list.");
    return {
      label: "blocked",
      reasons,
      recommended_now: ["State which required live tools are unavailable and proceed only from visible context if acceptable."],
      guardrails,
    };
  }

  if (categories.external_source_dependent) {
    reasons.push("The request depends on current or recent external-source state.");
    guardrails.push("Use required live tools before making factual claims about current state.");
    return {
      label: "requires_live_context",
      reasons,
      recommended_now: ["Query required live sources before answering or acting."],
      guardrails,
    };
  }

  if (!timeContext.is_business_day) {
    reasons.push(`${timeContext.weekday} is not a configured business day.`);
    recommendedNow.push("Do prep, admin, drafting, review, or asynchronous work.");
    if (categories.customer_sales_business) {
      guardrails.push("Do not recommend business calls today unless the user explicitly justifies weekend outreach.");
      recommendedNow.push("Prepare outreach notes and queue follow-up for the next business day.");
    }
    return {
      label: "prep_or_async_only",
      reasons,
      recommended_now: recommendedNow,
      defer_until: nextBusinessStartLabel(timeContext),
      guardrails,
    };
  }

  if (!timeContext.is_business_hours && categories.customer_sales_business) {
    reasons.push("The request involves customer or business-hour work outside configured business hours.");
    return {
      label: "defer_to_business_hours",
      reasons,
      recommended_now: ["Prepare notes, draft messages, and review context asynchronously."],
      defer_until: nextBusinessStartLabel(timeContext),
      guardrails: [
        ...guardrails,
        "Defer calls and synchronous customer outreach until business hours unless explicitly approved.",
      ],
    };
  }

  recommendedNow.push("Proceed after using any required context or source-check tools.");
  if (categories.planning_scheduling) {
    recommendedNow.push("Build the plan around the validated local weekday and actionability constraints.");
  }
  return {
    label: "actionable_now",
    reasons,
    recommended_now: recommendedNow,
    guardrails,
  };
}

function missingRequiredTools(toolPlan: ToolPlan, availableTools?: string[]) {
  if (!availableTools?.length) {
    return [];
  }
  return toolPlan.required_tools.filter((tool) => !isToolAvailable(tool.tool, tool.tool, availableTools));
}
