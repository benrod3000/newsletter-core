-- Widget analytics: track impressions and submissions per widget
CREATE TABLE IF NOT EXISTS widget_events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  widget_id UUID NOT NULL,
  workspace_id UUID NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('impression', 'submission')),
  subscriber_id UUID,
  occurred_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_widget_events_widget ON widget_events(widget_id, event_type);
CREATE INDEX IF NOT EXISTS idx_widget_events_workspace ON widget_events(workspace_id, occurred_at DESC);
