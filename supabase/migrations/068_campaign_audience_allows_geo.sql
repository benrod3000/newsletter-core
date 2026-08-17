-- 068: allow the geo audience, and stop patching this constraint one value at a time
--
-- 067 taught `campaigns_audience_check` about lists and claimed_offer. It did not
-- teach it about `geo`, which the audience picker has offered all along as
-- "📍 Geo-Targeted". So the same failure returned a day later wearing different
-- clothes: selecting Geo-Targeted made every save of that draft fail with a 23514,
-- which the route reported as a 500, which the editor showed as nothing happening.
-- The user's report was "my draft isn't being saved" - two layers away from the
-- actual cause.
--
-- `geo` is a real audience. `parseAudience` passes it through untouched and
-- `campaign_audience()` matches none of its audience branches for it, so every
-- subscriber stays eligible and the narrowing comes from the campaign's geo_filter
-- parameters instead. It means "all, within this area".
--
-- The durable half of this fix is not here. `FIXED_AUDIENCES` in
-- src/lib/send-campaign.ts is now the source of truth, both campaign routes validate
-- against it before writing, and a test pins it against the `Audience` type. This
-- constraint is a backstop: it should never be the thing that rejects a value a user
-- chose from a dropdown, because a CHECK violation reaches the client as a 500 with
-- no indication of which column was at fault.

ALTER TABLE public.campaigns DROP CONSTRAINT IF EXISTS campaigns_audience_check;

ALTER TABLE public.campaigns ADD CONSTRAINT campaigns_audience_check CHECK (
  audience IN ('all', 'confirmed', 'pending', 'claimed_offer', 'geo')
  OR audience ~ '^list:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
);

COMMENT ON CONSTRAINT campaigns_audience_check ON public.campaigns IS
  'Backstop only. FIXED_AUDIENCES in src/lib/send-campaign.ts is the source of truth and both campaign routes validate against it before insert, so a bad value is a 400 naming the field rather than a 23514 surfacing as a 500.';
