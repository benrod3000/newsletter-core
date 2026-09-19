-- 080_assets_rls.sql
--
-- Gives `assets` the tenancy enforcement every other workspace-scoped table
-- already has. Migration 078 created the table and forgot it.
--
-- WHAT BROKE
--
-- The content library rendered "Could not load your library" for every
-- workspace. `withWorkspace` hands routes a client built from the anon key plus
-- a minted workspace token, so it queries as `authenticated` - and 078 granted
-- that role nothing on `assets`, so every read was permission denied before it
-- could return a row.
--
-- WHAT WOULD HAVE BEEN WORSE
--
-- The visible failure was the lucky outcome. Had the grant existed without RLS,
-- the table would have been readable by any authenticated session regardless of
-- workspace, which is a cross-tenant leak rather than an error message. Grant
-- and policy belong in the same migration as the table for exactly that reason:
-- they are not two steps, they are one.
--
-- This is the pattern established in 049 for the original thirteen tenant
-- tables, applied verbatim. Any future workspace-scoped table needs the same
-- three statements in the migration that creates it.

GRANT SELECT, INSERT, UPDATE, DELETE ON public.assets TO authenticated;

ALTER TABLE public.assets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS assets_workspace_isolation ON public.assets;
CREATE POLICY assets_workspace_isolation ON public.assets
  FOR ALL TO authenticated
  USING (workspace_id = public.current_workspace_id())
  WITH CHECK (workspace_id = public.current_workspace_id());

COMMENT ON POLICY assets_workspace_isolation ON public.assets IS
  'Workspace isolation for the content library, matching the policy 049 applies to every other tenant table.';
