ALTER TABLE registrations ADD COLUMN updated_at TEXT;
ALTER TABLE registrations ADD COLUMN last_confirmation_sent_at TEXT;
ALTER TABLE registrations ADD COLUMN resend_count INTEGER NOT NULL DEFAULT 0;

UPDATE registrations
SET updated_at = created_at
WHERE updated_at IS NULL;

UPDATE registrations
SET last_confirmation_sent_at = created_at
WHERE last_confirmation_sent_at IS NULL
  AND email_status = 'sent';
