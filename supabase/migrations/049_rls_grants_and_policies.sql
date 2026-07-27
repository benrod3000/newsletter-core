-- 049_rls_grants_and_policies.sql
--
-- Turn tenant isolation from a convention into a database guarantee.
--
-- WHAT WAS ACTUALLY TRUE BEFORE THIS MIGRATION:
-- seven tables had `rls_enabled = true` and ZERO policies, and every request
-- reached Postgres as `service_role`, which has rolbypassrls = true. So RLS
-- blocked nothing for the application (bypassed) and everything for everyone else
-- (no policies). It looked like a control and was not one. Isolation rested
-- entirely on 94 route handlers each remembering to filter.
--
-- HOW ENFORCEMENT ACTUALLY HAPPENS NOW:
-- withWorkspace() verifies the session, resolves the workspace from the request
-- path, checks real membership in workspace_users, and only then mints a
-- short-lived HS256 token carrying `role: authenticated` and `workspace_id`.
-- PostgREST applies that role per request. `authenticated` has
-- rolbypassrls = false, so the policies below genuinely constrain it.
--
-- The ordering property that makes this sound: the database credential is derived
-- AFTER authorization, so it cannot carry a workspace the caller is not a member
-- of. There is no code path that mints a token first and checks later.
--
-- THIS MIGRATION IS SAFE TO APPLY ON ITS OWN, AHEAD OF THE CODE. Existing routes
-- still connect as service_role and still bypass every policy here, so behaviour
-- is unchanged until a route is converted. Enforcement switches on per route.

-- ---------------------------------------------------------------------------
-- 1. The tenancy accessor.
--
-- Reads the workspace claim out of the request JWT. Fail-closed by construction:
-- a missing, empty or malformed claim yields NULL, and `workspace_id = NULL` is
-- NULL, not true, so a token without a valid claim sees zero rows rather than all
-- of them. search_path is pinned so the function cannot be redirected.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.current_workspace_id()
RETURNS UUID
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT NULLIF(
    COALESCE(
      NULLIF(current_setting('request.jwt.claims', true), ''),
      '{}'
    )::jsonb ->> 'workspace_id',
    ''
  )::uuid
$$;

COMMENT ON FUNCTION public.current_workspace_id() IS
  'Workspace of the current request, from the JWT claim. NULL when absent or '
  'malformed, which makes every policy below deny by default.';

-- ---------------------------------------------------------------------------
-- 2. Remove the existing permissive policies on workspace_users.
--
-- Migration 018 created four policies of the form USING (true) for role `public`,
-- with a comment saying the backend would be unrestricted "for now". They are
-- harmless today only because `authenticated` holds no grant on the table. The
-- moment this migration grants one, USING (true) would expose every workspace's
-- rows - including password_hash, totp_secret and recovery_codes - to any holder
-- of the public anon key. They are replaced, not extended.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS workspace_users_select ON workspace_users;
DROP POLICY IF EXISTS workspace_users_insert ON workspace_users;
DROP POLICY IF EXISTS workspace_users_update ON workspace_users;
DROP POLICY IF EXISTS workspace_users_delete ON workspace_users;

-- ---------------------------------------------------------------------------
-- 3. Baseline: nothing is reachable by the browser-facing roles unless this
--    migration grants it explicitly.
--
--    `anon` is never granted anything. Unauthenticated public surfaces (subscribe,
--    tracking pixels, provider webhooks, hosted archive pages) run server-side
--    through service_role and do their own checks; none of them needs a direct
--    database role.
--
--    Default privileges are deliberately NOT set for `authenticated`. A table
--    added in a future migration must be classified and granted on purpose, and
--    until then it is unreachable. Deny-by-default is the correct posture for the
--    role that customer requests actually run as. (Migration 046 does set default
--    privileges for service_role, which is the system identity - that stays.)
-- ---------------------------------------------------------------------------

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;

-- Sequence access is required for INSERT on the bigserial-keyed tables
-- (subscriber_list_memberships, automation_logs).
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. Tenant data tables: full CRUD, constrained to one workspace by policy.
-- ---------------------------------------------------------------------------

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'subscribers',
    'campaigns',
    'campaign_jobs',
    'campaign_job_recipients',
    'campaign_variants',
    'campaign_templates',
    'subscriber_lists',
    'subscriber_list_memberships',
    'subscriber_tags',
    'saved_segments',
    'automation_triggers',
    'widgets',
    'webhook_configs'
  ] LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_workspace_isolation', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated '
      'USING (workspace_id = public.current_workspace_id()) '
      'WITH CHECK (workspace_id = public.current_workspace_id())',
      t || '_workspace_isolation', t
    );
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 5. Append-only tables: SELECT and INSERT, never UPDATE or DELETE.
--
--    Invariant 5 says nothing with compliance meaning is deleted. Withholding the
--    privilege is how that becomes true rather than aspirational: no application
--    bug, and no compromised session, can rewrite history through this role.
--    Retention and erasure run as service_role, deliberately and visibly.
-- ---------------------------------------------------------------------------

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'campaign_events',
    'campaign_activity_log',
    'automation_logs',
    'widget_events',
    'widget_submissions',
    'audit_logs',
    'gdpr_audit_events',
    'workspace_branding_audits'
  ] LOOP
    EXECUTE format('GRANT SELECT, INSERT ON public.%I TO authenticated', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_workspace_isolation', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated '
      'USING (workspace_id = public.current_workspace_id()) '
      'WITH CHECK (workspace_id = public.current_workspace_id())',
      t || '_workspace_isolation', t
    );
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 6. clients (the Workspace row): column-limited SELECT, no writes.
--
--    This table holds provider credentials - ses_access_key, ses_secret_key,
--    twilio_auth_token. A blanket grant would let ANY member of a workspace,
--    including a `viewer`, read that workspace's sending credentials through the
--    scoped token. Row-level security does not help here: the row is legitimately
--    theirs. Column privileges are the right tool.
--
--    Writes stay on explicit service_role paths (settings, provider config,
--    sending counters), which already perform their own role checks.
-- ---------------------------------------------------------------------------

GRANT SELECT (
  id, org_id, name, slug, created_at,
  logo_url, brand_colors, custom_domain,
  sender_name, sender_email,
  email_provider, fallback_provider, sandbox_mode,
  ses_region, ses_from_email,
  twilio_phone_number,
  sending_limit_monthly, sending_limit_total,
  sent_this_month, sent_total,
  sending_limit_reset_day, sending_period_start
) ON public.clients TO authenticated;

ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS clients_workspace_isolation ON public.clients;
CREATE POLICY clients_workspace_isolation ON public.clients
  FOR SELECT TO authenticated
  USING (id = public.current_workspace_id());

-- ---------------------------------------------------------------------------
-- 7. workspace_users: column-limited SELECT, no writes.
--
--    Excluded on purpose: password_hash, totp_secret, recovery_codes,
--    last_login_ip, last_login_user_agent. A workspace member listing their
--    teammates must not receive their credential material.
--
--    All writes - invite, password change, TOTP enrolment, deactivation - are
--    authentication operations and stay on service_role paths.
-- ---------------------------------------------------------------------------

GRANT SELECT (
  id, workspace_id, email, role, is_active,
  last_login_at, created_at, updated_at, totp_enabled
) ON public.workspace_users TO authenticated;

ALTER TABLE public.workspace_users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workspace_users_workspace_isolation ON public.workspace_users;
CREATE POLICY workspace_users_workspace_isolation ON public.workspace_users
  FOR SELECT TO authenticated
  USING (workspace_id = public.current_workspace_id());

-- ---------------------------------------------------------------------------
-- 8. System tables: RLS on, no policy, no grant. Unreachable except as
--    service_role. Stated explicitly so the absence of a policy reads as a
--    decision rather than an oversight.
--
--      admin_users        - Veloce platform staff and their credentials
--      subscribe_attempts - IP abuse prevention, written pre-tenant
--      organizations      - above the workspace; a workspace-scoped token has no
--                           business reading it. Org-scoped access arrives with
--                           the Organization UI in Phase 4.
-- ---------------------------------------------------------------------------

ALTER TABLE public.admin_users        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscribe_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organizations      ENABLE ROW LEVEL SECURITY;
