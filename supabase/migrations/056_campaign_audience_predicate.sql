-- 056_campaign_audience_predicate.sql
--
-- Extracts "who would receive this send" into one function, so the number shown
-- to a user before sending is produced by the same code that decides who
-- actually receives it.
--
-- WHY THIS EXISTS
--
-- The send confirmation dialog showed `campaign.sent_count` as its recipient
-- count. That column is how many were *already* sent, so on an unsent draft it
-- is 0, falls through `||`, and the dialog read "will be sent to all confirmed
-- subscribers" with no number in it at all. The cost line beneath it was
-- `(sent_count || 100) * 0.0001` and named AWS SES regardless of the workspace's
-- actual provider. Three fabricated values, at the one moment in the product
-- that is irreversible.
--
-- Fixing that needs a real count, and a real count must agree with the send.
-- Reimplementing the predicate in TypeScript would guarantee eventual
-- disagreement: eight filters, an EXISTS over campaign_events, and an inline
-- haversine, maintained twice. So the predicate moves here and both callers use
-- it.
--
-- SHAPE
--
-- `campaign_audience()` returns matching subscriber ids. `enqueue_campaign_
-- recipients()` inserts from it; `count_campaign_recipients()` counts it. The
-- WHERE clause exists once.
--
-- Behaviour is intended to be identical to the predicate previously inlined in
-- enqueue_campaign_recipients (migration 050). The verification query at the
-- bottom of this file compares the two against live data.

-- ---------------------------------------------------------------------------
-- 1. The predicate.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.campaign_audience(
  p_workspace   UUID,
  p_audience    TEXT DEFAULT 'confirmed',
  p_list_id     UUID DEFAULT NULL,
  p_country     TEXT DEFAULT NULL,
  p_regions     TEXT[] DEFAULT NULL,
  p_cities      TEXT[] DEFAULT NULL,
  p_center_lat  DOUBLE PRECISION DEFAULT NULL,
  p_center_lng  DOUBLE PRECISION DEFAULT NULL,
  p_radius_km   DOUBLE PRECISION DEFAULT NULL
) RETURNS TABLE (subscriber_id UUID)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.id
  FROM subscribers s
  WHERE s.workspace_id = p_workspace
    AND s.suppressed = false
    AND s.email IS NOT NULL
    AND s.email <> ''

    -- Audience
    AND (p_audience <> 'confirmed' OR s.confirmed = true)
    AND (p_audience <> 'pending'   OR s.confirmed = false)
    AND (
      p_audience <> 'claimed_offer'
      OR (s.confirmed = true AND EXISTS (
            SELECT 1 FROM campaign_events e
            WHERE e.subscriber_id = s.id
              AND e.event_type = 'click'
              AND e.metadata->>'tracking_kind' = 'lead_magnet'))
    )

    -- Explicit list membership (audience "list:<uuid>")
    AND (
      p_list_id IS NULL
      OR EXISTS (SELECT 1 FROM subscriber_list_memberships m
                 WHERE m.subscriber_id = s.id AND m.list_id = p_list_id)
    )

    -- Geo
    AND (p_country IS NULL OR s.country = p_country)
    AND (p_regions IS NULL OR cardinality(p_regions) = 0 OR s.region = ANY(p_regions))
    AND (p_cities  IS NULL OR cardinality(p_cities)  = 0 OR s.city   = ANY(p_cities))

    -- Radius. Haversine inline rather than the earthdistance extension: one
    -- fewer dependency, and this is not a hot path.
    AND (
      p_radius_km IS NULL OR p_center_lat IS NULL OR p_center_lng IS NULL
      OR (
        s.latitude IS NOT NULL AND s.longitude IS NOT NULL
        AND 6371 * acos(least(1, greatest(-1,
              cos(radians(p_center_lat)) * cos(radians(s.latitude)) *
              cos(radians(s.longitude) - radians(p_center_lng)) +
              sin(radians(p_center_lat)) * sin(radians(s.latitude))
            ))) <= p_radius_km
      )
    );
$$;

-- ---------------------------------------------------------------------------
-- 2. The count. What the user is shown before committing to a send.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.count_campaign_recipients(
  p_workspace   UUID,
  p_audience    TEXT DEFAULT 'confirmed',
  p_list_id     UUID DEFAULT NULL,
  p_country     TEXT DEFAULT NULL,
  p_regions     TEXT[] DEFAULT NULL,
  p_cities      TEXT[] DEFAULT NULL,
  p_center_lat  DOUBLE PRECISION DEFAULT NULL,
  p_center_lng  DOUBLE PRECISION DEFAULT NULL,
  p_radius_km   DOUBLE PRECISION DEFAULT NULL
) RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(count(*), 0)::INTEGER
  FROM public.campaign_audience(
    p_workspace, p_audience, p_list_id, p_country, p_regions, p_cities,
    p_center_lat, p_center_lng, p_radius_km
  );
$$;

-- ---------------------------------------------------------------------------
-- 3. Enqueue, now insert-from-predicate rather than a second copy of it.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enqueue_campaign_recipients(
  p_job_id      UUID,
  p_workspace   UUID,
  p_audience    TEXT DEFAULT 'confirmed',
  p_list_id     UUID DEFAULT NULL,
  p_country     TEXT DEFAULT NULL,
  p_regions     TEXT[] DEFAULT NULL,
  p_cities      TEXT[] DEFAULT NULL,
  p_center_lat  DOUBLE PRECISION DEFAULT NULL,
  p_center_lng  DOUBLE PRECISION DEFAULT NULL,
  p_radius_km   DOUBLE PRECISION DEFAULT NULL
) RETURNS INTEGER
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH inserted AS (
    INSERT INTO campaign_job_recipients (job_id, subscriber_id, workspace_id)
    SELECT p_job_id, a.subscriber_id, p_workspace
    FROM public.campaign_audience(
      p_workspace, p_audience, p_list_id, p_country, p_regions, p_cities,
      p_center_lat, p_center_lng, p_radius_km
    ) a
    ON CONFLICT (job_id, subscriber_id) DO NOTHING
    RETURNING 1
  )
  SELECT COALESCE(count(*), 0)::INTEGER FROM inserted;
$$;

-- ---------------------------------------------------------------------------
-- 4. Privileges.
--
--    Migration 053 revoked public EXECUTE on SECURITY DEFINER functions; these
--    follow that. `authenticated` may count - the route it backs is already
--    behind withWorkspace, and the function takes the workspace as a parameter
--    rather than reading it from a claim, so it is the route's job to pass the
--    caller's own workspace. Enqueue stays service_role only: it writes.
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.campaign_audience(UUID, TEXT, UUID, TEXT, TEXT[], TEXT[], DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.count_campaign_recipients(UUID, TEXT, UUID, TEXT, TEXT[], TEXT[], DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.enqueue_campaign_recipients(UUID, UUID, TEXT, UUID, TEXT, TEXT[], TEXT[], DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.campaign_audience(UUID, TEXT, UUID, TEXT, TEXT[], TEXT[], DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION) TO service_role;
GRANT EXECUTE ON FUNCTION public.count_campaign_recipients(UUID, TEXT, UUID, TEXT, TEXT[], TEXT[], DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION) TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_campaign_recipients(UUID, UUID, TEXT, UUID, TEXT, TEXT[], TEXT[], DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION) TO service_role;

COMMENT ON FUNCTION public.campaign_audience(UUID, TEXT, UUID, TEXT, TEXT[], TEXT[], DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION) IS
  'The single definition of who receives a campaign. Counted by count_campaign_recipients, inserted by enqueue_campaign_recipients. Change the audience rules here and nowhere else.';
