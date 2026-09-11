-- A third outcome for a claimed recipient: not yet.
--
-- Until now a claimed recipient ended up exactly one of two ways, sent or
-- failed. Quiet hours need a third. The TCPA restricts marketing texts to 8am
-- through 9pm in the RECIPIENT's local time, and a cron draining at a fixed UTC
-- hour lands in the middle of someone's night as a matter of routine rather than
-- as an accident.
--
-- Marking those recipients `failed` would be the easy implementation and the
-- wrong one. `failed` is terminal, the recovery cron does not revisit it, and
-- the person would simply never receive a message they consented to because of
-- what time it happened to be when the job ran.
--
-- So: release the claim and leave the row pending, for the next drain to pick up
-- when the clock has moved.
--
-- `attempts` is decremented, undoing the increment the claim made. Without that,
-- a recipient in an awkward timezone would burn an attempt every run and be
-- permanently exhausted after three passes - blocked by the retry limit from
-- ever being tried at an hour they could actually be reached. The whole point is
-- that deferral is not a failure, so it must not be counted as one.
--
-- The greatest(0, ...) is belt and braces: attempts is NOT NULL with a default
-- of 0, and a deferral always follows a claim, so it should never be at 0 here.
-- If it ever is, clamping beats a constraint violation that aborts the batch.

CREATE OR REPLACE FUNCTION public.defer_campaign_recipients(
  p_job_id      uuid,
  p_subscribers uuid[]
)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH deferred AS (
    UPDATE campaign_job_recipients r
    SET claimed_at = NULL,
        attempts   = greatest(0, r.attempts - 1),
        updated_at = now()
    WHERE r.job_id = p_job_id
      AND r.subscriber_id = ANY(p_subscribers)
      AND r.status = 'pending'
    RETURNING 1
  )
  SELECT COALESCE(count(*), 0)::INTEGER FROM deferred;
$function$;

REVOKE ALL ON FUNCTION public.defer_campaign_recipients(uuid, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.defer_campaign_recipients(uuid, uuid[]) TO service_role;

COMMENT ON FUNCTION public.defer_campaign_recipients(uuid, uuid[]) IS
  'Release a claim without consuming an attempt, so a recipient deferred for quiet hours is retried later rather than exhausted. See migration 076.';
