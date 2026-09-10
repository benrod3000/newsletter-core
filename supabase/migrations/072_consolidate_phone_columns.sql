-- One phone column, in one format.
--
-- `subscribers` carried both `phone` and `phone_number`, and the two halves of
-- the application used different ones:
--
--   phone_number   written by the dashboard add-contact route, the CSV importer
--                  and the homepage signup form; read by the {{phone_number}}
--                  merge tag, the CSV export, the admin table and the public web
--                  version of a campaign.
--   phone          written only by the widget form submit route; read by every
--                  SMS path - the campaign send, the SMS analytics count and the
--                  STOP webhook.
--
-- In production `phone_number` held 10,300 rows and `phone` held none. So every
-- SMS query matched nobody, and would have kept matching nobody however many
-- contacts were added, because the paths that collect numbers at scale wrote the
-- column SMS never read. Nothing errored and nothing failed a type check: both
-- columns existed, so both spellings were valid.
--
-- This is the same shape as the client_id to workspace_id rename leaving its
-- consumers behind, except that here both names stayed alive, so there was no
-- 400 to notice.
--
-- `phone_number` is the survivor: it holds the data, it matches the merge tag and
-- the CSV header, and `claim_campaign_recipients` already returns it.
--
-- ORDER MATTERS. The code that writes and reads `phone` must be deployed away
-- from it BEFORE this runs. `app/api/public/forms/[id]/submit/route.ts` is a live
-- public endpoint with real submissions, so dropping the column under the running
-- version would 400 every widget signup. Deploy first, then apply this.

-- 1. Rescue anything the widget wrote before the repointed code went live.
--    A no-op the moment the deploy lands (`phone` was empty in production when
--    this was written), but the window between deploy and migration is exactly
--    when a submission could land in the old column.
UPDATE subscribers
   SET phone_number = phone
 WHERE phone IS NOT NULL
   AND (phone_number IS NULL OR phone_number = '');

-- 2. Normalize what survived to E.164, so the format matches what every writer
--    now stores and the STOP webhook can match a number exactly instead of by
--    trailing wildcard.
--
--    Deliberately narrow: it only handles North American 10 and 11 digit numbers
--    and values that are already international. Anything else is left as-is
--    rather than guessed at, because a wrong number is worse than an unreadable
--    one - it texts a stranger. `src/lib/phone.ts` is the real normalizer and it
--    runs on every write from here on; this statement only exists to tidy rows
--    that predate it.
UPDATE subscribers
   SET phone_number = CASE
     WHEN regexp_replace(phone_number, '\D', '', 'g') ~ '^1[0-9]{10}$'
       THEN '+' || regexp_replace(phone_number, '\D', '', 'g')
     WHEN regexp_replace(phone_number, '\D', '', 'g') ~ '^[0-9]{10}$'
       THEN '+1' || regexp_replace(phone_number, '\D', '', 'g')
     ELSE phone_number
   END
 WHERE phone_number IS NOT NULL
   AND phone_number !~ '^\+[1-9][0-9]{7,14}$'
   AND regexp_replace(phone_number, '\D', '', 'g') ~ '^1?[0-9]{10}$';

-- 3. Drop the loser.
ALTER TABLE subscribers DROP COLUMN IF EXISTS phone;

COMMENT ON COLUMN subscribers.phone_number IS
  'E.164 only (+15125550199). Normalized on write by toE164() in src/lib/phone.ts; '
  'null when a number could not be resolved, never a best guess. Was split across '
  'a second `phone` column until migration 072.';
