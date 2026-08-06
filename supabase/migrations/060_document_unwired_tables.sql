-- 060_document_unwired_tables.sql
--
-- Comments only. No schema change, no behaviour change.
--
-- Three things exist in the schema that nothing uses. Each was found by
-- searching for a reader and not finding one, which is the same method that
-- turned up brand_colors, logo_url, subscriber_notes and nearby_subscribers.
--
-- They are documented rather than dropped, deliberately. Dropping them would
-- discard a modelling decision someone made on purpose, and the tables cost
-- nothing while empty. What they did cost was the next person's time: without
-- these comments, a reader finds `campaign_variants` with is_winner and opens
-- and clicks on it and reasonably concludes that A/B testing works.
--
-- If any of the three is implemented, delete its comment in the same change.

COMMENT ON TABLE public.webhook_configs IS
  'UNWIRED as of 2026-08-05. Nothing reads or writes this table: no UI creates a config, and no code POSTs to a stored url when an event occurs. Making it real needs (1) UI to register an endpoint, (2) a delivery worker with retry and backoff, (3) a per-config signing secret so receivers can verify payloads. Kept rather than dropped so the schema decision is not lost.';

COMMENT ON TABLE public.campaign_variants IS
  'UNWIRED as of 2026-08-05. Zero references anywhere in either repo. A/B testing does not exist in any form despite this table modelling subject, editor_html, opens, clicks, sent_count and is_winner. Making it real needs variant assignment at enqueue time (campaign_audience would split the audience), per-variant tracking attribution, and a winner-selection rule. Kept rather than dropped.';

COMMENT ON COLUMN public.clients.custom_domain IS
  'UNWIRED as of 2026-08-05. Stored and returned by the branding endpoint, but no code reads it to change behaviour - it does not affect sending, tracking links, or the public archive. The Settings input for it was removed so the product stops advertising it. Column kept so any values already saved survive if custom domains are implemented.';
