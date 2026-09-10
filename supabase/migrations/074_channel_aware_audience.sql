-- Audience eligibility becomes a parameter instead of a hardcoded clause.
--
-- `campaign_audience()` is the single definition of who a campaign reaches. It
-- exists because the count shown to an operator and the set actually enqueued
-- used to be two hand-written queries that could disagree, and "the same count
-- over different people" is the failure that matters.
--
-- Its eligibility half was email-only:
--
--   consent_email_marketing = true AND email IS NOT NULL AND email <> ''
--
-- Everything else in the function - suppression, the audience states, list
-- membership, country, region, city, radius - is channel-independent targeting.
-- So the channel swaps ONLY the eligibility clause and shares all the targeting,
-- which is what stops SMS growing its own idea of who a segment is.
--
-- This is the "eligibility as a service" hook from the architecture direction,
-- landed at its cheapest: one parameter, answering "can I reach this person on
-- this channel". A future optimizer asks the same function.
--
-- DO NOT BACKFILL sms_consent. It reads false for all 10,311 rows because nobody
-- has ever been asked, not because anyone refused. That makes the SMS reachable
-- count genuinely zero until people opt in through a widget, and a zero count is
-- going to look like a bug worth "fixing". It is not. This is the same shape as
-- consent_email_marketing before migration 065, with one decisive difference:
-- there, false meant "never asked" for people who HAD opted in by other means,
-- so enforcing it dropped a real audience to 6. Here, false means nobody has
-- SMS permission, and sending anyway is a TCPA violation per message.
--
-- The functions are DROPPED before being recreated, not replaced. Adding a
-- parameter with a default to an existing signature creates an OVERLOAD rather
-- than a replacement, and PostgREST would then have two candidates for a 9-arg
-- call: either an ambiguity error, or silently the old email-only version.
--
-- Grants are re-applied explicitly. A dropped function loses its ACL, and
-- migration 049 revoked everything from `authenticated`, so nothing is inherited.
-- The 2026-07-26 incident was this exact class of loss.

DROP FUNCTION IF EXISTS public.count_campaign_recipients(uuid, text, uuid, text, text[], text[], double precision, double precision, double precision);
DROP FUNCTION IF EXISTS public.enqueue_campaign_recipients(uuid, uuid, text, uuid, text, text[], text[], double precision, double precision, double precision);
DROP FUNCTION IF EXISTS public.campaign_audience(uuid, text, uuid, text, text[], text[], double precision, double precision, double precision);

CREATE FUNCTION public.campaign_audience(
  p_workspace  uuid,
  p_audience   text DEFAULT 'confirmed',
  p_list_id    uuid DEFAULT NULL,
  p_country    text DEFAULT NULL,
  p_regions    text[] DEFAULT NULL,
  p_cities     text[] DEFAULT NULL,
  p_center_lat double precision DEFAULT NULL,
  p_center_lng double precision DEFAULT NULL,
  p_radius_km  double precision DEFAULT NULL,
  p_channel    text DEFAULT 'email'
)
RETURNS TABLE(subscriber_id uuid)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT s.id
  FROM subscribers s
  WHERE s.workspace_id = p_workspace
    -- Global kill switch, honoured by every channel. An unsubscribe or a bounce
    -- suppression stops all outbound, not just the channel it came from.
    AND s.suppressed = false
    -- Per-channel permission. `suppressed` above says "never contact"; this says
    -- "not on this channel". An email unsubscribe must not silently end SMS, and
    -- an SMS STOP must not silently end email, so the two are separate columns
    -- and separate decisions.
    AND (
      CASE p_channel
        WHEN 'email' THEN
          s.consent_email_marketing = true
          AND s.email IS NOT NULL
          AND s.email <> ''
        WHEN 'sms' THEN
          s.sms_consent = true
          AND s.phone_number IS NOT NULL
          AND s.phone_number <> ''
        -- An unknown channel reaches nobody. Failing closed matters more than a
        -- clear error here: the alternative is a typo selecting the whole
        -- workspace and messaging all of them.
        ELSE false
      END
    )
    -- Everything below is targeting, shared by every channel.
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
    AND (
      p_list_id IS NULL
      OR EXISTS (SELECT 1 FROM subscriber_list_memberships m
                 WHERE m.subscriber_id = s.id AND m.list_id = p_list_id)
    )
    AND (p_country IS NULL OR s.country = p_country)
    AND (p_regions IS NULL OR cardinality(p_regions) = 0 OR s.region = ANY(p_regions))
    AND (p_cities  IS NULL OR cardinality(p_cities)  = 0 OR s.city   = ANY(p_cities))
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
$function$;

CREATE FUNCTION public.count_campaign_recipients(
  p_workspace  uuid,
  p_audience   text DEFAULT 'confirmed',
  p_list_id    uuid DEFAULT NULL,
  p_country    text DEFAULT NULL,
  p_regions    text[] DEFAULT NULL,
  p_cities     text[] DEFAULT NULL,
  p_center_lat double precision DEFAULT NULL,
  p_center_lng double precision DEFAULT NULL,
  p_radius_km  double precision DEFAULT NULL,
  p_channel    text DEFAULT 'email'
)
RETURNS integer
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(count(*), 0)::INTEGER
  FROM public.campaign_audience(
    p_workspace, p_audience, p_list_id, p_country, p_regions, p_cities,
    p_center_lat, p_center_lng, p_radius_km, p_channel
  );
$function$;

CREATE FUNCTION public.enqueue_campaign_recipients(
  p_job_id     uuid,
  p_workspace  uuid,
  p_audience   text DEFAULT 'confirmed',
  p_list_id    uuid DEFAULT NULL,
  p_country    text DEFAULT NULL,
  p_regions    text[] DEFAULT NULL,
  p_cities     text[] DEFAULT NULL,
  p_center_lat double precision DEFAULT NULL,
  p_center_lng double precision DEFAULT NULL,
  p_radius_km  double precision DEFAULT NULL,
  p_channel    text DEFAULT 'email'
)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH inserted AS (
    INSERT INTO campaign_job_recipients (job_id, subscriber_id, workspace_id)
    SELECT p_job_id, a.subscriber_id, p_workspace
    FROM public.campaign_audience(
      p_workspace, p_audience, p_list_id, p_country, p_regions, p_cities,
      p_center_lat, p_center_lng, p_radius_km, p_channel
    ) a
    ON CONFLICT (job_id, subscriber_id) DO NOTHING
    RETURNING 1
  )
  SELECT COALESCE(count(*), 0)::INTEGER FROM inserted;
$function$;

-- Restored to match what the dropped versions had, exactly.
-- `count_` is the only one `authenticated` could call: it is what the pre-send
-- estimate uses from a workspace-scoped route. The other two run as service_role
-- from the send path.
REVOKE ALL ON FUNCTION public.campaign_audience(uuid, text, uuid, text, text[], text[], double precision, double precision, double precision, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.count_campaign_recipients(uuid, text, uuid, text, text[], text[], double precision, double precision, double precision, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enqueue_campaign_recipients(uuid, uuid, text, uuid, text, text[], text[], double precision, double precision, double precision, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.campaign_audience(uuid, text, uuid, text, text[], text[], double precision, double precision, double precision, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.count_campaign_recipients(uuid, text, uuid, text, text[], text[], double precision, double precision, double precision, text) TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_campaign_recipients(uuid, uuid, text, uuid, text, text[], text[], double precision, double precision, double precision, text) TO service_role;
