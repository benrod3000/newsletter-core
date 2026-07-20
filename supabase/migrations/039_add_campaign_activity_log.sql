-- 039_add_campaign_activity_log.sql
-- Campaign activity timeline (like GitHub commit history) and provider failover support

CREATE TABLE IF NOT EXISTS campaign_activity_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE,
  workspace_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  description TEXT NOT NULL,
  details JSONB DEFAULT '{}',
  subscriber_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activity_campaign ON campaign_activity_log(campaign_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_workspace ON campaign_activity_log(workspace_id, created_at DESC);

-- Allow workspaces to configure a fallback email provider
ALTER TABLE clients ADD COLUMN IF NOT EXISTS fallback_provider TEXT;
