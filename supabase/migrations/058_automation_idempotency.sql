-- 058_automation_idempotency.sql
--
-- Makes it impossible for an automation to email the same person twice.
--
-- WHY THIS IS NEEDED BEFORE THE PROCESSOR CAN BE SCHEDULED
--
-- `automation_triggers` has a full CRUD API, so users can create automations,
-- and `/api/admin/automations/process` knows how to run them - but it is not in
-- vercel.json's cron list, so nothing has ever invoked it. Simply adding the
-- cron entry would have been actively harmful, because neither trigger type is
-- idempotent:
--
--   on_schedule       fires when `scheduled_at <= now`, and nothing records that
--                     it fired. Once due, it is due forever - an hourly cron
--                     would re-send to the same 100 subscribers every hour,
--                     indefinitely.
--
--   subscriber_joined selects subscribers created between `now - delay_minutes`
--                     and `now`. Run more often than the delay and the windows
--                     overlap, so a subscriber is emailed once per overlapping
--                     run; run less often and they are missed entirely.
--
-- `automation_logs` was already written after each send, but never read - the
-- record of what had run existed and was ignored.
--
-- APPROACH
--
-- The processor claims a recipient by inserting the log row *before* sending,
-- with ON CONFLICT DO NOTHING. Inserting means the claim was won; zero rows
-- means someone already holds it. That makes the guarantee at-most-once rather
-- than at-least-once, which is the correct direction for email: a duplicate is
-- visible to the recipient and cannot be recalled, a miss is recoverable.
--
-- WHY NULLS NOT DISTINCT, AND NOT TWO PARTIAL INDEXES
--
-- The obvious shape is two partial unique indexes - one on
-- (automation_id, subscriber_id) WHERE subscriber_id IS NOT NULL for
-- per-subscriber triggers, one on (automation_id) WHERE subscriber_id IS NULL
-- for whole-audience ones. That was tried and does not work through PostgREST:
--
--   42P10  there is no unique or exclusion constraint matching the
--          ON CONFLICT specification
--
-- Postgres can only infer a *partial* index if the statement repeats the index
-- predicate, and PostgREST's `on_conflict=` parameter has no way to express one.
-- The failure is quiet in the worst way: the processor treats an unclaimable
-- recipient as already-handled and skips it, so every automation would have
-- silently sent nothing at all.
--
-- One non-partial constraint with NULLS NOT DISTINCT (Postgres 15+, this is 17)
-- covers both cases instead. Ordinarily two null subscriber_ids would not
-- conflict, so a whole-audience trigger could claim itself repeatedly; with
-- NULLS NOT DISTINCT they do conflict, and (automation_id, NULL) is claimable
-- exactly once.

DROP INDEX IF EXISTS public.automation_logs_once_per_subscriber;
DROP INDEX IF EXISTS public.automation_logs_once_per_automation;

ALTER TABLE public.automation_logs
  DROP CONSTRAINT IF EXISTS automation_logs_once_per_target;

ALTER TABLE public.automation_logs
  ADD CONSTRAINT automation_logs_once_per_target
  UNIQUE NULLS NOT DISTINCT (automation_id, subscriber_id);

COMMENT ON CONSTRAINT automation_logs_once_per_target ON public.automation_logs IS
  'Idempotency for automations. The processor inserts here before sending, so a conflict means this recipient was already handled. NULLS NOT DISTINCT so a whole-audience trigger, recorded with a null subscriber_id, can also only claim itself once.';
