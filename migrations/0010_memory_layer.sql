-- migrations/0010_memory_layer.sql
ALTER TABLE documents ADD COLUMN memory_layer TEXT;

CREATE INDEX IF NOT EXISTS idx_documents_memory_layer
  ON documents(project, memory_layer, status, active);
