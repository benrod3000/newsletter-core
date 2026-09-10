-- `channel` on the delivery pipeline, so one queue can carry more than email.
--
-- The email path is a durable queue: per-recipient rows, a FOR UPDATE SKIP
-- LOCKED claim, consent re-checked at dispatch, a recovery job for interrupted
-- drains. SMS had none of it - it sent in a `for` loop inside a request handler
-- with no job, no per-recipient state and no idempotency, which is why it was
-- switched off rather than shipped.
--
-- Rather than harden a second pipeline, SMS moves onto this one. Everything the
-- queue does is already channel-agnostic; what was hardcoded to email is the
-- eligibility predicate, the claim's opt-out recheck and the message body. This
-- migration adds the discriminator; 074 and 075 handle the two functions.
--
-- The naming follows the agreed architecture direction: channel is a PROPERTY,
-- never part of an event or table name. `message.sent` with `channel: 'sms'`,
-- not `sms.sent`. Channel-in-the-name forces every future consumer to enumerate
-- channels, and that is the decision that is expensive to reverse.

-- --- campaigns ---

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'email';

ALTER TABLE campaigns
  DROP CONSTRAINT IF EXISTS campaigns_channel_check;
ALTER TABLE campaigns
  ADD CONSTRAINT campaigns_channel_check CHECK (channel IN ('email', 'sms'));

-- The SMS body, kept separate from `editor_html` and `plain_text` rather than
-- overloading them.
--
-- This is the per-channel variant hook from the architecture direction, at its
-- cheapest: one campaign row carries one body per channel, so authoring a
-- message for two channels is one object rather than two campaigns that can
-- drift. Adding RCS later is another nullable column here, not a reshape.
ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS sms_body TEXT;

-- An SMS campaign with no body is not sendable, and the failure should happen at
-- write time with a name attached rather than at drain time across a partially
-- claimed audience.
--
-- `subject` and `editor_html` stay NOT NULL: they already have defaults for
-- every existing row, and an SMS campaign simply leaves them empty. Relaxing
-- them would let an email campaign be created with no subject, which is a
-- regression to buy nothing.
ALTER TABLE campaigns
  DROP CONSTRAINT IF EXISTS campaigns_sms_body_required;
ALTER TABLE campaigns
  ADD CONSTRAINT campaigns_sms_body_required
  CHECK (channel <> 'sms' OR (sms_body IS NOT NULL AND length(trim(sms_body)) > 0));

-- --- campaign_jobs ---

-- Denormalized from `campaigns` on purpose.
--
-- Two reasons. The drain and the recovery cron both need to know how to send
-- before they load anything else, and a job whose channel is read through a join
-- can disagree with what was actually enqueued if the campaign is edited
-- mid-drain. The job records what it was queued as; the campaign records what it
-- is now.
ALTER TABLE campaign_jobs
  ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'email';

ALTER TABLE campaign_jobs
  DROP CONSTRAINT IF EXISTS campaign_jobs_channel_check;
ALTER TABLE campaign_jobs
  ADD CONSTRAINT campaign_jobs_channel_check CHECK (channel IN ('email', 'sms'));

-- --- campaign_events ---

ALTER TABLE campaign_events
  ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'email';

ALTER TABLE campaign_events
  DROP CONSTRAINT IF EXISTS campaign_events_channel_check;
ALTER TABLE campaign_events
  ADD CONSTRAINT campaign_events_channel_check CHECK (channel IN ('email', 'sms'));

-- An SMS event has no email address, so the column cannot stay required.
--
-- The destination is not stored in its place. `subscriber_id` already identifies
-- who was reached, and putting a phone number in a column called `email` is the
-- naming lie that made `client_id` survive its own rename for weeks. Anything
-- needing the address joins `subscribers`.
--
-- READERS AUDITED, because relaxing NOT NULL is safe for writers and quietly
-- wrong for readers. Three computed unique opens and clicks with
-- `new Set(rows.map(r => r.email))`, which collapses every null into a single
-- member: a channel with no addresses would have reported exactly one unique
-- open however many people opened it. All three now key on `subscriber_id` with
-- an email fallback for legacy rows:
--
--   app/api/clients/[workspaceId]/analytics/route.ts
--   app/api/admin/campaigns/route.ts
--   app/api/admin/campaigns/[id]/report/route.ts
--
-- `analytics/live/route.ts` also selects it, but only passes it through for
-- display, where a null is correct.
ALTER TABLE campaign_events ALTER COLUMN email DROP NOT NULL;

-- Analytics reads are per workspace and per channel from here on.
CREATE INDEX IF NOT EXISTS campaign_events_workspace_channel_idx
  ON campaign_events (workspace_id, channel, occurred_at DESC);

COMMENT ON COLUMN campaigns.channel IS
  'Delivery channel: email or sms. A property, never part of a name - see migration 073.';
COMMENT ON COLUMN campaigns.sms_body IS
  'Plain-text SMS body with merge tags. Required when channel = sms, ignored otherwise.';
COMMENT ON COLUMN campaign_jobs.channel IS
  'Copied from the campaign at enqueue time so a mid-drain edit cannot change how a queued job sends.';
COMMENT ON COLUMN campaign_events.email IS
  'Email address for email events, null for every other channel. Join subscribers for the destination.';
