-- Campaign templates: reusable campaign blueprints
CREATE TABLE IF NOT EXISTS campaign_templates (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID NOT NULL,
  name TEXT NOT NULL,
  subject TEXT,
  editor_html TEXT,
  audience TEXT DEFAULT 'confirmed',
  category TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_campaign_templates_workspace ON campaign_templates(workspace_id);
