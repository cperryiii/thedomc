ALTER TABLE registrations ADD COLUMN archived_at TEXT;

CREATE INDEX IF NOT EXISTS idx_registrations_archived_at
  ON registrations (archived_at);
