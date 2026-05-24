CREATE TABLE IF NOT EXISTS workdrive_canonicalization_manifests (
  id TEXT PRIMARY KEY,
  migration_slug TEXT NOT NULL,
  canonical_project TEXT NOT NULL,
  duplicate_project TEXT NOT NULL,
  dry_run INTEGER NOT NULL DEFAULT 1,
  apply_requested INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  summary TEXT NOT NULL,
  manifest_json TEXT NOT NULL,
  counts_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

ALTER TABLE documents ADD COLUMN canonical_path TEXT;
ALTER TABLE documents ADD COLUMN archived_to_path TEXT;
ALTER TABLE documents ADD COLUMN archived_from_path TEXT;
ALTER TABLE documents ADD COLUMN canonicalization_manifest_id TEXT;

CREATE INDEX IF NOT EXISTS idx_workdrive_canonicalization_manifests_projects
  ON workdrive_canonicalization_manifests(canonical_project, duplicate_project, created_at);

CREATE INDEX IF NOT EXISTS idx_documents_archived_to_path
  ON documents(project, archived_to_path);
