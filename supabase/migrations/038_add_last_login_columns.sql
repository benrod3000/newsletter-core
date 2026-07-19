-- 038_add_last_login_columns.sql
-- Track last login timestamp, IP, and user agent on workspace_users

ALTER TABLE workspace_users
ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS last_login_ip TEXT,
ADD COLUMN IF NOT EXISTS last_login_user_agent TEXT;
