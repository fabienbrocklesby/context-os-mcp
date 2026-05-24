-- Historical memory is background context, not archived memory.
-- Keep superseded/archived rows inactive, but allow historical sessions and notes to
-- participate in normal retrieval with ranking penalties.
UPDATE documents
SET active = 1,
    updated_at = datetime('now')
WHERE status = 'historical'
  AND active = 0;

