-- 041_performance_indexes.sql
-- Critical performance indexes identified during database audit.
-- Every index here supports a specific query pattern used in production.

-- campaigns: most common query is by client_id + status + created_at
CREATE INDEX IF NOT EXISTS idx_campaigns_client_status ON campaigns(client_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_campaigns_client_created ON campaigns(client_id, created_at DESC);

-- campaign_events: analytics queries are the hottest path
CREATE INDEX IF NOT EXISTS idx_campaign_events_campaign_type ON campaign_events(campaign_id, event_type, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_campaign_events_subscriber ON campaign_events(subscriber_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_campaign_events_occurred ON campaign_events(occurred_at DESC);

-- subscribers: filtered list queries
CREATE INDEX IF NOT EXISTS idx_subscribers_client_created ON subscribers(client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_subscribers_client_confirmed ON subscribers(client_id, confirmed, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_subscribers_email_client ON subscribers(email, client_id);

-- subscriber_tags: smart tags queries
CREATE INDEX IF NOT EXISTS idx_subscriber_tags_subscriber ON subscriber_tags(subscriber_id);
CREATE INDEX IF NOT EXISTS idx_subscriber_tags_client_tag ON subscriber_tags(client_id, tag);

-- widget_submissions: activity feed queries
CREATE INDEX IF NOT EXISTS idx_widget_submissions_client ON widget_submissions(client_id, created_at DESC);

-- campaign_jobs: queue status lookups
CREATE INDEX IF NOT EXISTS idx_campaign_jobs_campaign ON campaign_jobs(campaign_id, created_at DESC);

-- workspace_users: login lookups
CREATE INDEX IF NOT EXISTS idx_workspace_users_email_workspace ON workspace_users(email, workspace_id);
