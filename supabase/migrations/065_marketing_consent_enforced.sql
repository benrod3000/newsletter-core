-- 065: make marketing consent mean something
--
-- `subscribers.consent_email_marketing` was written at signup, revoked on
-- unsubscribe, and included in the CSV export - and read by no send path.
-- `campaign_audience()` filtered on `suppressed` and `confirmed` only, so the
-- column recorded a decision the system then ignored.
--
-- Enforcing it looked like a one-line change and would have been a disaster. The
-- column defaults to false and the CSV importer never set it, so 10,300 of 10,307
-- rows read "no consent" when they meant "never asked". Switching the filter on
-- without the backfill below would have cut the sendable audience from 10,306 to
-- six, silently, and the first symptom would have been a campaign that appeared to
-- send and reached almost nobody.
--
-- Two halves, and both have to land together:
--
-- 1. Backfill. Every existing row that has not opted out is marked consented. They
--    are recorded as `import:backfill-065` rather than left blank, so the record
--    says how consent was established rather than implying an opt-in that never
--    happened. Rows already suppressed are left alone - an opt-out is not
--    overwritten by a backfill, ever.
--
-- 2. The predicate. `campaign_audience()` gains
--    `AND s.consent_email_marketing = true`.
--
-- After this, an unconsented subscriber is genuinely unreachable by campaign
-- sending, which is what makes a one-time capture form (migration 064) actually
-- one-time rather than a promise the send path ignores.
--
-- The matching application change is that the CSV importer now records consent
-- explicitly from an operator attestation instead of leaving it to the default.
-- Without that, every future import would produce silently unsendable rows - the
-- same class of failure this migration exists to end, pointing the other way.

-- 1. Backfill.
UPDATE public.subscribers
SET consent_email_marketing = true,
    consented_at = COALESCE(consented_at, created_at, now()),
    consent_source = COALESCE(consent_source, 'import:backfill-065'),
    consent_text = COALESCE(
      consent_text,
      'Consent recorded retrospectively for contacts added before consent was tracked at import.'
    )
WHERE consent_email_marketing = false
  AND suppressed = false;

-- 2. Enforce it.
CREATE OR REPLACE FUNCTION public.campaign_audience(
  p_workspace uuid,
  p_audience text DEFAULT 'confirmed'::text,
  p_list_id uuid DEFAULT NULL::uuid,
  p_country text DEFAULT NULL::text,
  p_regions text[] DEFAULT NULL::text[],
  p_cities text[] DEFAULT NULL::text[],
  p_center_lat double precision DEFAULT NULL::double precision,
  p_center_lng double precision DEFAULT NULL::double precision,
  p_radius_km double precision DEFAULT NULL::double precision
)
RETURNS TABLE(subscriber_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT s.id
  FROM subscribers s
  WHERE s.workspace_id = p_workspace
    AND s.suppressed = false
    -- Added by 065. Read the migration header before removing it: the column is
    -- only meaningful because the backfill there gave it a value everywhere.
    AND s.consent_email_marketing = true
    AND s.email IS NOT NULL
    AND s.email <> ''
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
