-- 037_add_subscriber_tags.sql
-- Smart auto-tagging system for subscriber engagement classification

CREATE TABLE IF NOT EXISTS subscriber_tags (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  subscriber_id UUID NOT NULL REFERENCES subscribers(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(subscriber_id, tag)
);

CREATE INDEX IF NOT EXISTS idx_subscriber_tags_subscriber ON subscriber_tags(subscriber_id);
CREATE INDEX IF NOT EXISTS idx_subscriber_tags_client ON subscriber_tags(client_id);
CREATE INDEX IF NOT EXISTS idx_subscriber_tags_tag ON subscriber_tags(tag);
