# Deploying the tenancy / RLS change

_Migrations 047-050 and the `withWorkspace()` conversion. Read this before
applying anything._

The short version: **migration 048 renames columns, which breaks the running
code the instant it commits.** There is a window between applying it and the new
deployment serving traffic, and the only way to make that window small is to
order things correctly.

---

## Why the usual expand → backfill → contract dance is skipped

Sequencing rule 2 in `ARCHITECTURE.md` says never make a breaking schema change
in the same deploy as the code that needs it. That rule protects live data across
a deploy boundary.

Every table this touches currently holds **zero rows** - `clients` has 2 and
`workspace_users` has 1, everything else is empty after the July 2026 reset. There
is no data to dual-write and no backfill to stage. Doing this properly against a
populated database is a three-deploy migration per table, times fourteen tables.

**This window closes with the first real customer.** That is the entire reason
this work jumped ahead of its place in the phase order.

---

## Prerequisites

### 1. Two new environment variables

Both must be set in Vercel **before** the deploy, or `assertRequiredEnv()` throws
at cold start in production and every request fails.

| Variable | Where to get it | Secret? |
| --- | --- | --- |
| `SUPABASE_ANON_KEY` | Dashboard → Project Settings → API → Project API keys → `anon` `public` | No, public by design |
| `SUPABASE_JWT_SECRET` | Dashboard → Project Settings → API → JWT Settings → **JWT Secret** | **Yes.** Anyone holding it can mint a token for any workspace |

`SUPABASE_JWT_SECRET` is the one that matters. It signs the short-lived tokens
that assert `role: authenticated` and a single `workspace_id`, which is what every
policy in migration 049 keys on.

Set them locally in `.env.local` too, or the converted routes will throw there.

### 2. Confirm the project still uses symmetric JWT signing

Already verified: the project's legacy `anon` key is an enabled **HS256** JWT,
which means PostgREST is still verifying symmetric tokens. If Supabase later
migrates this project to asymmetric signing keys only, minting stops working and
`db-token.ts` is the single file that needs to change.

---

## Order of application

Strictly sequential. Each depends on the one before it.

```
047  organizations           BREAKS SIGNUP unless the code deploys with it - see below
048  tenancy columns         BREAKS RUNNING CODE - deploy with it
049  grants + policies       depends on 048 (its policies reference workspace_id)
050  stored functions        depends on 048 - MUST go with it, see below
```

**047 is not safe alone, despite being additive.** It ends with
`ALTER TABLE clients ALTER COLUMN org_id SET NOT NULL`, and the column has no
default and no trigger behind it. Two code paths insert into `clients` without
supplying `org_id`:

- `app/api/auth/signup/route.ts` - every self-serve signup
- `app/api/admin/demo/seed/route.ts` - demo workspace creation

Both fail closed (a 500, no partial rows), but signup is fully down between
applying 047 and deploying the code that sets `org_id`. Both are fixed on
`phase0/tenancy-rls`: signup now creates the Organization first and rolls it back
if the workspace insert fails. **Apply 047 in the same batch as the rest, not
ahead of the deploy.**

**049 cannot be applied ahead of 048.** Its policies are written against
`workspace_id`, which does not exist on eight of the tables until 048 runs.
`CREATE POLICY` fails outright.

**050 must land in the same batch as 048.** Postgres does not track column
references inside function bodies, so the four affected functions keep compiling
after the rename and fail at runtime instead. One of them is
`enqueue_campaign_recipients`, which means campaign sends break silently.

### Recommended sequence

1. Set both environment variables in Vercel.
2. Merge `phase0/tenancy-rls` and let Vercel build, but do not promote yet.
3. Apply **047**, **048**, **049**, **050** back to back via the Supabase MCP
   `apply_migration` tool - one call each, in that order.
4. Promote the deployment immediately.

Steps 3 and 4 are the outage window. With two demo workspaces and no customers it
is measured in seconds and costs nothing. It will not be free later.

> Use `apply_migration`, not the CLI. The CLI is deliberately left unlinked after
> the July 2026 incident - see `AGENTS.md`. Do not run `supabase link`,
> `db reset`, or `db push` against this project.

---

## Verifying RLS actually enforces

RLS was previously theater: seven tables had it enabled with zero policies, and
the app connects as `service_role`, which has `rolbypassrls = true`. Confirm the
new setup is real rather than assuming it.

Run this **after** 049. It simulates exactly what PostgREST does per request -
switch role, set the JWT claims GUC - without needing the app or a minted token:

```sql
-- Should return rows for the workspace named in the claim, and nothing else.
BEGIN;
  SET LOCAL ROLE authenticated;
  SET LOCAL request.jwt.claims = '{"role":"authenticated","workspace_id":"<A>"}';
  SELECT count(*) AS should_be_workspace_a_only FROM subscribers;
ROLLBACK;

-- Should return zero rows: valid role, wrong workspace.
BEGIN;
  SET LOCAL ROLE authenticated;
  SET LOCAL request.jwt.claims = '{"role":"authenticated","workspace_id":"<B>"}';
  SELECT count(*) AS should_be_zero FROM subscribers WHERE workspace_id = '<A>';
ROLLBACK;

-- Should return zero rows: no claim at all. current_workspace_id() returns NULL,
-- and `workspace_id = NULL` is NULL, not true. Fail-closed by construction.
BEGIN;
  SET LOCAL ROLE authenticated;
  SELECT count(*) AS should_be_zero FROM subscribers;
ROLLBACK;

-- Should ERROR with "permission denied": credentials must not be reachable by
-- the role customer requests run as, even for their own workspace.
BEGIN;
  SET LOCAL ROLE authenticated;
  SET LOCAL request.jwt.claims = '{"role":"authenticated","workspace_id":"<A>"}';
  SELECT ses_secret_key FROM clients;
ROLLBACK;
```

The last one is the check most worth running. Row-level security does not help
when the row is legitimately yours - a `viewer` reading their own workspace's
`clients` row would otherwise get `ses_secret_key` and `twilio_auth_token`. That
is why 049 uses column-level grants there and on `workspace_users`
(`password_hash`, `totp_secret`, `recovery_codes`).

### Then one end-to-end smoke test

Log into the dashboard and load any converted route - the subscribers list is the
obvious one. If `SUPABASE_JWT_SECRET` is wrong, PostgREST rejects the minted token
and it fails immediately and loudly. That is the whole token path verified.

---

## Rolling back

- **047** - harmless to leave. Nothing reads `org_id`.
- **048/050** - roll back by redeploying the previous build **and** reverting the
  column names. There is no partial state that works: old code needs `client_id`,
  new code needs `workspace_id`.
- **049** - safe to drop the policies and grants without touching the code.
  Converted routes keep their explicit `.eq("workspace_id", ...)` filters, so they
  stay correct with RLS off. That is deliberate.

---

## What is NOT done yet

- **14 of 41 workspace routes still use the old pattern.** They keep working
  unchanged - they are on `service_role` and bypass RLS. Isolation for those is
  still convention, exactly as before. Converting them is mechanical; the pattern
  is in `segments/route.ts`. They do not block this deploy and are best shipped
  as ordinary follow-up PRs, since none of them needs a migration:

  ```
  analytics/route.ts          analytics/heatmap    analytics/live    analytics/sms
  automations/activity-log    automations/smart-tags/history         .../run
  campaigns/[id]/test         campaigns/sms        sms/test
  deliverability/dns          deliverability/overview
  subscribers/import          test-provider
  ```
- **`subscribe_attempts`, `admin_users`, `organizations`** are system tables:
  RLS on, no policy, no grant to `authenticated`. Reachable only as
  `service_role`. That is intentional and stated in 049.
- **Cron, provider webhooks, signup, auth and admin routes** stay on
  `service_role` on purpose. They have no user context to derive a workspace from.
