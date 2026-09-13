-- 077_subscriber_geo_summary.sql
--
-- Two read-only functions so the radius picker can stop guessing.
--
-- WHAT WAS WRONG
--
-- GeoFilter counts "subscribers in range" with Haversine over the `subscribers`
-- prop, which is the page the contacts table happens to hold - fifty rows. On a
-- workspace of 10,312 that is a 0.5% sample presented as an answer. It prefixes
-- a tilde when it knows it is sampling, which is honest but not useful: drop a
-- pin on Denver, where 500 contacts live, and it reads "~2 subscribers in
-- range". The map has the same problem from the same cause - it plots those
-- fifty rows, so the picture of where an audience lives is drawn from whoever
-- sorted to the top of page one.
--
-- The fix is to ask the database, which is what these two functions are for.
--
-- WHY NOT REUSE nearby_subscribers
--
-- It returns SETOF subscribers, so counting through it means shipping every row
-- to the API and taking length - and, because an RPC answer is a PostgREST
-- response, being silently cut at this project's `max-rows` of 1,000 on the way.
-- A scalar count has no such ceiling. Areas are a union, so the count must be
-- over DISTINCT subscribers: two overlapping circles double-count anybody in
-- both, and summing per-area counts is exactly that bug.
--
-- The haversine below is the same expression as `nearby_subscribers` (057) and
-- `campaign_audience()` (056). Three copies is one too many, but unifying them
-- is a change to the send path, and that path currently works.

-- Every subscriber inside any of the areas, counted once.
--
-- p_areas is [{"lat": 39.7, "lng": -104.9, "radius_km": 16.09}, ...]. Kilometres,
-- matching nearby_subscribers, enqueue_campaign_recipients and campaigns.geo_filter;
-- the UI still offers miles and converts at its own boundary.
CREATE OR REPLACE FUNCTION public.count_subscribers_in_areas(
  p_workspace_id UUID,
  p_areas        JSONB
) RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(DISTINCT s.id)
  FROM subscribers s
  WHERE s.workspace_id = p_workspace_id
    AND s.latitude IS NOT NULL
    AND s.longitude IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM jsonb_array_elements(COALESCE(p_areas, '[]'::jsonb)) AS a
      WHERE (a->>'lat') IS NOT NULL
        AND (a->>'lng') IS NOT NULL
        AND 6371 * acos(least(1, greatest(-1,
              cos(radians((a->>'lat')::double precision)) * cos(radians(s.latitude)) *
              cos(radians(s.longitude) - radians((a->>'lng')::double precision)) +
              sin(radians((a->>'lat')::double precision)) * sin(radians(s.latitude))
            ))) <= COALESCE((a->>'radius_km')::double precision, 16.09344)
    );
$$;

-- Where a workspace's contacts actually are, grouped so the map can draw them.
--
-- Returns one row per distinct coordinate at `p_precision` decimal places, with
-- the health split, so the picker plots ~28 sized circles instead of 10,312
-- markers stacked into 28 pixels. Two decimals is roughly a kilometre, which is
-- finer than city-level import data can justify and coarse enough to collapse
-- the duplicates.
--
-- Capped rows, because this is drawn on a map: a workspace with genuinely
-- scattered coordinates would otherwise stream tens of thousands of clusters
-- into a 360px canvas. The caller is told the cap was hit via `plotted` vs the
-- workspace total rather than being handed a quietly partial picture.
CREATE OR REPLACE FUNCTION public.subscriber_geo_clusters(
  p_workspace_id UUID,
  p_precision    INT DEFAULT 2,
  p_limit        INT DEFAULT 2000
) RETURNS TABLE (
  lat     DOUBLE PRECISION,
  lng     DOUBLE PRECISION,
  total   BIGINT,
  active  BIGINT,
  at_risk BIGINT,
  cold    BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    round(s.latitude::numeric,  least(greatest(p_precision, 0), 6))::double precision AS lat,
    round(s.longitude::numeric, least(greatest(p_precision, 0), 6))::double precision AS lng,
    count(*)                                                    AS total,
    count(*) FILTER (WHERE s.health_score = 'active')           AS active,
    count(*) FILTER (WHERE s.health_score = 'at_risk')          AS at_risk,
    count(*) FILTER (WHERE s.health_score = 'cold')             AS cold
  FROM subscribers s
  WHERE s.workspace_id = p_workspace_id
    AND s.latitude IS NOT NULL
    AND s.longitude IS NOT NULL
  GROUP BY 1, 2
  -- Biggest first, so hitting the cap loses the specks rather than the cities.
  ORDER BY 3 DESC
  LIMIT least(greatest(p_limit, 1), 5000);
$$;

-- Migration 053 revoked public EXECUTE on SECURITY DEFINER functions; these
-- follow suit. Both take the workspace as an argument and are called from routes
-- behind withWorkspace, which passes the caller's own workspace, never a
-- client-supplied one.
REVOKE ALL ON FUNCTION public.count_subscribers_in_areas(UUID, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.count_subscribers_in_areas(UUID, JSONB) TO service_role;

REVOKE ALL ON FUNCTION public.subscriber_geo_clusters(UUID, INT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.subscriber_geo_clusters(UUID, INT, INT) TO service_role;

COMMENT ON FUNCTION public.count_subscribers_in_areas(UUID, JSONB) IS
  'Distinct subscribers inside any of the given areas. Areas are a union, so overlapping circles count a person once. Kilometres.';

COMMENT ON FUNCTION public.subscriber_geo_clusters(UUID, INT, INT) IS
  'Subscriber coordinates grouped to p_precision decimal places with health counts, for plotting. Largest clusters first, capped.';
