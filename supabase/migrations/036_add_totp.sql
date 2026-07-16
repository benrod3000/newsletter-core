-- Add TOTP two-factor authentication columns to workspace_users
ALTER TABLE workspace_users
  ADD COLUMN IF NOT EXISTS totp_secret TEXT,
  ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS totp_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS recovery_codes TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS last_login_ip TEXT,
  ADD COLUMN IF NOT EXISTS last_login_user_agent TEXT;
