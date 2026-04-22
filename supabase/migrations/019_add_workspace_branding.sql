-- Add branding columns to clients table for white-label customization
-- Each workspace can have custom logo, colors, domain, and sender identity

ALTER TABLE clients ADD COLUMN IF NOT EXISTS logo_url TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS brand_colors JSONB DEFAULT '{"primary":"#f59e0b","secondary":"#18181b"}'::jsonb;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS custom_domain TEXT UNIQUE;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS sender_name TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS sender_email TEXT;

-- Create branding audit table for tracking changes
CREATE TABLE IF NOT EXISTS workspace_branding_audits (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  changed_by UUID NOT NULL REFERENCES workspace_users(id) ON DELETE SET NULL,
  change_type TEXT NOT NULL CHECK (change_type IN ('logo', 'colors', 'domain', 'sender')),
  old_value TEXT,
  new_value TEXT,
  changed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_branding_audits_workspace ON workspace_branding_audits(workspace_id);
