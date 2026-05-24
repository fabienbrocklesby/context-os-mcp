CREATE TABLE IF NOT EXISTS entity_aliases (
  id TEXT PRIMARY KEY,
  project TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  alias TEXT NOT NULL,
  normalized_alias TEXT NOT NULL,
  source TEXT,
  confidence REAL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project, normalized_alias, entity_id),
  FOREIGN KEY (entity_id) REFERENCES memory_entities(id)
);

CREATE TABLE IF NOT EXISTS entity_states (
  id TEXT PRIMARY KEY,
  project TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  state_key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  confidence REAL,
  source TEXT,
  source_id TEXT,
  source_event_id TEXT,
  valid_from TEXT,
  valid_until TEXT,
  superseded_by_state_id TEXT,
  observed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (entity_id) REFERENCES memory_entities(id),
  FOREIGN KEY (source_event_id) REFERENCES source_events(id)
);

CREATE TABLE IF NOT EXISTS context_truth_migration_manifests (
  id TEXT PRIMARY KEY,
  migration_slug TEXT NOT NULL,
  project TEXT NOT NULL,
  dry_run INTEGER NOT NULL DEFAULT 1,
  apply_requested INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  summary TEXT NOT NULL,
  manifest_json TEXT NOT NULL,
  counts_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_entity_aliases_project_alias
  ON entity_aliases(project, normalized_alias);

CREATE INDEX IF NOT EXISTS idx_entity_aliases_entity
  ON entity_aliases(entity_id);

CREATE INDEX IF NOT EXISTS idx_entity_states_entity_status
  ON entity_states(project, entity_id, status, state_key, updated_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_entity_states_active_unique
  ON entity_states(project, entity_id, state_key)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_context_truth_migration_manifests_project
  ON context_truth_migration_manifests(project, migration_slug, created_at);
