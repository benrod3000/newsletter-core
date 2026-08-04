-- 057_nearby_subscribers.sql
--
-- Adds the function the subscriber radius search has always called and never had.
--
-- `app/api/clients/[workspaceId]/subscribers/route.ts` has called
-- `nearby_subscribers` since the feature shipped. It has never existed, so every
-- radius search returned 500. The code comment there already admitted it; this
-- is the migration it was waiting for.
--
-- UNITS
--
-- The route passed `radius_miles` while `enqueue_campaign_recipients` takes
-- `p_radius_km`, and `campaigns.geo_filter` stores `radius_km`. So viewing and
-- sending disagreed about what a radius meant: a user could filter to a radius,
-- see one set of people, and mail a different one. Kilometres wins because it is
-- what is already persisted and what the send path uses; the route converts at
-- the boundary and the UI keeps offering miles.
--
-- SHAPE
--
-- Returns SETOF subscribers so the route can hand rows back exactly as the
-- non-radius path does with `.select("*")`.
--
-- The haversine is the same expression as in `campaign_audience()` (migration
-- 056), which is the model this was written from. It is inline rather than using
-- the earthdistance extension for the same reason: one fewer dependency, and
-- neither of these is a hot path.
--
-- NOTE ON DATA
--
-- This returns nothing for a subscriber with no coordinates, and today that is
-- every imported row - the CSV import does not geocode, so `latitude` and
-- `longitude` are null across the board. The function being absent was one bug;
-- the rows having no coordinates is a second, addressed separately. Adding this
-- makes the endpoint correct, not immediately useful.

CREATE OR REPLACE FUNCTION public.nearby_subscribers(
  p_workspace_id UUID,
  center_lat     DOUBLE PRECISION,
  center_lng     DOUBLE PRECISION,
  radius_km      DOUBLE PRECISION
) RETURNS SETOF public.subscribers
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.*
  FROM subscribers s
  WHERE s.workspace_id = p_workspace_id
    AND s.latitude IS NOT NULL
    AND s.longitude IS NOT NULL
    AND 6371 * acos(least(1, greatest(-1,
          cos(radians(center_lat)) * cos(radians(s.latitude)) *
          cos(radians(s.longitude) - radians(center_lng)) +
          sin(radians(center_lat)) * sin(radians(s.latitude))
        ))) <= radius_km
  ORDER BY s.created_at DESC;
$$;

-- Migration 053 revoked public EXECUTE on SECURITY DEFINER functions; this
-- follows suit. service_role only: the route runs behind withWorkspace and
-- passes the caller's own workspace explicitly.
REVOKE ALL ON FUNCTION public.nearby_subscribers(UUID, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nearby_subscribers(UUID, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION) TO service_role;

COMMENT ON FUNCTION public.nearby_subscribers(UUID, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION) IS
  'Subscribers within radius_km of a point. Kilometres, matching enqueue_campaign_recipients and campaigns.geo_filter. Returns nothing for subscribers with no coordinates.';
