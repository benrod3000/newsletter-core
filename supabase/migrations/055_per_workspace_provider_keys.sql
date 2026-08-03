-- 055_per_workspace_provider_keys.sql
--
-- Adds the two provider credential columns the application has always believed
-- existed: clients.sendgrid_api_key and clients.resend_api_key.
--
-- WHY THIS IS A BUG FIX AND NOT A FEATURE
--
-- Six call sites already read these columns, and four of them SELECT them by
-- name. PostgREST rejects an unknown column outright, so those four requests
-- have never once succeeded:
--
--   src/lib/send-campaign.ts                       400 42703, error discarded
--   app/api/clients/[id]/test-provider/route.ts    400 42703, surfaced as 500
--   app/api/admin/send/route.ts                    400 42703
--   app/api/admin/campaigns/recover/route.ts       400 42703
--
-- The Settings page has shipped inputs for both keys the whole time. They PUT to
-- the branding endpoint, whose allowlist has no such fields, so the value was
-- dropped on arrival and the user still saw "Branding updated successfully!".
--
-- Consequence worth stating plainly: every SendGrid and Resend workspace has been
-- sending through one shared platform account, and therefore one shared sender
-- reputation. One tenant's spam complaints land on every other tenant. Only SES
-- ever had real per-workspace credentials.
--
-- CREDENTIALS AT REST
--
-- These land as plaintext text columns, protected by column-level privilege
-- exactly as ses_access_key, ses_secret_key and twilio_auth_token already are
-- (migration 049, section 6). That is deliberately consistent with the three
-- credential columns that predate this migration rather than better than them.
--
-- ARCHITECTURE.md's Connection entity calls for encrypted credentials. Doing
-- that here, for two of five columns, would have meant a key-management decision
-- (where the key lives, how it rotates, what reads it) applied inconsistently to
-- half the credentials in the table. Encryption is worth doing as one change
-- across all five columns; it is not worth doing as a side effect of this one.
--
-- SECURITY MODEL
--
-- Both columns are omitted from the GRANT SELECT column list for `authenticated`.
-- 049 established why: RLS cannot help, because the row legitimately belongs to
-- the workspace whose member is asking. A `viewer` holding a scoped token must
-- not be able to read the workspace's sending credentials. Column privileges are
-- the tool that works here.
--
-- Adding a column does not implicitly grant it, so `authenticated` cannot see
-- these by default. The explicit REVOKE below is belt-and-braces against a
-- future blanket `GRANT SELECT ON public.clients` being added upstream of this
-- file, which would otherwise silently expose them.

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS sendgrid_api_key text,
  ADD COLUMN IF NOT EXISTS resend_api_key   text;

REVOKE ALL (sendgrid_api_key, resend_api_key) ON public.clients FROM authenticated, anon;

COMMENT ON COLUMN public.clients.sendgrid_api_key IS
  'Per-workspace SendGrid API key. Withheld from `authenticated` by column privilege; '
  'readable only on service_role paths. Falls back to SENDGRID_API_KEY when null.';

COMMENT ON COLUMN public.clients.resend_api_key IS
  'Per-workspace Resend API key. Withheld from `authenticated` by column privilege; '
  'readable only on service_role paths. Falls back to RESEND_API_KEY when null.';
