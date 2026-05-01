CREATE TABLE IF NOT EXISTS projects (
  slug TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  profile_json TEXT NOT NULL DEFAULT '{}',
  owner_login TEXT,
  shared INTEGER NOT NULL DEFAULT 0,
  workdrive_root_folder_id TEXT,
  context_current_folder_id TEXT,
  context_history_folder_id TEXT,
  decisions_folder_id TEXT,
  sessions_folder_id TEXT,
  snippets_folder_id TEXT,
  repo_index_folder_id TEXT,
  last_health_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS project_aliases (
  alias TEXT PRIMARY KEY,
  project_slug TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (project_slug) REFERENCES projects(slug)
);

CREATE TABLE IF NOT EXISTS project_github_repos (
  id TEXT PRIMARY KEY,
  project_slug TEXT NOT NULL,
  repo_full_name TEXT NOT NULL,
  default_branch TEXT,
  visibility TEXT,
  html_url TEXT,
  description TEXT,
  associated_by TEXT,
  associated_at TEXT NOT NULL,
  last_indexed_at TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  UNIQUE(project_slug, repo_full_name),
  FOREIGN KEY (project_slug) REFERENCES projects(slug)
);

CREATE TABLE IF NOT EXISTS project_folder_checks (
  id TEXT PRIMARY KEY,
  project_slug TEXT NOT NULL,
  folder_path TEXT NOT NULL,
  folder_id TEXT,
  status TEXT NOT NULL,
  checked_at TEXT NOT NULL,
  error TEXT,
  UNIQUE(project_slug, folder_path),
  FOREIGN KEY (project_slug) REFERENCES projects(slug)
);

CREATE TABLE IF NOT EXISTS repo_index_jobs (
  id TEXT PRIMARY KEY,
  project_slug TEXT NOT NULL,
  repo_full_name TEXT NOT NULL,
  ref TEXT,
  mode TEXT NOT NULL,
  globs_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL,
  limits_json TEXT NOT NULL DEFAULT '{}',
  result_json TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_slug) REFERENCES projects(slug)
);

CREATE TABLE IF NOT EXISTS memory_write_dedup (
  id TEXT PRIMARY KEY,
  project TEXT NOT NULL,
  memory_type TEXT NOT NULL,
  dedup_key TEXT NOT NULL,
  document_id TEXT,
  content_sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(project, memory_type, dedup_key)
);

CREATE TABLE IF NOT EXISTS admin_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  actor TEXT,
  project TEXT,
  status TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

ALTER TABLE documents ADD COLUMN source TEXT;
ALTER TABLE documents ADD COLUMN source_url TEXT;
ALTER TABLE documents ADD COLUMN repo TEXT;
ALTER TABLE documents ADD COLUMN repo_path TEXT;
ALTER TABLE documents ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE documents ADD COLUMN confidence REAL;
ALTER TABLE documents ADD COLUMN usefulness REAL;
ALTER TABLE documents ADD COLUMN superseded_by_document_id TEXT;

ALTER TABLE chunks ADD COLUMN project TEXT;
ALTER TABLE chunks ADD COLUMN memory_type TEXT;
ALTER TABLE chunks ADD COLUMN status TEXT;
ALTER TABLE chunks ADD COLUMN repo TEXT;
ALTER TABLE chunks ADD COLUMN repo_path TEXT;
ALTER TABLE chunks ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]';

ALTER TABLE reindex_jobs ADD COLUMN project TEXT;
ALTER TABLE reindex_jobs ADD COLUMN job_kind TEXT;
ALTER TABLE reindex_jobs ADD COLUMN result_json TEXT;
ALTER TABLE reindex_jobs ADD COLUMN locked_at TEXT;

CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status, updated_at);
CREATE INDEX IF NOT EXISTS idx_project_aliases_slug ON project_aliases(project_slug);
CREATE INDEX IF NOT EXISTS idx_project_github_repos_project ON project_github_repos(project_slug, status);
CREATE INDEX IF NOT EXISTS idx_project_folder_checks_project ON project_folder_checks(project_slug, status);
CREATE INDEX IF NOT EXISTS idx_repo_index_jobs_status ON repo_index_jobs(status, created_at);
CREATE INDEX IF NOT EXISTS idx_memory_write_dedup_lookup ON memory_write_dedup(project, memory_type, dedup_key);
CREATE INDEX IF NOT EXISTS idx_documents_repo_path ON documents(repo, repo_path);
CREATE INDEX IF NOT EXISTS idx_documents_source ON documents(source, source_url);
CREATE INDEX IF NOT EXISTS idx_chunks_hybrid ON chunks(project, memory_type, status);

INSERT OR IGNORE INTO projects (
  slug, display_name, description, status, profile_json, shared, created_at, updated_at
) VALUES (
  'shared', 'Shared Memory', 'Cross-project memory and conventions.', 'active', '{}', 1,
  datetime('now'), datetime('now')
);

INSERT OR IGNORE INTO projects (
  slug, display_name, description, status, profile_json, shared, created_at, updated_at
)
SELECT DISTINCT
  project,
  project,
  NULL,
  'active',
  '{}',
  CASE WHEN project = 'shared' THEN 1 ELSE 0 END,
  datetime('now'),
  datetime('now')
FROM documents
WHERE project IS NOT NULL;

UPDATE documents
SET tags_json = COALESCE(
  (
    SELECT json_extract(document_snapshots.frontmatter_json, '$.tags')
    FROM document_snapshots
    WHERE document_snapshots.id = documents.current_snapshot_id
  ),
  '[]'
)
WHERE tags_json = '[]';

UPDATE documents
SET
  source = (
    SELECT json_extract(document_snapshots.frontmatter_json, '$.source')
    FROM document_snapshots
    WHERE document_snapshots.id = documents.current_snapshot_id
  ),
  source_url = (
    SELECT json_extract(document_snapshots.frontmatter_json, '$.source_urls[0]')
    FROM document_snapshots
    WHERE document_snapshots.id = documents.current_snapshot_id
  ),
  repo = (
    SELECT json_extract(document_snapshots.frontmatter_json, '$.repo')
    FROM document_snapshots
    WHERE document_snapshots.id = documents.current_snapshot_id
  ),
  repo_path = (
    SELECT json_extract(document_snapshots.frontmatter_json, '$.path')
    FROM document_snapshots
    WHERE document_snapshots.id = documents.current_snapshot_id
  ),
  confidence = (
    SELECT json_extract(document_snapshots.frontmatter_json, '$.confidence')
    FROM document_snapshots
    WHERE document_snapshots.id = documents.current_snapshot_id
  ),
  usefulness = (
    SELECT json_extract(document_snapshots.frontmatter_json, '$.usefulness')
    FROM document_snapshots
    WHERE document_snapshots.id = documents.current_snapshot_id
  );

UPDATE chunks
SET
  project = (SELECT project FROM documents WHERE documents.id = chunks.document_id),
  memory_type = (SELECT memory_type FROM documents WHERE documents.id = chunks.document_id),
  status = (SELECT status FROM documents WHERE documents.id = chunks.document_id),
  repo = (SELECT repo FROM documents WHERE documents.id = chunks.document_id),
  repo_path = (SELECT repo_path FROM documents WHERE documents.id = chunks.document_id),
  tags_json = COALESCE((SELECT tags_json FROM documents WHERE documents.id = chunks.document_id), '[]');
