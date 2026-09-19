-- 079_widgets_asset_id.sql
--
-- Lets a giveaway point at a file in the workspace's library instead of at a URL
-- the operator hosts themselves.
--
-- WHY NOT JUST WRITE THE ASSET'S URL INTO download_url
--
-- It would work, and it would lose the link between the widget and the library
-- entry. Without that link, deleting a file cannot tell whether a live giveaway
-- still hands it out - and emails already in inboxes keep resolving through
-- /api/track/click forever, so a silent delete breaks the download for everyone
-- who has not claimed yet, after they have already given up their address.
-- A foreign key is what makes that check possible.
--
-- ON DELETE RESTRICT, not CASCADE or SET NULL, for the same reason: the API
-- refuses the delete and names the widget, and this makes that refusal true at
-- the database level rather than only in the route that remembers to check.
--
-- WHY download_url STAYS
--
-- An external URL is still a legitimate answer, and for a large audience it is
-- the better one: hosted downloads draw on this project's shared egress quota,
-- so an operator whose list outgrows it needs somewhere else to point. The two
-- columns are alternatives, not a migration - nothing existing has to move.
--
-- `coupon` widgets are untouched by all of this. They store their value in
-- download_url too, but that value is a discount code printed on the success
-- screen, not a file, so a coupon must never carry an asset_id.

ALTER TABLE public.widgets
  ADD COLUMN IF NOT EXISTS asset_id UUID REFERENCES public.assets(id) ON DELETE RESTRICT;

-- The delete guard reads this on every asset removal, and it is the only query
-- standing between "delete" and a broken giveaway, so it should not be a scan.
CREATE INDEX IF NOT EXISTS idx_widgets_asset ON public.widgets (asset_id) WHERE asset_id IS NOT NULL;

-- A widget offers one thing. Both set would mean the delivery email and the
-- delete guard could disagree about what is being given away.
ALTER TABLE public.widgets
  DROP CONSTRAINT IF EXISTS widgets_one_giveaway_source;
ALTER TABLE public.widgets
  ADD CONSTRAINT widgets_one_giveaway_source
  CHECK (asset_id IS NULL OR download_url IS NULL);

COMMENT ON COLUMN public.widgets.asset_id IS
  'Library file given away by this widget, as an alternative to an external download_url. Never set for coupon widgets, whose download_url is a discount code rather than a file.';
