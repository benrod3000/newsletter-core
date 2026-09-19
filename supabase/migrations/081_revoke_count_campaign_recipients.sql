-- 081_revoke_count_campaign_recipients.sql
--
-- Closes the last SECURITY DEFINER function any signed-in user could call.
--
-- `count_campaign_recipients` arrived with migration 056 and was left executable
-- by `authenticated`, so it was reachable at
-- `/rest/v1/rpc/count_campaign_recipients` by anyone holding a session for any
-- workspace. It takes `p_workspace` as an argument and runs as its definer, so
-- passing somebody else's workspace id returned a count of their audience -
-- narrow, since the answer is a single number rather than rows, but it is still
-- another tenant's number, and it is exactly the shape of leak that RLS exists
-- to prevent.
--
-- Migration 053 revoked public EXECUTE across the SECURITY DEFINER functions of
-- the time and this one was added afterwards, which is the recurring lesson:
-- the grant belongs in the migration that creates the function, not in a
-- sweep later.
--
-- Safe to revoke. Both callers - the audience estimate route and the SMS
-- reachability count - use getSupabaseClient(), the service-role client, and
-- both already pass the workspace explicitly after withWorkspace has proved
-- membership. Nothing reaches this function as `authenticated`.

REVOKE ALL ON FUNCTION public.count_campaign_recipients(
  UUID, TEXT, UUID, TEXT, TEXT[], TEXT[], DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, TEXT
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.count_campaign_recipients(
  UUID, TEXT, UUID, TEXT, TEXT[], TEXT[], DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, TEXT
) TO service_role;
