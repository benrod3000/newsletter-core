-- 064: let a capture form deliver a file without subscribing anyone
--
-- Every widget submission added the person to the widget's target list. For a
-- newsletter signup that is the entire point. For a lead magnet it is a different
-- relationship from the one the visitor entered into: someone who asked for a
-- resume asked for a file, not for mail in the future.
--
-- That distinction is worth making explicit rather than picking one globally,
-- because both are legitimate and the builder offers both kinds of widget. A
-- coupon list reasonably keeps you; a resume request reasonably does not.
--
-- **Defaults to false, which changes behaviour for existing widgets.** That is
-- deliberate and safe here: there is exactly one widget in this database and its
-- owner asked for one-time delivery. The default is the recoverable direction -
-- failing to subscribe somebody can be corrected later, mailing somebody who never
-- opted in cannot.
--
-- Note what this does and does not guarantee. It keeps people off the list, which
-- is what list-targeted sending reads. It does not make them unreachable by a
-- campaign aimed at "all confirmed subscribers", because `campaign_audience()`
-- filters on `suppressed` and `confirmed` and not on consent - and it cannot start
-- filtering on consent today, since `consent_email_marketing` defaults to false and
-- 10,301 of 10,307 rows have never had it set, so enforcing it would read as
-- "almost nobody consented" rather than "nobody was asked".

ALTER TABLE public.widgets
  ADD COLUMN IF NOT EXISTS subscribe_to_list BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.widgets.subscribe_to_list IS
  'When true, a submission joins the widget''s target list. When false the widget delivers its file and nothing more. Defaults false: a lead magnet is a fulfilment, not a subscription.';
