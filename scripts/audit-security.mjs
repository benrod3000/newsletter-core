import { createClient } from "@supabase/supabase-js";

/**
 * Run the project's security invariants and fail if any of them are violated.
 *
 * The checks live in the database (`security_invariants()`, migration 083)
 * rather than here, so they can also be run from the SQL editor or by anything
 * else holding a service key. This is just the part that turns findings into an
 * exit code.
 *
 * Deliberately NOT a CI step. This repo's CI builds against throwaway
 * credentials and talks to nothing live, which is a good rule; adding a job that
 * needs a real service key would copy a production secret into GitHub for the
 * sake of a linter. Run it after applying a migration instead - AGENTS.md says
 * so next to `types:generate`, which is the other thing a migration obliges.
 *
 * Supabase's own advisors cover more ground and are still worth reading. These
 * are the project-specific rules an advisor cannot know: that a `workspace_id`
 * column means tenant data, and that this project's public bucket is a
 * deliberate egress decision rather than an oversight.
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.");
  process.exit(2);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const { data, error } = await supabase.rpc("security_invariants");

if (error) {
  // An unreadable check is not a pass. Exit non-zero so this cannot be mistaken
  // for a clean run in a script that only looks at the status code.
  console.error(`Could not run the security invariants: ${error.message}`);
  console.error("If the function is missing, migration 083 has not been applied.");
  process.exit(2);
}

const findings = data ?? [];

if (findings.length === 0) {
  console.log("Security invariants: clean.");
  console.log("  - every workspace-scoped table has RLS and a policy");
  console.log("  - no SECURITY DEFINER function is callable by anon or authenticated");
  console.log("  - every public bucket has a size limit and a MIME allowlist");
  process.exit(0);
}

console.error(`Security invariants: ${findings.length} finding${findings.length === 1 ? "" : "s"}.\n`);

const byCheck = new Map();
for (const f of findings) {
  const list = byCheck.get(f.check_name) ?? [];
  list.push(f);
  byCheck.set(f.check_name, list);
}

for (const [check, rows] of byCheck) {
  console.error(`  ${check}`);
  for (const r of rows) console.error(`    - ${r.object_name}: ${r.detail}`);
  console.error("");
}

process.exit(1);
