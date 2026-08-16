-- 067: let a campaign target a list, which every other layer already believed it could
--
-- `campaigns_audience_check` allowed exactly 'all', 'confirmed' and 'pending'. It was
-- written before lists and the claimed-offer audience existed and was never revisited,
-- so the database has been rejecting audiences the rest of the stack fully supports:
--
--   - the audience picker offers every list under a "Custom Lists" optgroup and
--     submits `list:<uuid>`
--   - `send-queue.ts` parses exactly that prefix to resolve the list
--   - `Audience` in send-campaign.ts is typed ``"all" | "confirmed" | "pending" |
--     "claimed_offer" | `list:${string}` ``
--   - `campaign_audience()` implements both the list filter and claimed_offer
--   - the route's own docblock documents all five
--
-- Only the CHECK disagreed, and it is the one that runs. Selecting a list produced a
-- 23514 on insert, surfaced as "Failed to create campaign" - a 500 with no indication
-- that the audience was the problem, which is why it read as the campaign feature
-- being broken rather than one stale constraint.
--
-- Nobody had hit it before because nothing had ever been sent to a list.
--
-- The list form is matched by shape rather than accepted as free text: `list:` plus a
-- uuid. A CHECK cannot verify the list exists - that is the send path's job, and
-- send-queue already resolves it - but it can stop `list:` and `list:whatever` being
-- stored, which would fail later and further from the cause.

ALTER TABLE public.campaigns DROP CONSTRAINT IF EXISTS campaigns_audience_check;

ALTER TABLE public.campaigns ADD CONSTRAINT campaigns_audience_check CHECK (
  audience IN ('all', 'confirmed', 'pending', 'claimed_offer')
  OR audience ~ '^list:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
);

COMMENT ON CONSTRAINT campaigns_audience_check ON public.campaigns IS
  'Keep in step with the Audience type in src/lib/send-campaign.ts and the parser in send-queue.ts. Adding an audience there without adding it here rejects it at insert with a 23514.';
