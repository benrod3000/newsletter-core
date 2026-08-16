-- 066: honour an opt-out that arrives while a campaign is still sending
--
-- `enqueue_campaign_recipients` snapshots the audience through `campaign_audience()`,
-- which filters suppressed and (since 065) unconsented subscribers. That is correct
-- at the moment of enqueue and says nothing about the moment of send.
--
-- `claim_campaign_recipients` then joined `subscribers` purely to read the address
-- and merge fields, with no filter at all. So the queue was authoritative and the
-- subscriber's current state was ignored.
--
-- The gap is not theoretical, because sends are not instantaneous. Recipients drain
-- in batches of 100, and Vercel's Hobby plan caps cron frequency at once per day, so
-- a large campaign is in flight for hours or days. Anyone who unsubscribes in that
-- window was still mailed: their opt-out took effect for the *next* campaign and not
-- for the one already addressed to them. That is the reading of CAN-SPAM that matters
-- - an opt-out is not a scheduling preference - and it is precisely the hole the
-- suppression work was meant to close. `suppressed` had readers in campaign_audience,
-- the widget submit path, automations, auto-clean, confirm-remind and the SMS path,
-- and none in the one function that actually hands an address to a provider.
--
-- Rather than filter them out silently, rows whose subscriber has since opted out are
-- retired as `failed` with a reason. Three things follow from that: they leave the
-- pending set, so the job still completes rather than retrying them until attempts
-- run out; the count of who was skipped and why is answerable afterwards; and the
-- send loop needs no change, because it only ever sends what it is handed.
--
-- The signature is unchanged - send-queue.ts calls this by name with these arguments.

CREATE OR REPLACE FUNCTION public.claim_campaign_recipients(
  p_job_id uuid,
  p_limit integer DEFAULT 100,
  p_max_attempts integer DEFAULT 3,
  p_stale_seconds integer DEFAULT 300
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
  city text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Retire anyone who has opted out since this job was enqueued, before claiming.
  -- Bounded to this job, and cheap: it only touches rows still pending.
  UPDATE campaign_job_recipients r
  SET status     = 'failed',
      error      = 'Opted out after this campaign was queued',
      updated_at = now()
  FROM subscribers s
  WHERE r.job_id = p_job_id
    AND r.status = 'pending'
    AND s.id = r.subscriber_id
    AND (s.suppressed = true OR s.consent_email_marketing = false);

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
         s.city
  FROM claimed cl
  JOIN subscribers s ON s.id = cl.sid
  -- Belt and braces. The UPDATE above should have removed every such row from the
  -- pending set already, but this function is the last thing standing between an
  -- opt-out and an email, so it does not rely on that.
  WHERE s.suppressed = false
    AND s.consent_email_marketing = true;
END;
$function$;
