-- 062: let a capture form's delivery email be edited
--
-- The lead magnet email was hardcoded in src/lib/email/lead-magnet.ts, so the
-- subject and body were the same for every widget in every workspace. The widget
-- already owns every other word a visitor reads - headline, description,
-- button_text, success_message - and had no say in the one message it actually
-- sends. An operator asking "how do I edit this email" had no answer.
--
-- Both columns are nullable on purpose. NULL means "use the built-in copy", which
-- is what every existing widget wants, so this needs no backfill and cannot break
-- a send in flight. `sendLeadMagnetEmail` falls back to its current wording
-- whenever a column is empty.
--
-- email_body holds the operator's text. The download link is inserted where they
-- write {{download_link}}; if they omit it, the sender appends the button rather
-- than sending a message with no way to get the file. That merge tag is the only
-- one supported here - this is a short fulfilment email, not a campaign - and the
-- body is escaped and linkified by the sender, never interpolated as raw HTML,
-- because widget config is editable by any workspace member.

ALTER TABLE public.widgets
  ADD COLUMN IF NOT EXISTS email_subject TEXT,
  ADD COLUMN IF NOT EXISTS email_body TEXT;

COMMENT ON COLUMN public.widgets.email_subject IS
  'Subject of the lead magnet delivery email. NULL uses the built-in copy in src/lib/email/lead-magnet.ts.';

COMMENT ON COLUMN public.widgets.email_body IS
  'Body of the lead magnet delivery email, plain text. {{download_link}} marks where the tracked download button goes; if absent the sender appends it. NULL uses the built-in copy.';
