-- Saved audience segments for quick filter recall
CREATE TABLE IF NOT EXISTS saved_segments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID NOT NULL,
  name TEXT NOT NULL,
  filters JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_saved_segments_workspace ON saved_segments(workspace_id);
