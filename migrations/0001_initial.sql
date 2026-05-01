CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  workdrive_file_id TEXT NOT NULL UNIQUE,
  path TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  project TEXT NOT NULL,
  namespace TEXT NOT NULL,
  parent_folder_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  permalink TEXT,
  download_url TEXT,
  memory_type TEXT NOT NULL,
  status TEXT NOT NULL,
  canonical INTEGER NOT NULL,
  active INTEGER NOT NULL,
  revision INTEGER NOT NULL,
  current_snapshot_id TEXT,
  last_remote_modified_at INTEGER,
  last_indexed_at INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS document_snapshots (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  workdrive_file_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  content_sha256 TEXT NOT NULL,
  raw_markdown TEXT NOT NULL,
  frontmatter_json TEXT NOT NULL,
  body_markdown TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  remote_modified_at INTEGER,
  FOREIGN KEY (document_id) REFERENCES documents(id)
);

CREATE TABLE IF NOT EXISTS chunks (
  vector_id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  namespace TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  heading_path TEXT NOT NULL,
  content TEXT NOT NULL,
  token_estimate INTEGER NOT NULL,
  updated_at_unix INTEGER NOT NULL,
  FOREIGN KEY (document_id) REFERENCES documents(id),
  FOREIGN KEY (snapshot_id) REFERENCES document_snapshots(id)
);

CREATE TABLE IF NOT EXISTS supersessions (
  id TEXT PRIMARY KEY,
  from_document_id TEXT NOT NULL,
  from_snapshot_id TEXT NOT NULL,
  to_document_id TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  recorded_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reindex_jobs (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  document_id TEXT,
  workdrive_file_id TEXT,
  path TEXT,
  status TEXT NOT NULL,
  reason TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  requested_by TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_runs (
  id TEXT PRIMARY KEY,
  trigger_kind TEXT NOT NULL,
  status TEXT NOT NULL,
  scanned_count INTEGER NOT NULL DEFAULT 0,
  enqueued_count INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_documents_project_active ON documents(project, active, memory_type);
CREATE INDEX IF NOT EXISTS idx_documents_path ON documents(path);
CREATE INDEX IF NOT EXISTS idx_chunks_document ON chunks(document_id, chunk_index);
CREATE INDEX IF NOT EXISTS idx_reindex_jobs_status ON reindex_jobs(status, created_at);
