-- 046_restore_service_role_grants.sql
--
-- Restore table/sequence privileges for service_role, which every backend
-- route depends on (all Supabase access goes through raw REST calls using
-- SUPABASE_SERVICE_ROLE_KEY - the app never uses the anon/publishable key).
--
-- Discovered 2026-07-26 when signup started failing with
-- 42501 "permission denied for table workspace_users". Every table in
-- public had a NULL relacl and no pg_default_acl entry - not something any
-- migration in this repo ever set, so these were established at the
-- platform level and were lost, most likely by a `supabase db reset` or
-- branch operation run against the linked remote project rather than a
-- local dev instance.
--
-- Scoped to service_role only, not anon/authenticated: several tables have
-- RLS enabled with no policies defined (admin_users, campaign_job_recipients,
-- campaigns, clients, subscribe_attempts, subscribers, workspace_users), so
-- granting those roles table access without policies to gate it would be a
-- real exposure for a capability this app doesn't use.
--
-- The ALTER DEFAULT PRIVILEGES statements are the actual fix for recurrence:
-- they apply to tables/sequences postgres creates from here on, so a future
-- migration that adds a table doesn't silently need its own GRANT line.

GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;
