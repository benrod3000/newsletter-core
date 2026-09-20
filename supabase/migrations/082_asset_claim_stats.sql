-- 082_asset_claim_stats.sql
--
-- How much bandwidth the giveaways are actually spending.
--
-- WHY THIS EXISTS
--
-- A giveaway is a fan-out download: one file, many retrievals. This project's
-- egress quota is 5 GB cached plus 5 GB uncached per month and is shared with
-- the database that serves the app, so a single popular file can exhaust it -
-- and the consequence is not a degraded library. Supabase's fair use policy
-- pauses projects, switches databases to read-only and answers 402 to every API
-- request, across the whole organization.
--
-- The library already enforces size caps, but a 10 MB file inside the cap is
-- still 10 MB every time somebody claims it. Storage used says nothing about
-- that. This is the number that does.
--
-- WHY IT CAN BE COUNTED AT ALL
--
-- Every claim already passes through /api/track/click, which records a
-- campaign_events row with `metadata.tracking_kind = 'lead_magnet'` and the
-- destination in `url` - and for a library giveaway that destination is the
-- asset's public_url. So the join is a string match on a column already being
-- written, and no new tracking, table or column is needed to answer it.
--
-- WHAT THE NUMBER MEANS
--
-- `bytes_estimate` is claims x file size, which is an **upper bound** on origin
-- egress rather than a measurement. Two things push actual usage below it: the
-- bucket is public so repeat downloads can be served from CDN cache, and a
-- recorded click is a click, not a completed download. Overstating is the right
-- direction to be wrong in for a warning signal - it trips early rather than
-- late - but the UI has to say "up to", because presenting an upper bound as a
-- measurement is the same overstatement the in-range subscriber count used to
-- make.

CREATE OR REPLACE FUNCTION public.asset_claim_stats(
  p_workspace_id UUID,
  p_since        TIMESTAMPTZ DEFAULT date_trunc('month', now())
) RETURNS TABLE (
  asset_id       UUID,
  claims         BIGINT,
  bytes_estimate BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    a.id AS asset_id,
    count(e.id) AS claims,
    (count(e.id) * a.bytes)::bigint AS bytes_estimate
  FROM assets a
  LEFT JOIN campaign_events e
    ON e.workspace_id = a.workspace_id
   AND e.event_type = 'click'
   AND e.metadata->>'tracking_kind' = 'lead_magnet'
   AND e.url = a.public_url
   AND e.occurred_at >= p_since
  WHERE a.workspace_id = p_workspace_id
  GROUP BY a.id, a.bytes;
$$;

-- Migration 053 revoked public EXECUTE on SECURITY DEFINER functions and 077,
-- 078 and 081 followed suit. Same here: the route runs behind withWorkspace and
-- passes the caller's own workspace, never a client-supplied one.
REVOKE ALL ON FUNCTION public.asset_claim_stats(UUID, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.asset_claim_stats(UUID, TIMESTAMPTZ) TO service_role;

COMMENT ON FUNCTION public.asset_claim_stats(UUID, TIMESTAMPTZ) IS
  'Claims per library file since p_since, defaulting to this calendar month, with an upper-bound egress estimate (claims x file size). Counts lead_magnet clicks whose destination is the asset public_url.';

-- The join filters on these three before it counts, and campaign_events is the
-- largest table this touches.
-- `occurred_at`, not `created_at`: campaign_events has no created_at column, and
-- naming the wrong one here fails loudly rather than silently, which is the only
-- reason this comment is worth leaving.
CREATE INDEX IF NOT EXISTS idx_campaign_events_lead_magnet_clicks
  ON public.campaign_events (workspace_id, occurred_at)
  WHERE event_type = 'click';
