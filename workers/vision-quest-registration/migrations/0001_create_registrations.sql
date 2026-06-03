CREATE TABLE IF NOT EXISTS registrations (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL,
  sessions TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'vision-quest',
  email_status TEXT NOT NULL DEFAULT 'pending',
  admin_email_status TEXT NOT NULL DEFAULT 'pending',
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_registrations_created_at
  ON registrations (created_at);

CREATE INDEX IF NOT EXISTS idx_registrations_email
  ON registrations (email);
