-- Audit log for tracking important security and operational actions
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  user_id UUID REFERENCES workspace_users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  details JSONB DEFAULT '{}',
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast lookups per workspace
CREATE INDEX IF NOT EXISTS idx_audit_logs_workspace ON audit_logs(workspace_id, created_at DESC);

-- Index for user-specific history
CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id, created_at DESC);
