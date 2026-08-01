-- Revoke public EXECUTE on SECURITY DEFINER functions.
--
-- Postgres grants EXECUTE on every new function to PUBLIC by default, and none
-- of these ever revoked it. PostgREST exposes `public` schema functions at
-- /rest/v1/rpc/<name>, and `anon` inherits PUBLIC - so every one of these was
-- callable by anybody holding the anon key, which is published in the browser
-- bundle by design. Being SECURITY DEFINER, they then ran as the owner and
-- bypassed RLS entirely.
--
-- Confirmed against production with nothing but the public anon key:
--
--   POST /rest/v1/rpc/campaign_job_progress  -> 200 [{"pending":0,...}]
--   POST /rest/v1/rpc/create_admin_user      -> PGRST202 (wrong signature)
--
-- The second is the one that matters: PGRST202 means "no function with those
-- arguments", not "permission denied". Called with the right arguments it would
-- have run, so anyone who read the site's JavaScript could mint themselves a
-- platform admin, reset an existing admin's password, or disable one.
--
-- Every call site uses SUPABASE_SERVICE_ROLE_KEY - the admin routes, proxy.ts's
-- auth_admin_login, send-queue.ts, sending-limits.ts - so service_role is the
-- only role that needs EXECUTE. The single RPC issued with the `authenticated`
-- client is nearby_subscribers, which does not exist in this database, so
-- nothing is lost by not granting it.
--
-- service_role inherits PUBLIC too, so the explicit GRANT below is required:
-- without it the revoke would take the application down with the attacker.

DO $$
DECLARE
  fn TEXT;
  service_only TEXT[] := ARRAY[
    'auth_admin_login(text,text)',
    'campaign_job_progress(uuid)',
    'claim_campaign_recipients(uuid,integer,integer,integer)',
    'complete_campaign_recipients(uuid,uuid[],uuid[],text)',
    'create_admin_user(text,text,text,uuid)',
    'create_client_workspace(text,text)',
    'enqueue_campaign_recipients(uuid,uuid,text,uuid,text,text[],text[],double precision,double precision,double precision)',
    'increment_sending_counters(uuid,integer)',
    'reset_admin_user_password(uuid,text)',
    'set_admin_user_active(uuid,boolean)',
    'seed_demo_data(uuid)'
  ];
BEGIN
  FOREACH fn IN ARRAY service_only LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', fn);
  END LOOP;
END $$;

-- current_workspace_id() is deliberately left executable: it is not SECURITY
-- DEFINER, it only reads a claim out of the caller's own JWT, and the RLS
-- policies added in 049 call it on every row. Revoking it would disable the
-- tenant isolation this is meant to protect.

-- Pin search_path on the functions the advisor flagged. A SECURITY DEFINER or
-- trigger function with a mutable search_path can be induced to resolve an
-- unqualified name to an attacker-created object in a schema they control.
-- uuid_generate_v4 is intentionally untouched: it belongs to an extension, and
-- altering extension-owned objects is reverted by the next extension update.
ALTER FUNCTION public.set_updated_at() SET search_path = public, pg_temp;
ALTER FUNCTION public.seed_demo_data(uuid) SET search_path = public, pg_temp;
