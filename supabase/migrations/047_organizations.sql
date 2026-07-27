-- 047_organizations.sql
--
-- Organization: the commercial and identity-federation boundary that sits above
-- Workspace. It owns billing, plan and entitlements, SSO/SCIM configuration,
-- verified domains and the data-residency region. See ARCHITECTURE.md section 2.
--
-- This lands now, with no UI and nothing reading it, on purpose. Retrofitting the
-- top of the tenancy tree later touches every foreign key, every JWT claim and
-- every integration that assumed a workspace was the root. It is rated S effort
-- today and is effectively unbounded once third parties hold tokens.
--
-- Note on naming: `clients` IS the Workspace table. Renaming the table itself is
-- a much wider change and is deliberately NOT done here, so that this migration
-- stays purely additive and can ship on its own.

CREATE TABLE IF NOT EXISTS organizations (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  -- Region pinning, recorded from day one. Multi-region for a messaging platform
  -- means data residency, not latency: a Workspace is pinned to exactly one
  -- region at creation and no query ever crosses regions. Carrying the column now
  -- costs nothing; adding it after EU customers land is a migration that cannot
  -- be performed without downtime.
  region     TEXT NOT NULL DEFAULT 'us-east-1',
  plan       TEXT NOT NULL DEFAULT 'free',
  status     TEXT NOT NULL DEFAULT 'active'
             CHECK (status IN ('active', 'suspended', 'closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE organizations IS
  'Commercial and identity-federation boundary. Owns billing, plan, SSO config '
  'and residency region. A Workspace (public.clients) belongs to exactly one.';

-- Expand. Nullable first, so this statement is safe to apply before any code
-- knows the column exists.
ALTER TABLE clients ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id);

-- Backfill. One Organization per existing Workspace, which is exactly the shape
-- self-serve signup produces, so existing rows are not a special case.
DO $$
DECLARE
  ws         RECORD;
  new_org_id UUID;
BEGIN
  FOR ws IN SELECT id, name FROM clients WHERE org_id IS NULL LOOP
    INSERT INTO organizations (name) VALUES (ws.name) RETURNING id INTO new_org_id;
    UPDATE clients SET org_id = new_org_id WHERE id = ws.id;
  END LOOP;
END $$;

-- Contract. Every Workspace has an Organization from here on.
ALTER TABLE clients ALTER COLUMN org_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_clients_org_id ON clients(org_id);

COMMENT ON COLUMN clients.org_id IS
  'Owning Organization. Set at signup, never null. Billing, SSO and residency '
  'are resolved through this edge, not through the workspace.';
