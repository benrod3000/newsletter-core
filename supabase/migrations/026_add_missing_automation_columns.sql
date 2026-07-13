-- 026: Fix all missing automation columns and tables
-- Closes 4 silent failures where code writes to columns/tables that were never created:
--   1. health_score   — health-scores.ts + auto-clean.ts + frontend badges
--   2. reminded       — confirm-remind.ts
--   3. subscriber_tags — smart-tags.ts

ALTER TABLE public.subscribers
  ADD COLUMN IF NOT EXISTS health_score TEXT
  CHECK (health_score IN ('active', 'at_risk', 'cold'));

ALTER TABLE public.subscribers
  ADD COLUMN IF NOT EXISTS reminded BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS subscribers_health_score_idx
  ON public.subscribers (health_score)
  WHERE health_score IS NOT NULL;

CREATE INDEX IF NOT EXISTS subscribers_health_score_client_idx
  ON public.subscribers (client_id, health_score);

CREATE TABLE IF NOT EXISTS subscriber_tags (
  id BIGSERIAL PRIMARY KEY,
  subscriber_id UUID NOT NULL REFERENCES subscribers(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(subscriber_id, tag)
);

CREATE INDEX IF NOT EXISTS subscriber_tags_subscriber_idx ON subscriber_tags(subscriber_id);
CREATE INDEX IF NOT EXISTS subscriber_tags_client_idx ON subscriber_tags(client_id);
CREATE INDEX IF NOT EXISTS subscriber_tags_tag_idx ON subscriber_tags(tag);
