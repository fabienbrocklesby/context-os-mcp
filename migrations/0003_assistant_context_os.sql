CREATE TABLE IF NOT EXISTS initiatives (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  summary TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  owner TEXT,
  horizon TEXT,
  priority TEXT NOT NULL DEFAULT 'normal',
  starts_at TEXT,
  due_at TEXT,
  tags_json TEXT NOT NULL DEFAULT '[]',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS initiative_projects (
  initiative_id TEXT NOT NULL,
  project_slug TEXT NOT NULL,
  role TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  PRIMARY KEY (initiative_id, project_slug),
  FOREIGN KEY (initiative_id) REFERENCES initiatives(id),
  FOREIGN KEY (project_slug) REFERENCES projects(slug)
);

CREATE TABLE IF NOT EXISTS memory_entities (
  id TEXT PRIMARY KEY,
  project TEXT NOT NULL,
  type TEXT NOT NULL,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  summary TEXT,
  source TEXT,
  source_id TEXT,
  confidence REAL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project, type, slug)
);

CREATE TABLE IF NOT EXISTS durable_facts (
  id TEXT PRIMARY KEY,
  project TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  fact_key TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  source TEXT,
  source_url TEXT,
  confidence REAL,
  initiative_id TEXT,
  entity_id TEXT,
  document_id TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project, fact_key)
);

CREATE TABLE IF NOT EXISTS context_tasks (
  id TEXT PRIMARY KEY,
  project TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  priority TEXT NOT NULL DEFAULT 'normal',
  due_at TEXT,
  owner TEXT,
  initiative_id TEXT,
  entity_id TEXT,
  source TEXT,
  source_url TEXT,
  reminder_at TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS source_events (
  id TEXT PRIMARY KEY,
  project TEXT NOT NULL,
  source TEXT NOT NULL,
  source_id TEXT,
  event_type TEXT NOT NULL,
  occurred_at TEXT,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  sensitivity TEXT NOT NULL DEFAULT 'internal',
  save_policy TEXT NOT NULL DEFAULT 'durable_summary',
  initiative_id TEXT,
  entity_id TEXT,
  external_url TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project, source, source_id)
);

CREATE TABLE IF NOT EXISTS memory_links (
  id TEXT PRIMARY KEY,
  project TEXT NOT NULL,
  from_type TEXT NOT NULL,
  from_id TEXT NOT NULL,
  to_type TEXT NOT NULL,
  to_id TEXT NOT NULL,
  relation TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 1,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  UNIQUE(project, from_type, from_id, to_type, to_id, relation)
);

CREATE TABLE IF NOT EXISTS connector_policies (
  connector TEXT PRIMARY KEY,
  save_policy TEXT NOT NULL,
  allowed_event_types_json TEXT NOT NULL DEFAULT '[]',
  sensitive_fields_json TEXT NOT NULL DEFAULT '[]',
  requires_approval_json TEXT NOT NULL DEFAULT '[]',
  live_only_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS project_relations (
  id TEXT PRIMARY KEY,
  source_project_slug TEXT NOT NULL,
  target_project_slug TEXT NOT NULL,
  relation TEXT NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(source_project_slug, target_project_slug, relation)
);

CREATE INDEX IF NOT EXISTS idx_initiatives_status ON initiatives(status, updated_at);
CREATE INDEX IF NOT EXISTS idx_initiative_projects_project ON initiative_projects(project_slug, status);
CREATE INDEX IF NOT EXISTS idx_memory_entities_project_type ON memory_entities(project, type, updated_at);
CREATE INDEX IF NOT EXISTS idx_durable_facts_project_status ON durable_facts(project, status, updated_at);
CREATE INDEX IF NOT EXISTS idx_context_tasks_project_status_due ON context_tasks(project, status, due_at);
CREATE INDEX IF NOT EXISTS idx_source_events_project_source ON source_events(project, source, occurred_at);
CREATE INDEX IF NOT EXISTS idx_memory_links_from ON memory_links(project, from_type, from_id);
CREATE INDEX IF NOT EXISTS idx_memory_links_to ON memory_links(project, to_type, to_id);
CREATE INDEX IF NOT EXISTS idx_project_relations_source ON project_relations(source_project_slug, status);

INSERT OR IGNORE INTO connector_policies (
  connector, save_policy, allowed_event_types_json, sensitive_fields_json,
  requires_approval_json, live_only_json, updated_at
) VALUES
  ('zoho_crm', 'durable_summary',
    '["deal_stage_change","account_update","contact_update","note_summary","task_update"]',
    '["raw_email","private_note","phone","personal_address"]',
    '["full_record_body","attachments","private_note"]',
    '["raw_record_payload"]',
    datetime('now')),
  ('zoho_mail', 'requires_approval',
    '["thread_summary","commitment","deadline","decision"]',
    '["raw_body","attachments","recipients"]',
    '["raw_body","attachments","full_thread"]',
    '["message_body","attachments"]',
    datetime('now')),
  ('zoho_calendar', 'durable_summary',
    '["meeting_summary","deadline","reminder","follow_up"]',
    '["attendee_email","private_location"]',
    '["full_attendee_list","private_description"]',
    '["raw_event_payload"]',
    datetime('now')),
  ('zoho_notes', 'durable_summary',
    '["note_summary","decision","idea","task"]',
    '["private_note"]',
    '["full_note_body"]',
    '["raw_note_payload"]',
    datetime('now')),
  ('github', 'durable_summary',
    '["repo_change","issue_update","pull_request_update","release"]',
    '["secret","token","private_key"]',
    '["private_repo_file_body","large_diff"]',
    '["raw_diff"]',
    datetime('now')),
  ('shopify', 'durable_summary',
    '["product_update","order_summary","customer_signal","inventory_change"]',
    '["customer_pii","payment","address"]',
    '["customer_pii","order_line_items_with_pii"]',
    '["raw_order_payload"]',
    datetime('now')),
  ('workdrive', 'durable_summary',
    '["document_summary","decision","plan","context_update"]',
    '["private_document_body"]',
    '["full_private_document","attachments"]',
    '["binary_file"]',
    datetime('now'));
