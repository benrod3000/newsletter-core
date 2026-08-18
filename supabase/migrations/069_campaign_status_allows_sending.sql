-- Allow campaigns.status = 'sending'.
--
-- The application has been writing this value since the partial-send handling
-- was added, and the constraint has never permitted it:
--
--   CHECK (status = ANY (ARRAY['draft', 'scheduled', 'sent']))
--
-- /api/admin/campaigns/process sets `status: finished ? "sent" : "sending"`
-- after a drain. Any campaign too large to finish inside one invocation
-- therefore hit a CHECK violation on the status update, which the route caught
-- and recorded as a send failure - after the mail for that batch had already
-- gone out. The recipients were sent to, the campaign was reported as failed,
-- and `sent_count` was never written, so a retry had nothing to tell it the
-- batch was already delivered.
--
-- It went unnoticed because no campaign has yet been large enough to exhaust the
-- time budget in one run; every send so far finished and took the 'sent' branch.
--
-- 'sending' is a real state in this system - it is what distinguishes "the drain
-- ran out of time and recovery will continue" from "complete", and the campaign
-- send route relies on it to claim a campaign so two concurrent requests cannot
-- queue the same audience twice.

ALTER TABLE campaigns DROP CONSTRAINT IF EXISTS campaigns_status_check;

ALTER TABLE campaigns
  ADD CONSTRAINT campaigns_status_check
  CHECK (status = ANY (ARRAY['draft'::text, 'scheduled'::text, 'sending'::text, 'sent'::text]));
