CREATE TABLE IF NOT EXISTS strategy_nodes (
  id TEXT PRIMARY KEY,
  project TEXT NOT NULL,
  slug TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  parent_id TEXT,
  horizon TEXT,
  priority TEXT NOT NULL DEFAULT 'normal',
  metric_name TEXT,
  target_value TEXT,
  current_value TEXT,
  metric_unit TEXT,
  metric_direction TEXT,
  starts_at TEXT,
  due_at TEXT,
  review_cadence TEXT,
  tags_json TEXT NOT NULL DEFAULT '[]',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project, slug),
  FOREIGN KEY (project) REFERENCES projects(slug),
  FOREIGN KEY (parent_id) REFERENCES strategy_nodes(id)
);

CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  project TEXT NOT NULL,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  summary TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  owner TEXT,
  source TEXT,
  source_id TEXT,
  source_url TEXT,
  live_source_kind TEXT,
  sensitivity TEXT NOT NULL DEFAULT 'internal',
  how_to_use TEXT,
  limitations TEXT,
  tags_json TEXT NOT NULL DEFAULT '[]',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project, slug),
  FOREIGN KEY (project) REFERENCES projects(slug)
);

CREATE TABLE IF NOT EXISTS milestones (
  id TEXT PRIMARY KEY,
  project TEXT NOT NULL,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  status TEXT NOT NULL DEFAULT 'planned',
  initiative_id TEXT,
  project_slug TEXT,
  outcome_id TEXT,
  owner TEXT,
  due_at TEXT,
  completed_at TEXT,
  success_metric TEXT,
  evidence TEXT,
  tags_json TEXT NOT NULL DEFAULT '[]',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project, slug),
  FOREIGN KEY (project) REFERENCES projects(slug),
  FOREIGN KEY (initiative_id) REFERENCES initiatives(id),
  FOREIGN KEY (project_slug) REFERENCES projects(slug),
  FOREIGN KEY (outcome_id) REFERENCES strategy_nodes(id)
);

CREATE TABLE IF NOT EXISTS branch_projects (
  id TEXT PRIMARY KEY,
  project_slug TEXT NOT NULL UNIQUE,
  parent_initiative_id TEXT NOT NULL,
  parent_project_slug TEXT,
  branch_reason TEXT NOT NULL,
  hypothesis TEXT NOT NULL,
  timebox_starts_at TEXT NOT NULL,
  timebox_ends_at TEXT NOT NULL,
  success_metric TEXT NOT NULL,
  risk_to_parent TEXT NOT NULL,
  risk_level TEXT NOT NULL DEFAULT 'medium',
  merge_back_condition TEXT NOT NULL,
  kill_condition TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  decision_log TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_slug) REFERENCES projects(slug),
  FOREIGN KEY (parent_initiative_id) REFERENCES initiatives(id),
  FOREIGN KEY (parent_project_slug) REFERENCES projects(slug)
);

CREATE TABLE IF NOT EXISTS alignment_assessments (
  id TEXT PRIMARY KEY,
  project TEXT NOT NULL,
  subject_type TEXT NOT NULL,
  subject_id TEXT,
  user_intent TEXT NOT NULL,
  alignment_label TEXT NOT NULL,
  score INTEGER NOT NULL,
  confidence TEXT NOT NULL,
  rationale TEXT NOT NULL,
  evidence_json TEXT NOT NULL DEFAULT '[]',
  risks_json TEXT NOT NULL DEFAULT '[]',
  scope_guidance TEXT,
  missing_context_json TEXT NOT NULL DEFAULT '[]',
  strategy_snapshot_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (project) REFERENCES projects(slug)
);

CREATE INDEX IF NOT EXISTS idx_strategy_nodes_project_type_status ON strategy_nodes(project, type, status, updated_at);
CREATE INDEX IF NOT EXISTS idx_strategy_nodes_parent ON strategy_nodes(parent_id, status);
CREATE INDEX IF NOT EXISTS idx_assets_project_type_status ON assets(project, type, status, updated_at);
CREATE INDEX IF NOT EXISTS idx_assets_source ON assets(source, source_id);
CREATE INDEX IF NOT EXISTS idx_milestones_project_status_due ON milestones(project, status, due_at);
CREATE INDEX IF NOT EXISTS idx_milestones_initiative ON milestones(initiative_id, status, due_at);
CREATE INDEX IF NOT EXISTS idx_branch_projects_parent ON branch_projects(parent_initiative_id, status);
CREATE INDEX IF NOT EXISTS idx_alignment_project_subject ON alignment_assessments(project, subject_type, subject_id, created_at);
