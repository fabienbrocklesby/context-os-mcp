import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import type { MemoryPrincipal } from "~/domain/memory";

vi.mock("~/domain/service", () => {
  // MemoryService is no longer wired into the MCP server. Keep a minimal stub
  // so legacy unit tests that still import from this module don't break.
  class MockMemoryService {
    async searchMemory() {
      return {
        results: [
          {
            id: "doc-1",
            title: "Vision",
            path: "/memory/shared/context/current/vision.md",
            url: "https://memory.example.com/doc-1",
            text: "Canonical truth",
            score: 0.91,
            memory_type: "current_context",
            status: "active",
            heading_path: "Vision",
          },
        ],
        documents: [],
      };
    }

    async getDocument() {
      return {
        document: {
          id: "doc-1",
          title: "Vision",
          path: "/memory/shared/context/current/vision.md",
          permalink: "https://memory.example.com/doc-1",
          project: "shared",
          memoryType: "current_context",
          status: "active",
          revision: 2,
        },
        snapshot: {
          rawMarkdown: "# Vision\n\nCanonical truth",
        },
        authoritative_markdown: "# Vision\n\nCanonical truth",
      };
    }

    async getCurrentContext() {
      return { items: [] };
    }

    async prepareAssistantSession(input?: { responseMode?: "compact" | "expanded" }) {
      return {
        response_mode: input?.responseMode ?? "compact",
        active_project: {
          slug: "memory-system-mcp",
          displayName: "Memory System MCP",
        },
        context_resolution: {
          project_switching: {
            selected: "memory-system-mcp",
            reason: "Exact project or alias match.",
          },
        },
        grouped_memory: {
          grouped: {
            current_context: [],
          },
        },
        recommended_live_mcp_checks: ["Check live github for fresh context before writing durable summaries."],
        write_back_policy: {
          mode: "selective_durable_facts",
        },
        strategy_context: {
          project: "memory-system-mcp",
          visions: [],
          warnings: ["no_active_vision"],
        },
        operational_context: {
          timezone: "Pacific/Auckland",
          weekday: "Saturday",
          is_weekend: true,
        },
        request_classification: {
          primary_category: "planning_scheduling",
        },
        actionability: {
          label: "prep_or_async_only",
        },
        tool_plan: {
          required_tools: [],
        },
        operating_brief: {
          context_resolution: {
            project_switching: {
              selected: "memory-system-mcp",
            },
          },
          time_actionability: {
            weekday: "Saturday",
            actionability_label: "prep_or_async_only",
          },
          strategic_alignment: {
            project: "memory-system-mcp",
            assessment: null,
          },
          relevant_assets: [],
          current_tasks_milestones: {
            open_tasks: [],
            milestones: [],
          },
          source_freshness: {
            retrieval_mode: "no_hits",
            warnings: [],
          },
          required_live_checks: [],
          risks: [],
          recommended_next_actions: {
            before_answer: [],
            before_action: [],
            safe_now: ["Do prep, admin, drafting, review, or asynchronous work."],
            defer_until: null,
            needs_user_confirmation: [],
          },
          write_back_plan: {
            recommendations: [{ tool: "finish_work_session" }],
            forbidden_content: ["secrets or credentials"],
          },
        },
      };
    }

    async listClientEnvironments() {
      return { environments: [{ slug: "codex", displayName: "Codex" }] };
    }

    async upsertClientEnvironment() {
      return { environment: { slug: "codex", displayName: "Codex" } };
    }

    async listToolCapabilities() {
      return { capabilities: [{ slug: "contextos_memory", displayName: "ContextOS Memory" }] };
    }

    async upsertToolCapability() {
      return { capability: { slug: "contextos_memory", displayName: "ContextOS Memory" } };
    }

    async listEnvironmentCapabilities() {
      return { capabilities: [] };
    }

    async upsertEnvironmentCapability() {
      return { environment_capability: { environmentSlug: "codex", capabilitySlug: "contextos_memory" } };
    }

    planEnvironmentToolUse() {
      return {
        environment: { slug: "codex", display_name: "Codex" },
        available_capabilities: [{ capability: "contextos_memory" }],
        unavailable_required_capabilities: [],
      };
    }

    planLightLaneLiveStateRefresh() {
      return {
        eligible: true,
        mode: "read_only_live_refresh",
        required_source_kinds: ["zoho_crm", "zoho_mail"],
      };
    }

    planZohoExternalWrite() {
      return {
        contextos_can_execute: false,
        delegate_to: "write_capable_zoho_mcp",
        confirmation_required: true,
      };
    }

    async analyzeMemoryMigration() {
      return { dry_run: true, duplicate_projects: [], safety: { deletes_workdrive_files: false } };
    }

    async runMemoryMigration() {
      return { dry_run: true, applied: false };
    }

    async getMigrationAudit() {
      return { events: [] };
    }

    async analyzeWorkdriveCanonicalization() {
      return {
        dry_run: true,
        manifest: {
          migration_slug: "workdrive-visible-canonicalization",
          canonical_project: "light-lane",
          duplicate_project: "lightlane",
        },
      };
    }

    async runWorkdriveCanonicalization() {
      return { dry_run: true, applied: false, manifest_id: "manifest-1" };
    }

    async getWorkdriveCanonicalizationManifest() {
      return { manifests: [] };
    }

    getOperationalContext() {
      return {
        time_context: {
          now_utc: "2026-05-01T22:30:00.000Z",
          timezone: "Pacific/Auckland",
          timezone_source: "input",
          local_date: "2026-05-02",
          local_time: "10:30:00",
          weekday: "Saturday",
          weekday_index: 6,
          utc_offset_minutes: 720,
          is_weekend: true,
          is_business_day: false,
          is_business_hours: false,
          business_hours: {
            start: "09:00",
            end: "17:00",
            business_days: [1, 2, 3, 4, 5],
          },
          holiday_context: {
            status: "not_configured",
            is_public_holiday: null,
            source: null,
            note: "Public holiday calendars are not configured in Phase 1.",
          },
        },
      };
    }

    planAssistantAction() {
      return {
        operational_context: this.getOperationalContext().time_context,
        request_classification: {
          primary_category: "planning_scheduling",
          categories: {
            planning_scheduling: true,
            code_repo: false,
            customer_sales_business: true,
            memory_context: false,
            external_source_dependent: false,
            destructive_write_action: false,
          },
          matched_rules: ["planning/scheduling terms"],
          risk_level: "medium",
        },
        actionability: {
          label: "prep_or_async_only",
          reasons: ["Saturday is not a configured business day."],
          recommended_now: ["Do prep, admin, drafting, review, or asynchronous work."],
          guardrails: ["Do not recommend business calls today."],
        },
        tool_plan: {
          required_tools: [
            {
              tool: "get_operational_context",
              reason: "Validate actual date and weekday.",
              timing: "before_answer",
            },
          ],
          optional_tools: [],
          forbidden_without_confirmation: [],
          write_back_recommendations: [],
          connector_policy_defaults: {},
        },
      };
    }

    async resolveContext() {
      return {
        active_project: { slug: "memory-system-mcp" },
        candidates: [],
        project_switching: { selected: "memory-system-mcp" },
      };
    }

    async listInitiatives() {
      return { initiatives: [] };
    }

    async getInitiativeContext() {
      return { initiative: { slug: "assistant-context-os" }, projects: [] };
    }

    async upsertInitiative() {
      return { initiative: { slug: "assistant-context-os" }, projects: [] };
    }

    async upsertVision() {
      return { strategy_node: { slug: "improve-assistant-context", type: "vision" } };
    }

    async listVisions() {
      return { strategy_nodes: [] };
    }

    async getStrategyContext() {
      return {
        strategy_context: {
          project: "memory-system-mcp",
          visions: [],
          pillars: [],
          outcomes: [],
          initiatives: [],
          milestones: [],
          assets: [],
          branch_project: null,
          warnings: ["no_active_vision"],
        },
      };
    }

    async upsertAsset() {
      return { asset: { id: "asset-1", slug: "repo-guide" } };
    }

    async listAssets() {
      return { assets: [] };
    }

    async linkAsset() {
      return { links: [] };
    }

    async upsertMilestone() {
      return { milestone: { id: "milestone-1", slug: "prototype-ready" } };
    }

    async createBranchProject() {
      return { branch_project: { projectSlug: "research-branch" } };
    }

    async checkAlignment() {
      return {
        alignment_assessment: {
          alignmentLabel: "unknown_until_more_context",
          score: 0,
          confidence: "low",
        },
      };
    }

    async planRequest(input?: { responseMode?: "compact" | "expanded" }) {
      return {
        response_mode: input?.responseMode ?? "compact",
        strategy_context: { project: "memory-system-mcp", warnings: ["no_active_vision"] },
        alignment_assessment: { alignmentLabel: "unknown_until_more_context" },
        operating_brief: {
          required_live_checks: [],
          write_back_plan: {
            recommendations: [{ tool: "finish_work_session" }],
          },
        },
        request_plan: {
          objective: "Improve assistant planning.",
          tool_sequence: [],
        },
        recommended_next_steps: [],
      };
    }

    async linkMemory() {
      return { links: [] };
    }

    async saveSourceEvent() {
      return { saved: true, source_event: { title: "CRM update" } };
    }

    async extractDurableFacts() {
      return { facts: [], saved: [] };
    }

    async upsertEntityState() {
      return {
        entity: { id: "entity-1", name: "Acme Jet" },
        state: { id: "state-1", stateKey: "deal_stage", value: "proposal_sent" },
        aliases: [],
      };
    }

    async getEntityCurrentState() {
      return {
        entity: { id: "entity-1", name: "Acme Jet" },
        states: { deal_stage: { value: "proposal_sent" } },
      };
    }

    async resolveCurrentTruth() {
      return {
        entities: [],
        guardrails: { current_state_required: true },
        warnings: [],
        required_live_checks: [],
      };
    }

    async analyzeContextTruthMigration() {
      return {
        migration_slug: "context-truth-engine",
        dry_run: true,
        counts: {},
        safety: { deletes_workdrive_files: false, deletes_d1_rows: false },
      };
    }

    async runContextTruthMigration() {
      return { dry_run: true, applied: false, analysis: { counts: {} } };
    }

    async importAiBrainVault() {
      return { dry_run: true, applied: false, analysis: { counts: { files_seen: 0 } } };
    }

    async analyzeLightLaneMemoryRecovery() {
      return { migration_slug: "light-lane-memory-recovery", quality_gates: { ready_to_apply: false } };
    }

    async runLightLaneMemoryRecovery() {
      return { dry_run: true, applied: false, analysis: { migration_slug: "light-lane-memory-recovery" } };
    }

    async upsertTask() {
      return { task: { title: "Follow up" } };
    }

    async dailyBriefing() {
      return { due_or_upcoming_tasks: [], active_initiatives: [] };
    }

    async contextHealthCheck() {
      return { warnings: [] };
    }

    async writeSessionSummary() {
      return { path: "/memory/shared/sessions/test.md", workdrive_file_id: "wd-1", job_id: "job-1" };
    }

    async updateContextDocument() {
      return { path: "/memory/shared/context/current/vision.md", workdrive_file_id: "wd-1", job_id: "job-1" };
    }

    async archiveMemoryDocument() {
      return { path: "/memory/shared/context/current/vision.md", workdrive_file_id: "wd-1", job_id: "job-1", archived: true };
    }

    async recordDecision() {
      return { path: "/memory/shared/decisions/decision.md", workdrive_file_id: "wd-2", job_id: "job-2" };
    }

    async reindexDocument() {
      return { job_id: "job-3", path: "/memory/shared/context/current/vision.md" };
    }

    async reindexAll() {
      return { job_id: "job-4" };
    }
  }

  return {
    MemoryService: MockMemoryService,
  };
});

vi.mock("~/service/PlanningService", () => {
  class MockPlanningService {
    async prepareAssistantSession(input?: { responseMode?: "compact" | "expanded" }) {
      return {
        response_mode: input?.responseMode ?? "compact",
        active_project: { slug: "memory-system-mcp", displayName: "Memory System MCP" },
        context_resolution: { project_switching: { selected: "memory-system-mcp", reason: "Exact match." } },
        grouped_memory: { grouped: { current_context: [] } },
        recommended_live_mcp_checks: ["Check live github for fresh context before writing durable summaries."],
        write_back_policy: { mode: "selective_durable_facts" },
        strategy_context: { project: "memory-system-mcp", visions: [], warnings: ["no_active_vision"] },
        operational_context: { timezone: "Pacific/Auckland", weekday: "Saturday", is_weekend: true },
        request_classification: { primary_category: "planning_scheduling" },
        actionability: { label: "prep_or_async_only" },
        tool_plan: { required_tools: [] },
        operating_brief: {
          context_resolution: { project_switching: { selected: "memory-system-mcp" } },
          time_actionability: { weekday: "Saturday", actionability_label: "prep_or_async_only" },
          strategic_alignment: { project: "memory-system-mcp", assessment: null },
          relevant_assets: [],
          current_tasks_milestones: { open_tasks: [], milestones: [] },
          source_freshness: { retrieval_mode: "no_hits", warnings: [] },
          required_live_checks: [],
          risks: [],
          recommended_next_actions: {
            before_answer: [], before_action: [],
            safe_now: ["Do prep, admin, drafting, review, or asynchronous work."],
            defer_until: null, needs_user_confirmation: [],
          },
          write_back_plan: {
            recommendations: [{ tool: "finish_work_session" }],
            forbidden_content: ["secrets or credentials"],
          },
        },
      };
    }

    async prepareWorkSession() { return { project: "memory-system-mcp", context: [] }; }
    async resolveContext() { return { active_project: { slug: "memory-system-mcp" }, candidates: [], project_switching: { selected: "memory-system-mcp" } }; }
    async planRequest(input?: { responseMode?: "compact" | "expanded" }) {
      return {
        response_mode: input?.responseMode ?? "compact",
        strategy_context: { project: "memory-system-mcp", warnings: ["no_active_vision"] },
        alignment_assessment: { alignmentLabel: "unknown_until_more_context" },
        operating_brief: { required_live_checks: [], write_back_plan: { recommendations: [{ tool: "finish_work_session" }] } },
        request_plan: { objective: "Improve assistant planning.", tool_sequence: [] },
        recommended_next_steps: [],
      };
    }
    async dailyBriefing() { return { due_or_upcoming_tasks: [], active_initiatives: [] }; }
    async contextHealthCheck() { return { warnings: [] }; }
    async checkAlignment() { return { alignment_assessment: { alignmentLabel: "unknown_until_more_context", score: 0, confidence: "low" } }; }
  }
  return { PlanningService: MockPlanningService };
});

vi.mock("~/service/RetrievalService", () => {
  class MockRetrievalService {
    async searchMemory() {
      return {
        results: [{ id: "doc-1", title: "Vision", path: "/memory/shared/context/current/vision.md", url: "https://memory.example.com/doc-1", text: "Canonical truth", score: 0.91, memory_type: "current_context", status: "active", heading_path: "Vision" }],
        documents: [],
      };
    }
    async retrievalDiagnostics() { return { query: "", namespaces: [], hits: 0 }; }
    async assessContextCompletenessSafely() { return { completeness: "partial", warnings: [] }; }
  }
  return { RetrievalService: MockRetrievalService };
});

vi.mock("~/service/DocumentService", () => {
  class MockDocumentService {
    async getDocument() {
      return {
        document: { id: "doc-1", title: "Vision", path: "/memory/shared/context/current/vision.md", permalink: "https://memory.example.com/doc-1", project: "shared", memoryType: "current_context", status: "active", revision: 2 },
        snapshot: { rawMarkdown: "# Vision\n\nCanonical truth" },
        authoritative_markdown: "# Vision\n\nCanonical truth",
      };
    }
    async getCurrentContext() { return { items: [] }; }
    async writeSessionSummary() { return { path: "/memory/shared/sessions/test.md", workdrive_file_id: "wd-1", job_id: "job-1" }; }
    async saveSnippet() { return { path: "/memory/shared/snippets/test.md", workdrive_file_id: "wd-1", job_id: "job-1" }; }
    async finishWorkSession() { return { session_summary: { path: "/memory/shared/sessions/test.md" } }; }
    async updateContextDocument() { return { path: "/memory/shared/context/current/vision.md", workdrive_file_id: "wd-1", job_id: "job-1" }; }
    async archiveMemoryDocument() { return { path: "/memory/shared/context/current/vision.md", workdrive_file_id: "wd-1", job_id: "job-1", archived: true }; }
    async recordDecision() { return { path: "/memory/shared/decisions/decision.md", workdrive_file_id: "wd-2", job_id: "job-2" }; }
    async reindexDocument() { return { job_id: "job-3", path: "/memory/shared/context/current/vision.md" }; }
    async reindexAll() { return { job_id: "job-4" }; }
    async reconcileWorkDrive() { return { scanned: 0, enqueued: 0 }; }
    async adminStatus() { return { projects: 0, queued_jobs: 0, failed_jobs: 0 }; }
    async backfillMemoryLayers() { return { dry_run: true, updated: 0 }; }
    async setSituationDocument() { return { path: "/memory/shared/context/current/situation.md", workdrive_file_id: "wd-1", job_id: "job-1" }; }
    async bootstrapProjectContext() { return { project: "test", created: [] }; }
    async saveGithubFileMemory() { return { path: "/memory/shared/snippets/github.md", workdrive_file_id: "wd-1", job_id: "job-1" }; }
  }
  return { DocumentService: MockDocumentService };
});

vi.mock("~/service/InitiativeService", () => {
  class MockInitiativeService {
    async listInitiatives() { return { initiatives: [] }; }
    async getInitiativeContext() { return { initiative: { slug: "assistant-context-os" }, projects: [] }; }
    async upsertInitiative() { return { initiative: { slug: "assistant-context-os" } }; }
    async upsertVision() { return { strategy_node: { slug: "improve-assistant-context", type: "vision" } }; }
    async listVisions() { return { strategy_nodes: [] }; }
    async getStrategyContext() {
      return { strategy_context: { project: "memory-system-mcp", visions: [], pillars: [], outcomes: [], initiatives: [], milestones: [], assets: [], branch_project: null, warnings: ["no_active_vision"] } };
    }
    async upsertAsset() { return { asset: { id: "asset-1", slug: "repo-guide" } }; }
    async listAssets() { return { assets: [] }; }
    async linkAsset() { return { links: [] }; }
    async upsertMilestone() { return { milestone: { id: "milestone-1", slug: "prototype-ready" } }; }
    async createBranchProject() { return { branch_project: { projectSlug: "research-branch" } }; }
    async checkAlignment() { return { alignment_assessment: { alignmentLabel: "unknown_until_more_context", score: 0, confidence: "low" } }; }
  }
  return { InitiativeService: MockInitiativeService };
});

vi.mock("~/service/EntityService", () => {
  class MockEntityService {
    async upsertEntityState() { return { entity: { slug: "fivestar-print" }, entity_state: { stateKey: "deal_stage" } }; }
    async getEntityCurrentState() { return { entity: null, states: [] }; }
    async resolveCurrentTruth() { return { entities: [], guardrails: { current_state_required: true }, warnings: [], required_live_checks: [] }; }
    async setEntityActionability() { return { entity_state: { actionability: "active" } }; }
    async linkMemory() { return { links: [] }; }
    async saveSourceEvent() { return { saved: true, source_event: { title: "CRM update" } }; }
    async extractDurableFacts() { return { facts: [] }; }
    async upsertTask() { return { task: { title: "Follow up" } }; }
  }
  return { EntityService: MockEntityService };
});

vi.mock("~/service/ProjectService", () => {
  class MockProjectService {
    async ensureProject(input: { project?: string }) { return { project: { slug: input.project ?? "shared" } }; }
    async listProjects() { return { projects: [] }; }
    async getProject(input: { project: string }) { return { project: { slug: input.project } }; }
    async updateProjectProfile(input: { project: string }) { return { project: { slug: input.project } }; }
    async projectStatus(input: { project: string }) { return { project: input.project, folders: {}, failed_jobs: 0 }; }

    getOperationalContext() {
      return {
        time_context: {
          now_utc: "2026-05-01T22:30:00.000Z", timezone: "Pacific/Auckland", timezone_source: "input",
          local_date: "2026-05-02", local_time: "10:30:00", weekday: "Saturday", weekday_index: 6,
          utc_offset_minutes: 720, is_weekend: true, is_business_day: false, is_business_hours: false,
          business_hours: { start: "09:00", end: "17:00", business_days: [1, 2, 3, 4, 5] },
          holiday_context: { status: "not_configured", is_public_holiday: null, source: null, note: "Public holiday calendars are not configured in Phase 1." },
        },
      };
    }

    planAssistantAction() {
      return {
        operational_context: this.getOperationalContext().time_context,
        request_classification: {
          primary_category: "planning_scheduling",
          categories: { planning_scheduling: true, code_repo: false, customer_sales_business: true, memory_context: false, external_source_dependent: false, destructive_write_action: false },
          matched_rules: ["planning/scheduling terms"],
          risk_level: "medium",
        },
        actionability: { label: "prep_or_async_only", reasons: ["Saturday is not a configured business day."], recommended_now: ["Do prep, admin, drafting, review, or asynchronous work."], guardrails: ["Do not recommend business calls today."] },
        tool_plan: { required_tools: [{ tool: "get_operational_context", reason: "Validate actual date and weekday.", timing: "before_answer" }], optional_tools: [], forbidden_without_confirmation: [], write_back_recommendations: [], connector_policy_defaults: {} },
      };
    }

    planEnvironmentToolUse() { return { environment: { slug: "codex", display_name: "Codex" }, available_capabilities: [{ capability: "contextos_memory" }], unavailable_required_capabilities: [] }; }
    planLightLaneLiveStateRefresh() { return { eligible: true, mode: "read_only_live_refresh", required_source_kinds: ["zoho_crm", "zoho_mail"] }; }
    planZohoExternalWrite() { return { contextos_can_execute: false, delegate_to: "write_capable_zoho_mcp", confirmation_required: true }; }

    async listClientEnvironments() { return { environments: [{ slug: "codex", displayName: "Codex" }] }; }
    async upsertClientEnvironment(input: { slug: string; displayName: string }) { return { environment: { slug: input.slug, displayName: input.displayName } }; }
    async listToolCapabilities() { return { capabilities: [{ slug: "contextos_memory", displayName: "ContextOS Memory" }] }; }
    async upsertToolCapability(input: { slug: string; displayName: string }) { return { capability: { slug: input.slug, displayName: input.displayName } }; }
    async listEnvironmentCapabilities() { return { capabilities: [] }; }
    async upsertEnvironmentCapability(input: { environmentSlug: string; capabilitySlug: string }) { return { environment_capability: { environmentSlug: input.environmentSlug, capabilitySlug: input.capabilitySlug } }; }
    async listGithubRepos() { return { repos: [] }; }
    async associateGithubRepo(input: { project: string; repo: string }) { return { project: input.project, repo: input.repo }; }
    async listProjectGithubRepos() { return { repos: [] }; }
    async inspectGithubRepoStructure() { return { tree: [] }; }
    async indexGithubRepoOverview() { return { files_indexed: 0 }; }
    async getGithubFile() { return { content: "", path: "", repo: "" }; }
    async searchGithubCode() { return { results: [] }; }
  }
  return { ProjectService: MockProjectService };
});

describe("MCP contract", () => {
  let env: Env;
  let principal: MemoryPrincipal;

  beforeEach(() => {
    env = {
      APP_BASE_URL: "https://memory.example.com",
      MCP_ROUTE: "/mcp",
      GITHUB_OAUTH_AUTHORIZE_URL: "https://github.com/login/oauth/authorize",
      GITHUB_OAUTH_TOKEN_URL: "https://github.com/login/oauth/access_token",
      GITHUB_OAUTH_USER_URL: "https://api.github.com/user",
      GITHUB_OAUTH_EMAILS_URL: "https://api.github.com/user/emails",
      ZOHO_WORKDRIVE_API_BASE_URL: "https://workdrive.zoho.com/api/v1",
      ZOHO_ACCOUNTS_BASE_URL: "https://accounts.zoho.com",
      WORKERS_AI_EMBEDDING_MODEL: "@cf/baai/bge-base-en-v1.5",
      DB: {} as D1Database,
    } as Env;
    principal = {
      authType: "bearer",
      userId: "test",
      login: "test",
    };
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("registers the expected tool surface with annotations", async () => {
    const client = await connectTestClient(env, principal);
    const listed = await client.listTools();

    expect(listed.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        "search",
        "fetch",
        "prepare_work_session",
        "finish_work_session",
        "bootstrap_project_context",
        "ensure_project",
        "list_projects",
        "get_project",
        "update_project_profile",
        "project_status",
        "prepare_assistant_session",
        "get_operational_context",
        "plan_assistant_action",
        "list_client_environments",
        "upsert_client_environment",
        "list_tool_capabilities",
        "upsert_tool_capability",
        "list_environment_capabilities",
        "upsert_environment_capability",
        "plan_environment_tool_use",
        "plan_light_lane_live_state_refresh",
        "plan_zoho_external_write",
        "resolve_context",
        "search_memory",
        "get_document",
        "get_current_context",
        "write_session_summary",
        "save_snippet",
        "update_context_document",
        "archive_memory_document",
        "record_decision",
        "github_find_repos",
        "github_project_repos",
        "github_associate_repo",
        "github_inspect_repo_structure",
        "github_index_repo_overview",
        "list_initiatives",
        "get_initiative_context",
        "upsert_initiative",
        "upsert_vision",
        "list_visions",
        "get_strategy_context",
        "upsert_asset",
        "list_assets",
        "link_asset",
        "upsert_milestone",
        "create_branch_project",
        "check_alignment",
        "plan_request",
        "link_memory",
        "save_source_event",
        "extract_durable_facts",
        "upsert_entity_state",
        "get_entity_current_state",
        "resolve_current_truth",
        "upsert_task",
        "daily_briefing",
        "context_health_check",
        "reindex_document",
        "reindex_all",
        "admin_status",
        "admin_reconcile_workdrive",
        "admin_reindex_document",
        "admin_reindex_all",
        "retrieval_diagnostics",
      ]),
    );
    expect(
      listed.tools.find((tool) => tool.name === "search")?.annotations?.readOnlyHint,
    ).toBe(true);
    expect(
      listed.tools.find((tool) => tool.name === "plan_light_lane_live_state_refresh")?.annotations?.readOnlyHint,
    ).toBe(true);
    expect(
      listed.tools.find((tool) => tool.name === "plan_zoho_external_write")?.annotations?.readOnlyHint,
    ).toBe(true);
    expect(
      listed.tools.find((tool) => tool.name === "write_session_summary")?.annotations?.destructiveHint,
    ).toBe(true);
  });

  it("returns Assistant Context OS session payloads", async () => {
    const client = await connectTestClient(env, principal);

    const response = await client.callTool({
      name: "prepare_assistant_session",
      arguments: {
        project_or_topic: "memory-system-mcp",
        user_intent: "plan context orchestration",
        active_sources: ["github"],
      },
    });
    const payload = JSON.parse(readFirstTextContent(response));

    expect(payload).toMatchObject({
      active_project: {
        slug: "memory-system-mcp",
      },
      operational_context: {
        weekday: "Saturday",
      },
      actionability: {
        label: "prep_or_async_only",
      },
      write_back_policy: {
        mode: "selective_durable_facts",
      },
      operating_brief: {
        time_actionability: {
          actionability_label: "prep_or_async_only",
        },
        write_back_plan: {
          recommendations: expect.arrayContaining([
            expect.objectContaining({ tool: "finish_work_session" }),
          ]),
        },
      },
    });
    expect(payload.recommended_live_mcp_checks[0]).toContain("github");
  });

  it("allows clients to explicitly opt into expanded assistant session material", async () => {
    const client = await connectTestClient(env, principal);

    const response = await client.callTool({
      name: "prepare_assistant_session",
      arguments: {
        project_or_topic: "memory-system-mcp",
        user_intent: "inspect full context",
        response_mode: "expanded",
      },
    });
    const payload = JSON.parse(readFirstTextContent(response));

    expect(payload.response_mode).toBe("expanded");
  });

  it("allows clients to explicitly opt into expanded request planning material", async () => {
    const client = await connectTestClient(env, principal);

    const response = await client.callTool({
      name: "plan_request",
      arguments: {
        project_or_topic: "memory-system-mcp",
        user_intent: "inspect detailed planning context",
        response_mode: "expanded",
      },
    });
    const payload = JSON.parse(readFirstTextContent(response));

    expect(payload.response_mode).toBe("expanded");
  });

  it("serializes JSON tool results without whitespace-only context expansion", async () => {
    const client = await connectTestClient(env, principal);

    const response = await client.callTool({
      name: "prepare_assistant_session",
      arguments: {
        project_or_topic: "memory-system-mcp",
        user_intent: "compact output",
      },
    });
    const text = readFirstTextContent(response);

    expect(text).not.toMatch(/\n\s+"/);
    expect(JSON.parse(text).response_mode).toBe("compact");
  });

  it("returns reliability core MCP payloads", async () => {
    const client = await connectTestClient(env, principal);

    const operationalResponse = await client.callTool({
      name: "get_operational_context",
      arguments: {
        timezone: "Pacific/Auckland",
        now: "2026-05-01T22:30:00.000Z",
      },
    });
    const operationalPayload = JSON.parse(readFirstTextContent(operationalResponse));
    expect(operationalPayload.time_context).toMatchObject({
      timezone: "Pacific/Auckland",
      weekday: "Saturday",
      is_weekend: true,
    });

    const planResponse = await client.callTool({
      name: "plan_assistant_action",
      arguments: {
        user_intent: "Plan customer calls today.",
        timezone: "Pacific/Auckland",
        now: "2026-05-01T22:30:00.000Z",
      },
    });
    const planPayload = JSON.parse(readFirstTextContent(planResponse));
    expect(planPayload).toMatchObject({
      request_classification: {
        primary_category: "planning_scheduling",
      },
      actionability: {
        label: "prep_or_async_only",
      },
    });
  });

  it("registers Phase 2 strategic world model tools", async () => {
    const client = await connectTestClient(env, principal);

    const strategyResponse = await client.callTool({
      name: "get_strategy_context",
      arguments: {
        project_or_topic: "memory-system-mcp",
        user_intent: "Improve assistant planning.",
      },
    });
    const strategyPayload = JSON.parse(readFirstTextContent(strategyResponse));
    expect(strategyPayload.strategy_context).toMatchObject({
      project: "memory-system-mcp",
      warnings: ["no_active_vision"],
    });

    const alignmentResponse = await client.callTool({
      name: "check_alignment",
      arguments: {
        project_or_topic: "memory-system-mcp",
        user_intent: "Explore a new idea.",
      },
    });
    const alignmentPayload = JSON.parse(readFirstTextContent(alignmentResponse));
    expect(alignmentPayload.alignment_assessment).toMatchObject({
      alignmentLabel: "unknown_until_more_context",
      score: 0,
    });

    const invalidBranchResponse = await client.callTool({
      name: "create_branch_project",
      arguments: {
        project: "research-branch",
        parent_initiative_id: "initiative-1",
        branch_reason: "Explore a small experiment",
        hypothesis: "A prototype will clarify value",
        timebox_starts_at: "2026-05-01",
        timebox_ends_at: "2026-05-15",
        success_metric: "Prototype reviewed",
        risk_to_parent: "May consume focus",
        risk_level: "medium",
        merge_back_condition: "Prototype proves useful",
      },
    });
    expect(invalidBranchResponse.isError).toBe(true);
    expect(readFirstTextContent(invalidBranchResponse)).toContain("kill_condition");
  });

  it("returns OpenAI-compatible search and fetch payload shapes", async () => {
    const client = await connectTestClient(env, principal);

    const searchResponse = await client.callTool({
      name: "search",
      arguments: { query: "vision" },
    });
    const searchPayload = JSON.parse(readFirstTextContent(searchResponse));
    expect(searchPayload.results[0]).toMatchObject({
      id: "doc-1",
      title: "Vision",
      text: "Canonical truth",
      url: "https://memory.example.com/doc-1",
    });

    const fetchResponse = await client.callTool({
      name: "fetch",
      arguments: { id: "doc-1" },
    });
    const fetchPayload = JSON.parse(readFirstTextContent(fetchResponse));
    expect(fetchPayload).toMatchObject({
      id: "doc-1",
      title: "Vision",
      text: "# Vision\n\nCanonical truth",
      url: "https://memory.example.com/doc-1",
    });
  });
});

async function connectTestClient(env: Env, principal: MemoryPrincipal) {
  const { createMemoryMcpServer } = await import("~/mcp/tools");
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  const server = createMemoryMcpServer(env, principal);
  await server.connect(serverTransport);

  const client = new Client(
    {
      name: "vitest-client",
      version: "1.0.0",
    },
    {
      capabilities: {},
    },
  );
  await client.connect(clientTransport);
  return client;
}

function readFirstTextContent(result: unknown) {
  const content = (
    result &&
    typeof result === "object" &&
    "content" in result &&
    Array.isArray(result.content)
      ? result.content
      : []
  ) as Array<{ type: string; text?: string }>;
  const textBlock = content.find((item) => item.type === "text");
  if (!textBlock?.text) {
    throw new Error(`Expected a text content block, got ${JSON.stringify(result)}`);
  }
  return textBlock.text;
}
