-- 048_normalize_tenancy_columns.sql
--
-- One name for the tenancy key, on every table that has a tenant.
--
-- Before this migration the schema used three different conventions at once:
--   * `client_id`     - 6 tables
--   * `workspace_id`  - 10 tables
--   * no tenancy column at all - 8 tables
--
-- ARCHITECTURE.md invariant 1 requires every tenant row to carry `workspace_id`,
-- and the practical consequence of the third group is sharper than the naming
-- inconsistency: a row-level policy cannot be written for a table that does not
-- carry the key. A third of the schema was structurally incapable of being
-- isolated. `campaign_events` is the most important of them, because it is the
-- table that becomes `events` - the highest-volume table in the target system.
--
-- WHY THIS IS PLAIN DDL AND NOT expand -> backfill -> contract:
-- every table touched here currently holds ZERO rows. Sequencing rule 2 exists to
-- protect live data across a deploy boundary; there is no live data to protect
-- and no dual-write window to hold open. This is only true right now. The same
-- change against a populated database is a three-deploy migration per table.
--
-- APPLYING THIS REQUIRES THE MATCHING APPLICATION DEPLOY. Renaming a column
-- breaks the old name the instant it commits. Apply immediately before the deploy
-- that carries the renamed references, not hours ahead of it.

-- ---------------------------------------------------------------------------
-- 0. Drop two inert materialized views that depend on `campaigns.client_id`
--    and `subscribers.client_id`.
--
--    Both are dead in each direction: no code anywhere queries mv_campaign_stats
--    or mv_subscriber_growth, and their only refresher is
--    refresh_analytics_views(), called from /api/admin/automations/process, which
--    has no entry in vercel.json and therefore never runs. Migration 042 intended
--    them to eliminate the campaign_events scan on analytics load; that wiring was
--    never completed, and analytics still scans raw events.
--
--    They are dropped rather than carried through the rename because the real fix
--    is the incremental rollup table in Phase 1, written against the new `events`
--    table so it is only written once (ARCHITECTURE.md section 4). Carrying a
--    half-built replacement through a rename maintains a model that is about to be
--    replaced, which is sequencing rule 1.
--
--    Nothing is lost: a materialized view is derived data, and the full definition
--    remains in migration 042 if it is ever wanted back.
-- ---------------------------------------------------------------------------

DROP MATERIALIZED VIEW IF EXISTS mv_campaign_stats;
DROP MATERIALIZED VIEW IF EXISTS mv_subscriber_growth;
DROP FUNCTION IF EXISTS refresh_analytics_views();

-- ---------------------------------------------------------------------------
-- 1. Rename `client_id` -> `workspace_id` on the tables where it means "the
--    tenant that owns this row".
-- ---------------------------------------------------------------------------

ALTER TABLE subscribers        RENAME COLUMN client_id TO workspace_id;
ALTER TABLE campaigns          RENAME COLUMN client_id TO workspace_id;
ALTER TABLE subscriber_lists   RENAME COLUMN client_id TO workspace_id;
ALTER TABLE subscriber_tags    RENAME COLUMN client_id TO workspace_id;
ALTER TABLE gdpr_audit_events  RENAME COLUMN client_id TO workspace_id;

-- ---------------------------------------------------------------------------
-- 2. admin_users is NOT a tenant table, and its `client_id` does not mean the
--    same thing.
--
--    admin_users holds Veloce platform staff, not customer users. Its client_id
--    is an optional restriction ("this admin may only act on this workspace"),
--    not a statement of ownership. Naming it `workspace_id` would collide
--    semantically with the most load-bearing column name in the schema and would
--    make the table look like something a generic "apply tenant isolation to
--    every table with workspace_id" pass should pick up. It must not be.
-- ---------------------------------------------------------------------------

ALTER TABLE admin_users RENAME COLUMN client_id TO scoped_workspace_id;

COMMENT ON COLUMN admin_users.scoped_workspace_id IS
  'Optional restriction limiting a platform admin to a single workspace. NOT a '
  'tenancy key - admin_users is a system table and is never exposed to the '
  'authenticated role.';

-- ---------------------------------------------------------------------------
-- 3. Add `workspace_id` to the tables that carried no tenancy key.
--
--    The key is denormalized onto each row rather than reached through a join.
--    That is deliberate and is what makes an index-only isolation check possible:
--    a policy that has to join to find the tenant correlates every read with the
--    control plane and cannot use an index prefix.
--
--    Foreign keys follow the control-plane / data-plane split in
--    ARCHITECTURE.md section 4: hot append-only tables get no FK, because FK
--    checks cost write throughput and couple locks to the control plane.
--    Integrity for those is enforced in the write path.
-- ---------------------------------------------------------------------------

-- Data plane: append-heavy, no foreign key.
ALTER TABLE campaign_events         ADD COLUMN workspace_id UUID NOT NULL;
ALTER TABLE campaign_job_recipients ADD COLUMN workspace_id UUID NOT NULL;
ALTER TABLE automation_logs         ADD COLUMN workspace_id UUID NOT NULL;

-- Control plane: normalize hard, keep referential integrity in the database.
ALTER TABLE campaign_jobs               ADD COLUMN workspace_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE;
ALTER TABLE campaign_variants           ADD COLUMN workspace_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE;
ALTER TABLE subscriber_list_memberships ADD COLUMN workspace_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE;
ALTER TABLE widget_submissions          ADD COLUMN workspace_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE;

-- ---------------------------------------------------------------------------
-- 4. subscribe_attempts is intentionally left without a tenancy key.
--
--    It records raw IP/email pairs to rate-limit the public subscribe endpoint,
--    and it is written before any workspace is necessarily resolved. It is
--    abuse-prevention infrastructure, not customer data. It stays a system table:
--    service_role only, never granted to the authenticated role, no policy.
-- ---------------------------------------------------------------------------

COMMENT ON TABLE subscribe_attempts IS
  'System table. IP-based abuse prevention for the public subscribe endpoint, '
  'written before a workspace is resolved. Deliberately has no tenancy key and '
  'is never exposed to the authenticated role.';

-- ---------------------------------------------------------------------------
-- 5. Indexes. workspace_id leads every one of them, so that isolation and the
--    common "everything in this workspace, newest first" access pattern are
--    served by the same index. ARCHITECTURE.md section 4.
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_campaign_events_ws           ON campaign_events(workspace_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_campaign_jobs_ws             ON campaign_jobs(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_campaign_job_recipients_ws   ON campaign_job_recipients(workspace_id);
CREATE INDEX IF NOT EXISTS idx_campaign_variants_ws         ON campaign_variants(workspace_id);
CREATE INDEX IF NOT EXISTS idx_subscriber_list_memb_ws      ON subscriber_list_memberships(workspace_id);
CREATE INDEX IF NOT EXISTS idx_widget_submissions_ws        ON widget_submissions(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_automation_logs_ws           ON automation_logs(workspace_id, created_at DESC);

-- Renamed columns keep their old indexes, which Postgres carries across a rename
-- automatically. These are the ones the old names did not have.
CREATE INDEX IF NOT EXISTS idx_subscriber_tags_ws           ON subscriber_tags(workspace_id);
CREATE INDEX IF NOT EXISTS idx_gdpr_audit_events_ws         ON gdpr_audit_events(workspace_id, created_at DESC);
