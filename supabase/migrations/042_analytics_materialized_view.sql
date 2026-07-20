-- 042_analytics_materialized_view.sql
-- Precomputed campaign analytics. Refreshed periodically by cron.
-- Eliminates expensive campaign_events table scans on every analytics load.

-- Materialized view: per-campaign stats
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_campaign_stats AS
SELECT
  c.id AS campaign_id,
  c.client_id,
  c.title,
  c.subject,
  c.status,
  c.sent_count,
  c.last_sent_at,
  c.created_at,
  COUNT(e_open.id) AS opens,
  COUNT(e_click.id) AS clicks,
  CASE WHEN c.sent_count > 0 THEN
    ROUND((COUNT(e_open.id)::NUMERIC / c.sent_count) * 100, 1)
  ELSE 0 END AS open_rate,
  CASE WHEN c.sent_count > 0 THEN
    ROUND((COUNT(e_click.id)::NUMERIC / c.sent_count) * 100, 1)
  ELSE 0 END AS click_rate
FROM campaigns c
LEFT JOIN campaign_events e_open
  ON e_open.campaign_id = c.id AND e_open.event_type = 'open'
LEFT JOIN campaign_events e_click
  ON e_click.campaign_id = c.id AND e_click.event_type = 'click'
WHERE c.status = 'sent'
GROUP BY c.id, c.client_id, c.title, c.subject, c.status, c.sent_count, c.last_sent_at, c.created_at;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_campaign_stats_id ON mv_campaign_stats(campaign_id);
CREATE INDEX IF NOT EXISTS idx_mv_campaign_stats_client ON mv_campaign_stats(client_id, created_at DESC);

-- Materialized view: subscriber growth per day (last 90 days)
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_subscriber_growth AS
SELECT
  client_id,
  DATE(created_at) AS day,
  COUNT(*) AS count
FROM subscribers
WHERE created_at >= NOW() - INTERVAL '90 days'
GROUP BY client_id, DATE(created_at)
ORDER BY day;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_growth_client_day ON mv_subscriber_growth(client_id, day);

-- Refresh function: call via cron or admin endpoint
CREATE OR REPLACE FUNCTION refresh_analytics_views()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_campaign_stats;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_subscriber_growth;
END;
$$;
