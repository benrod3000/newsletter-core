<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes - APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Supabase: there is no dev project - the linked project is production

This account has exactly one Supabase project (`jdmtvkytidxpcyhnhgdo`, "Newsletter"),
and it is production. There is no separate staging/dev database to point the CLI at.

On 2026-07-26 something replayed all 45 migration files against this project outside
of normal `apply_migration` usage - most likely `supabase db reset` (or similar) run
against the linked remote project instead of a local Docker stack. That wipes all
table data (migrations only rebuild schema) and drops the table grants Supabase sets
up once at project provisioning (no migration file has ever contained a `GRANT`
statement, so replaying migrations from scratch never restores them). Result: every
table in `public` was empty except `clients` (1 row), and every request through
`SUPABASE_SERVICE_ROLE_KEY` 403'd with `42501 permission denied for table ...` until
migration `046_restore_service_role_grants.sql` was applied by hand. No real user data
existed yet, so this specific incident was low-cost - the next one might not be.

The CLI has been left **unlinked** (`supabase unlink`) so a stray `supabase db reset`
or `supabase db push` fails closed instead of silently targeting production. Rules:

- Never run `supabase link`, `supabase db reset`, `supabase db push`, or
  `supabase migration up --linked` without first telling the user exactly what the
  command targets and getting explicit confirmation - the same bar as
  `git push --force` or `rm -rf`, not the default-allowed bar for routine dev commands.
- For schema changes, prefer the Supabase MCP `apply_migration` tool (tracked,
  one-migration-at-a-time, no reset semantics) over local CLI `db push`.
- If you ever need a real local/dev database, that means creating an actual second
  Supabase project (or running `supabase start` for a local Docker Postgres) - not
  linking the CLI to this one and being careful.

## Every migration owes two things

After applying one, run both:

- `npm run types:generate` - the generated types are the project's safety net;
  turning them on once surfaced four shipped bugs.
- `npm run audit:security` - checks the invariants that have actually been
  broken here: a workspace-scoped table without RLS and a policy, a
  `SECURITY DEFINER` function callable by `anon` or `authenticated`, a public
  storage bucket with no size limit or MIME allowlist. Clean exits 0; findings
  exit 1 and name the object.

**A new workspace-scoped table needs its `GRANT` and its RLS policy in the same
migration that creates it.** They are one step, not two: grant without RLS is a
silent cross-tenant leak, RLS without grant is a loud permission error. Getting
the loud half is luck, not safety. The same applies to a new `SECURITY DEFINER`
function - revoke from `PUBLIC, anon, authenticated` where you create it, rather
than in a sweep later, which is how `count_campaign_recipients` sat exposed from
056 until 081.

Supabase's own advisors (`get_advisors`, type `security`) cover more ground and
are worth reading too. `audit:security` is the project-specific half an advisor
cannot know: that `workspace_id` means tenant data, and that the public `assets`
bucket is a deliberate egress decision rather than an oversight.

