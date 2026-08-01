-- Widgets: add the two columns the API has been writing all along, plus a
-- place to put feedback text.
--
-- `size` and `collect_location` are sent by the dashboard on every save, are
-- inserted by POST /api/clients/[workspaceId]/widgets, and sit in the update
-- route's ALLOWED_FIELDS - but neither column has ever existed and no migration
-- ever created them. PostgREST rejects the whole statement with PGRST204
-- ("Could not find the 'size' column of 'widgets' in the schema cache"), so
-- widget creation and editing have both returned 500 unconditionally. That is
-- why the widgets table is empty.
--
-- The public form already reads both: it sizes its layout from `size` and
-- gates the geolocation prompt on `collect_location !== false`. Adding the
-- columns is what makes the existing UI and rendering code true, rather than
-- stripping working UI to match an incomplete schema.

ALTER TABLE widgets
  ADD COLUMN IF NOT EXISTS size TEXT NOT NULL DEFAULT 'medium',
  ADD COLUMN IF NOT EXISTS collect_location BOOLEAN NOT NULL DEFAULT true;

-- The renderer only understands these three; anything else silently falls back
-- to medium, which would look like the setting was ignored.
ALTER TABLE widgets
  DROP CONSTRAINT IF EXISTS widgets_size_check;
ALTER TABLE widgets
  ADD CONSTRAINT widgets_size_check CHECK (size IN ('small', 'medium', 'large'));

-- Feedback widgets render a message textarea and the client posts `message`,
-- but the submit route never read it and there was nowhere to put it, so every
-- feedback submission recorded an email and discarded the actual feedback.
ALTER TABLE widget_submissions
  ADD COLUMN IF NOT EXISTS message TEXT;
