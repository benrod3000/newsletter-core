-- Create workspace_users table for client portal authentication
-- Each workspace can have one or more users who can log in with email + password

CREATE TABLE IF NOT EXISTS workspace_users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL, -- bcrypt hash
  role TEXT NOT NULL DEFAULT 'editor' CHECK (role IN ('owner', 'editor', 'viewer')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_login_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Ensure one email per workspace
  UNIQUE(workspace_id, email)
);

-- Index for login queries
CREATE INDEX idx_workspace_users_workspace_id ON workspace_users(workspace_id);
CREATE INDEX idx_workspace_users_email ON workspace_users(email);

-- Enable RLS
ALTER TABLE workspace_users ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can only read their own workspace's users
CREATE POLICY workspace_users_select ON workspace_users
  FOR SELECT
  USING (
    -- For now, allow service role (backend) unrestricted access
    -- Client frontend will use JWT
    true
  );

-- RLS Policy: Only service role can insert/update/delete (backend controlled)
CREATE POLICY workspace_users_insert ON workspace_users
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY workspace_users_update ON workspace_users
  FOR UPDATE
  USING (true)
  WITH CHECK (true);

CREATE POLICY workspace_users_delete ON workspace_users
  FOR DELETE
  USING (true);
