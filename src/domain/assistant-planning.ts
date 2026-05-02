import { assessActionability, type ActionabilityAssessment } from "~/domain/actionability";
import { classifyRequest, type RequestClassification } from "~/domain/request-classification";
import { buildTimeContext, type TimeContext } from "~/domain/time-context";
import { buildToolPlan, type ToolPlan } from "~/domain/tool-policy";

export type AssistantPlanningInput = {
  userIntent?: string;
  activeSources?: string[];
  availableTools?: string[];
  timezone?: string;
  projectTimezone?: unknown;
  envDefaultTimezone?: string;
  now?: string;
  businessHours?: {
    start?: string;
    end?: string;
    business_days?: number[];
  };
};

export type AssistantActionPlan = {
  operational_context: TimeContext;
  request_classification: RequestClassification;
  actionability: ActionabilityAssessment;
  tool_plan: ToolPlan;
};

export function buildAssistantActionPlan(input: AssistantPlanningInput): AssistantActionPlan {
  const operationalContext = buildTimeContext({
    timezone: input.timezone,
    projectTimezone: input.projectTimezone,
    envDefaultTimezone: input.envDefaultTimezone,
    now: input.now,
    businessHours: input.businessHours,
  });
  const requestClassification = classifyRequest(input.userIntent);
  const toolPlan = buildToolPlan({
    classification: requestClassification,
    activeSources: input.activeSources,
    availableTools: input.availableTools,
  });
  const actionability = assessActionability({
    timeContext: operationalContext,
    classification: requestClassification,
    toolPlan,
    availableTools: input.availableTools,
  });

  return {
    operational_context: operationalContext,
    request_classification: requestClassification,
    actionability,
    tool_plan: toolPlan,
  };
}
