-- 061_password_reset_tokens.sql
--
-- Adds the columns the password reset flow has always written to and read from.
--
-- Neither `reset_token` nor `reset_token_expires_at` has ever existed on
-- workspace_users. Both routes used raw `fetch` against PostgREST rather than
-- supabase-js, so:
--
--   forgot-password  PATCHed the two columns and never checked the response.
--                    PostgREST answered 400 42703 and the token was never
--                    stored.
--   reset-password   selected on `reset_token=eq.<token>`, which 400'd the same
--                    way, found no user, and reported "invalid or expired reset
--                    token" - for every token, always.
--
-- So password reset has been impossible on two independent counts: the email
-- could not send (no provider configured, fixed separately) and the token could
-- not be stored. Fixing only the email produced exactly the symptom seen: the
-- message arrives, the link never works.
--
-- Worth noting that generated database types did not catch this, because they
-- only constrain supabase-js. Raw `fetch` against the REST API is outside their
-- reach, which is an argument for not using it.
--
-- HASHED, NOT PLAINTEXT
--
-- The column stores a SHA-256 of the token, not the token. A reset token is
-- credential material: anyone holding one can take the account. Storing it in
-- plaintext means read access to this table is account takeover for every user
-- with a reset in flight, and reset tokens are exactly what leaks in a backup or
-- a stray query result.
--
-- The only plaintext copy lives in the email. Verification hashes the incoming
-- token and compares, which is the same reasoning as password_hash beside it.
--
-- These columns are deliberately absent from the column-limited GRANT SELECT
-- that migration 049 gives `authenticated` on workspace_users, which withholds
-- password_hash, totp_secret and recovery_codes for the same reason. A column
-- added later inherits no grant, so this is correct by default - but it is
-- stated here so that a future blanket grant does not quietly expose it.

ALTER TABLE public.workspace_users
  ADD COLUMN IF NOT EXISTS reset_token_hash       TEXT,
  ADD COLUMN IF NOT EXISTS reset_token_expires_at TIMESTAMPTZ;

REVOKE ALL (reset_token_hash, reset_token_expires_at)
  ON public.workspace_users FROM authenticated, anon;

-- The lookup is "find the user holding this hash". Partial because only a
-- handful of rows carry one at any moment.
CREATE INDEX IF NOT EXISTS idx_workspace_users_reset_token_hash
  ON public.workspace_users (reset_token_hash)
  WHERE reset_token_hash IS NOT NULL;

COMMENT ON COLUMN public.workspace_users.reset_token_hash IS
  'SHA-256 of an outstanding password reset token, never the token itself. Cleared when used or expired. Withheld from `authenticated` by column privilege, like password_hash.';

COMMENT ON COLUMN public.workspace_users.reset_token_expires_at IS
  'When the outstanding reset token stops being accepted. Checked on use; an expired row is treated as no token at all.';
