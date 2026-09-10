-- The send-time opt-out recheck learns about channels.
--
-- `claim_campaign_recipients` does two things with consent, and migration 066
-- added both for a good reason: enqueue snapshots the audience, drains span days
-- on a daily cron, and anyone who unsubscribed in between was still being sent
-- to. So the claim retires opted-out rows as `failed` with a reason, and filters
-- them out of what it hands back.
--
-- Both checks read `consent_email_marketing`, hardcoded. For an SMS job that is
-- wrong in both directions, and the first one is destructive:
--
--   1. The retiring UPDATE would mark every SMS recipient who has not separately
--      given EMAIL consent as "Opted out after this campaign was queued". For a
--      workspace collecting SMS consent through a widget, that is most of the
--      audience, and it is written as `failed` - a terminal state the recovery
--      cron does not retry. An SMS campaign would quietly retire its own
--      recipients and report a completed send to nobody.
--
--   2. The returning SELECT would keep texting someone who replied STOP, as long
--      as they still had email consent. STOP is a legal instruction, and honouring
--      it is not optional.
--
-- This was missed when the work was planned. The plan said this function needed
-- no change because it already returns `phone_number`, which is true and
-- irrelevant: what it returns was never the problem, what it filters on was. The
-- general lesson is the one already learned from the NOT NULL migrations - a
-- function's signature tells you nothing about the assumptions in its body, so
-- read the body.
--
-- `p_channel` is appended so existing positional calls keep working, and it
-- defaults to 'email' so an un-migrated caller behaves exactly as before.

DROP FUNCTION IF EXISTS public.claim_campaign_recipients(uuid, integer, integer, integer);

CREATE FUNCTION public.claim_campaign_recipients(
  p_job_id        uuid,
  p_limit         integer DEFAULT 100,
  p_max_attempts  integer DEFAULT 3,
  p_stale_seconds integer DEFAULT 300,
  p_channel       text DEFAULT 'email'
)
RETURNS TABLE(
  subscriber_id uuid,
  email text,
  unsubscribe_token text,
  first_name text,
  last_name text,
  date_of_birth text,
  phone_number text,
  country text,
  region text,
  city text,
  timezone text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Retire anyone who opted out of THIS channel since the audience was snapshot.
  UPDATE campaign_job_recipients r
  SET status     = 'failed',
      error      = 'Opted out after this campaign was queued',
      updated_at = now()
  FROM subscribers s
  WHERE r.job_id = p_job_id
    AND r.status = 'pending'
    AND s.id = r.subscriber_id
    AND (
      s.suppressed = true
      OR CASE p_channel
           WHEN 'email' THEN s.consent_email_marketing = false
           WHEN 'sms'   THEN s.sms_consent = false
           -- An unknown channel retires nobody. Failing closed here would mark a
           -- whole audience terminally failed over a typo, and `failed` is not a
           -- state the recovery cron walks back.
           ELSE false
         END
    );

  RETURN QUERY
  WITH candidate AS (
    SELECT r.subscriber_id AS sid
    FROM campaign_job_recipients r
    WHERE r.job_id = p_job_id
      AND r.status = 'pending'
      AND r.attempts < p_max_attempts
      AND (r.claimed_at IS NULL
           OR r.claimed_at < now() - make_interval(secs => p_stale_seconds))
    ORDER BY r.subscriber_id
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  ), claimed AS (
    UPDATE campaign_job_recipients r
    SET claimed_at = now(),
        attempts   = r.attempts + 1,
        updated_at = now()
    FROM candidate c
    WHERE r.job_id = p_job_id AND r.subscriber_id = c.sid
    RETURNING r.subscriber_id AS sid
  )
  SELECT s.id,
         s.email,
         s.unsubscribe_token::TEXT,
         s.first_name,
         s.last_name,
         s.date_of_birth::TEXT,
         s.phone_number,
         s.country,
         s.region,
         s.city,
         -- Added for the quiet-hours gate in M4: TCPA restricts marketing
         -- messages to 8am through 9pm in the RECIPIENT's local time, so the
         -- drain needs their timezone at the moment it decides to send.
         s.timezone
  FROM claimed cl
  JOIN subscribers s ON s.id = cl.sid
  WHERE s.suppressed = false
    AND CASE p_channel
          WHEN 'email' THEN s.consent_email_marketing = true
          WHEN 'sms'   THEN s.sms_consent = true
          -- Unknown channel reaches nobody, matching campaign_audience().
          ELSE false
        END;
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_campaign_recipients(uuid, integer, integer, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_campaign_recipients(uuid, integer, integer, integer, text) TO service_role;
