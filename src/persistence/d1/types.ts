// src/persistence/d1/types.ts
// D1 row types — one type per database table. No logic.

import type {
  AlignmentAssessment,
  BranchProject,
  ContextTask,
  DurableFact,
  EntityState,
  EnvironmentCapability,
  MemoryEntity,
  MemoryInitiative,
  MemoryStatus,
  MemoryType,
  SourceEvent,
  StrategyAsset,
  StrategyMilestone,
  StrategyNode,
  ToolCapability,
} from "~/domain/memory";

export type DocumentRow = {
  id: string;
  workdrive_file_id: string;
  path: string;
  title: string;
  project: string;
  namespace: string;
  parent_folder_id: string;
  file_name: string;
  permalink: string | null;
  download_url: string | null;
  memory_type: MemoryType;
  status: MemoryStatus;
  canonical: number;
  active: number;
  revision: number;
  current_snapshot_id: string | null;
  last_remote_modified_at: number | null;
  source: string | null;
  source_url: string | null;
  repo: string | null;
  repo_path: string | null;
  tags_json: string | null;
  confidence: number | null;
  usefulness: number | null;
  memory_layer: string | null;
  superseded_by_document_id: string | null;
};

export type SnapshotRow = {
  id: string;
  document_id: string;
  revision: number;
  raw_markdown: string;
  body_markdown: string;
  frontmatter_json: string;
};

export type ChunkLookupRow = {
  vector_id: string;
  content: string;
};

export type ReindexJobRow = {
  id: string;
  status: string;
  path: string | null;
  workdrive_file_id: string | null;
  document_id: string | null;
};

export type ProjectRow = {
  slug: string;
  display_name: string;
  description: string | null;
  status: "active" | "paused" | "archived";
  profile_json: string;
  owner_login: string | null;
  shared: number;
  workdrive_root_folder_id: string | null;
  context_current_folder_id: string | null;
  context_history_folder_id: string | null;
  decisions_folder_id: string | null;
  sessions_folder_id: string | null;
  snippets_folder_id: string | null;
  repo_index_folder_id: string | null;
  last_health_json: string | null;
  canonical_project?: string | null;
  merged_into_project?: string | null;
  noncanonical_reason?: string | null;
  canonical_status?: string | null;
  canonical_updated_at?: string | null;
  created_at: string;
  updated_at: string;
};

export type ClientEnvironmentRow = {
  id: string;
  slug: string;
  display_name: string;
  description: string | null;
  default_tool_style: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type ToolCapabilityRow = {
  id: string;
  slug: string;
  display_name: string;
  source_kind: string;
  action_kind: string;
  source_of_truth: number;
  volatile: number;
  sensitivity: ToolCapability["sensitivity"];
  requires_confirmation: number;
  destructive: number;
  save_policy: ToolCapability["savePolicy"];
  instructions_markdown: string | null;
  input_hints_json: string | null;
  output_hints_json: string | null;
  created_at: string;
  updated_at: string;
};

export type EnvironmentCapabilityRow = {
  id: string;
  environment_slug: string;
  capability_slug: string;
  availability: EnvironmentCapability["availability"];
  invocation_style: EnvironmentCapability["invocationStyle"];
  tool_name: string | null;
  usage_instructions_markdown: string | null;
  limitations_markdown: string | null;
  priority: number;
  created_at: string;
  updated_at: string;
};

export type MigrationAuditEventRow = {
  id: string;
  migration_slug: string;
  phase: string;
  dry_run: number;
  status: string;
  summary: string;
  counts_json: string | null;
  created_at: string;
};

export type WorkdriveCanonicalizationManifestRow = {
  id: string;
  migration_slug: string;
  canonical_project: string;
  duplicate_project: string;
  dry_run: number;
  apply_requested: number;
  status: string;
  summary: string;
  manifest_json: string;
  counts_json: string | null;
  created_at: string;
};

export type ContextTruthMigrationManifestRow = {
  id: string;
  migration_slug: string;
  project: string;
  dry_run: number;
  apply_requested: number;
  status: string;
  summary: string;
  manifest_json: string;
  counts_json: string | null;
  created_at: string;
};

export type ProjectGithubRepoRow = {
  id: string;
  project_slug: string;
  repo_full_name: string;
  default_branch: string | null;
  visibility: string | null;
  html_url: string | null;
  description: string | null;
  associated_by: string | null;
  associated_at: string;
  last_indexed_at: string | null;
  status: string;
};

export type FolderCheckRow = {
  folder_path: string;
  folder_id: string | null;
  status: string;
  checked_at: string;
  error: string | null;
};

export type CountRow = {
  count: number;
};

export type InitiativeRow = {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  status: MemoryInitiative["status"];
  owner: string | null;
  horizon: string | null;
  priority: MemoryInitiative["priority"];
  starts_at: string | null;
  due_at: string | null;
  tags_json: string | null;
  metadata_json: string | null;
  created_at: string;
  updated_at: string;
};

export type InitiativeProjectRow = {
  initiative_id: string;
  project_slug: string;
  role: string | null;
  status: string;
  created_at: string;
};

export type EntityRow = {
  id: string;
  project: string;
  type: MemoryEntity["type"];
  slug: string;
  name: string;
  summary: string | null;
  source: string | null;
  source_id: string | null;
  confidence: number | null;
  metadata_json: string | null;
  created_at: string;
  updated_at: string;
};

export type EntityAliasRow = {
  id: string;
  project: string;
  entity_id: string;
  alias: string;
  normalized_alias: string;
  source: string | null;
  confidence: number | null;
  created_at: string;
  updated_at: string;
};

export type EntityStateRow = {
  id: string;
  project: string;
  entity_id: string;
  state_key: string;
  value_json: string;
  status: EntityState["status"];
  confidence: number | null;
  source: string | null;
  source_id: string | null;
  source_event_id: string | null;
  valid_from: string | null;
  valid_until: string | null;
  superseded_by_state_id: string | null;
  observed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type FactRow = {
  id: string;
  project: string;
  title: string;
  body: string;
  fact_key: string | null;
  status: DurableFact["status"];
  source: string | null;
  source_url: string | null;
  confidence: number | null;
  initiative_id: string | null;
  entity_id: string | null;
  document_id: string | null;
  metadata_json: string | null;
  created_at: string;
  updated_at: string;
};

export type TaskRow = {
  id: string;
  project: string;
  title: string;
  description: string | null;
  status: ContextTask["status"];
  priority: ContextTask["priority"];
  due_at: string | null;
  owner: string | null;
  initiative_id: string | null;
  entity_id: string | null;
  source: string | null;
  source_url: string | null;
  reminder_at: string | null;
  metadata_json: string | null;
  created_at: string;
  updated_at: string;
};

export type SourceEventRow = {
  id: string;
  project: string;
  source: string;
  source_id: string | null;
  event_type: string;
  occurred_at: string | null;
  title: string;
  summary: string;
  sensitivity: SourceEvent["sensitivity"];
  save_policy: SourceEvent["savePolicy"];
  initiative_id: string | null;
  entity_id: string | null;
  external_url: string | null;
  metadata_json: string | null;
  created_at: string;
  updated_at: string;
};

export type MemoryLinkRow = {
  id: string;
  project: string;
  from_type: string;
  from_id: string;
  to_type: string;
  to_id: string;
  relation: string;
  weight: number;
  metadata_json: string | null;
  created_at: string;
};

export type StrategyNodeRow = {
  id: string;
  project: string;
  slug: string;
  type: StrategyNode["type"];
  title: string;
  summary: string | null;
  status: StrategyNode["status"];
  parent_id: string | null;
  horizon: string | null;
  priority: StrategyNode["priority"];
  metric_name: string | null;
  target_value: string | null;
  current_value: string | null;
  metric_unit: string | null;
  metric_direction: StrategyNode["metricDirection"];
  starts_at: string | null;
  due_at: string | null;
  review_cadence: string | null;
  tags_json: string | null;
  metadata_json: string | null;
  created_at: string;
  updated_at: string;
};

export type AssetRow = {
  id: string;
  project: string;
  slug: string;
  name: string;
  type: StrategyAsset["type"];
  summary: string | null;
  status: StrategyAsset["status"];
  owner: string | null;
  source: string | null;
  source_id: string | null;
  source_url: string | null;
  live_source_kind: StrategyAsset["liveSourceKind"];
  sensitivity: StrategyAsset["sensitivity"];
  how_to_use: string | null;
  limitations: string | null;
  tags_json: string | null;
  metadata_json: string | null;
  created_at: string;
  updated_at: string;
};

export type MilestoneRow = {
  id: string;
  project: string;
  slug: string;
  title: string;
  summary: string | null;
  status: StrategyMilestone["status"];
  initiative_id: string | null;
  project_slug: string | null;
  outcome_id: string | null;
  owner: string | null;
  due_at: string | null;
  completed_at: string | null;
  success_metric: string | null;
  evidence: string | null;
  tags_json: string | null;
  metadata_json: string | null;
  created_at: string;
  updated_at: string;
};

export type BranchProjectRow = {
  id: string;
  project_slug: string;
  parent_initiative_id: string;
  parent_project_slug: string | null;
  branch_reason: string;
  hypothesis: string;
  timebox_starts_at: string;
  timebox_ends_at: string;
  success_metric: string;
  risk_to_parent: string;
  risk_level: BranchProject["riskLevel"];
  merge_back_condition: string;
  kill_condition: string;
  status: BranchProject["status"];
  decision_log: string | null;
  metadata_json: string | null;
  created_at: string;
  updated_at: string;
};

export type AlignmentAssessmentRow = {
  id: string;
  project: string;
  subject_type: string;
  subject_id: string | null;
  user_intent: string;
  alignment_label: AlignmentAssessment["alignmentLabel"];
  score: AlignmentAssessment["score"];
  confidence: AlignmentAssessment["confidence"];
  rationale: string;
  evidence_json: string | null;
  risks_json: string | null;
  scope_guidance: string | null;
  missing_context_json: string | null;
  strategy_snapshot_json: string | null;
  created_at: string;
};
