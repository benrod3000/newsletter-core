-- 083_security_invariants.sql
--
-- The checks that would have caught this month's three security mistakes,
-- written down so they are run rather than remembered.
--
-- Each one exists because it already failed:
--
-- 1. `assets` shipped in migration 078 with no RLS and no grant, so the content
--    library was unreadable. The visible failure was the lucky half: a grant
--    without RLS would have made every workspace's files readable by any
--    signed-in session, with no error at all.
--
-- 2. `count_campaign_recipients` shipped in 056 still executable by
--    `authenticated`. It takes a workspace as an argument and runs as its
--    definer, so any signed-in user could count another tenant's audience.
--    Migration 053 had swept the functions that existed at the time; this one
--    arrived afterwards and nothing re-checked.
--
-- 3. The `assets` bucket is public so downloads stay CDN-cacheable. A public
--    bucket without a MIME allowlist and a size limit is an open file host
--    attached to something that sends email.
--
-- WHY A FUNCTION RATHER THAN A CI STEP
--
-- This repo's CI deliberately holds no real credentials - it builds against
-- throwaway values and talks to nothing live, which is a good rule and not one
-- worth breaking for a linter. So the checks live in the database, where they
-- can be run by `npm run audit:security`, from the SQL editor, or by anyone
-- holding a service key, without a secret being copied anywhere new.
--
-- Supabase's own advisors cover more ground and should still be read. These are
-- the project-specific invariants an advisor cannot know about.

CREATE OR REPLACE FUNCTION public.security_invariants()
RETURNS TABLE (
  severity    TEXT,
  check_name  TEXT,
  object_name TEXT,
  detail      TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- 1. Anything workspace-scoped must be behind RLS with a policy.
  SELECT
    'error'::text,
    'tenant_table_without_rls'::text,
    c.relname::text,
    CASE
      WHEN NOT c.relrowsecurity THEN 'has workspace_id but RLS is disabled'
      ELSE 'RLS is enabled but no policy exists, so it denies everything'
    END
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
    AND EXISTS (
      SELECT 1 FROM information_schema.columns col
      WHERE col.table_schema = 'public'
        AND col.table_name = c.relname
        AND col.column_name = 'workspace_id'
    )
    AND (
      NOT c.relrowsecurity
      OR NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname)
    )

  UNION ALL

  -- 2. A SECURITY DEFINER function runs as its owner, so letting a signed-in
  --    role call one that takes a workspace argument is a cross-tenant read.
  SELECT
    'error'::text,
    'security_definer_callable_by_client'::text,
    p.proname::text,
    'executable by ' || r.rolname || '; revoke it or make the function SECURITY INVOKER'
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r(rolname)
  WHERE n.nspname = 'public'
    AND p.prosecdef
    AND has_function_privilege(r.rolname, p.oid, 'EXECUTE')

  UNION ALL

  -- 3. A public bucket with no allowlist is an open file host.
  SELECT
    'error'::text,
    'public_bucket_unconstrained'::text,
    b.id::text,
    CASE
      WHEN b.allowed_mime_types IS NULL THEN 'public bucket with no MIME allowlist'
      ELSE 'public bucket with no file size limit'
    END
  FROM storage.buckets b
  WHERE b.public
    AND (b.allowed_mime_types IS NULL OR b.file_size_limit IS NULL)

  UNION ALL

  -- 4. Executable content in a public bucket, which the app's own allowlist
  --    excludes but the bucket is the thing that actually enforces.
  SELECT
    'error'::text,
    'public_bucket_allows_scriptable_type'::text,
    b.id::text,
    'allows ' || t.mime || ', which can carry script'
  FROM storage.buckets b
  CROSS JOIN (VALUES ('image/svg+xml'), ('text/html'), ('application/javascript')) AS t(mime)
  WHERE b.public
    AND b.allowed_mime_types IS NOT NULL
    AND t.mime = ANY (b.allowed_mime_types);
$$;

REVOKE ALL ON FUNCTION public.security_invariants() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.security_invariants() TO service_role;

COMMENT ON FUNCTION public.security_invariants() IS
  'Project-specific security checks: tenant tables without RLS, SECURITY DEFINER functions callable by anon/authenticated, and unconstrained public storage buckets. Returns one row per finding; no rows means clean. Run after every migration.';
