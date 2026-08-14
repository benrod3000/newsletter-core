-- 063: a headline for the capture form's delivery email
--
-- 062 gave the email an editable subject and body. What it could not express is the
-- part that carries the most weight visually: the large condensed headline at the
-- top of the message ("THANKS FOR YOUR INTEREST."), which is neither the subject
-- line nor a paragraph of the body.
--
-- Without it the headline was generated as "Here's <widget title>", so an operator
-- could rewrite every word of the email except the biggest one on the screen.
--
-- Nullable, like the other two: NULL falls back to the generated wording, so no
-- existing widget changes and nothing needs backfilling.

ALTER TABLE public.widgets
  ADD COLUMN IF NOT EXISTS email_heading TEXT;

COMMENT ON COLUMN public.widgets.email_heading IS
  'Large headline at the top of the lead magnet delivery email. NULL falls back to "Here''s <title>".';
