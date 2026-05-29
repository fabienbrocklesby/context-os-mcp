-- migrations/0009_actionability.sql
ALTER TABLE entity_states ADD COLUMN actionability TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE entity_states ADD COLUMN resolve_after TEXT;

CREATE INDEX IF NOT EXISTS idx_entity_states_actionability
  ON entity_states(project, entity_id, actionability, resolve_after)
  WHERE status = 'active';
