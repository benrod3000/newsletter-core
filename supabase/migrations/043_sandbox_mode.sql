-- 043_sandbox_mode.sql
-- Sandbox mode for testing campaigns without sending real emails.
-- Campaigns flow through the full pipeline but emails are intercepted.

ALTER TABLE clients ADD COLUMN IF NOT EXISTS sandbox_mode BOOLEAN DEFAULT false;
