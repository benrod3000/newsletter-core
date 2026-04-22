-- Automation system for workflow triggers and email actions
-- Enables clients to automatically send emails on specific events

CREATE TABLE IF NOT EXISTS automation_triggers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('subscriber_joined', 'lead_magnet_claimed', 'location_change', 'custom_webhook', 'on_schedule')),
  trigger_config JSONB NOT NULL DEFAULT '{}'::jsonb, -- trigger-specific settings
  action_type TEXT NOT NULL DEFAULT 'send_email' CHECK (action_type IN ('send_email', 'add_to_list', 'send_notification')),
  action_config JSONB NOT NULL DEFAULT '{}'::jsonb, -- campaign_id, list_id, etc
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_by UUID NOT NULL REFERENCES workspace_users(id) ON DELETE SET NULL,
  
  UNIQUE(workspace_id, name)
);

CREATE TABLE IF NOT EXISTS automation_logs (
  id BIGSERIAL PRIMARY KEY,
  automation_id UUID NOT NULL REFERENCES automation_triggers(id) ON DELETE CASCADE,
  subscriber_id UUID REFERENCES subscribers(id) ON DELETE SET NULL,
  trigger_event JSONB NOT NULL, -- full event data
  status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'success', 'failed')) DEFAULT 'pending',
  error_message TEXT,
  executed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_automations_workspace ON automation_triggers(workspace_id);
CREATE INDEX idx_automations_active ON automation_triggers(workspace_id, is_active);
CREATE INDEX idx_automation_logs_automation ON automation_logs(automation_id);
CREATE INDEX idx_automation_logs_subscriber ON automation_logs(subscriber_id);
CREATE INDEX idx_automation_logs_status ON automation_logs(status);
CREATE INDEX idx_automation_logs_created ON automation_logs(created_at DESC);
