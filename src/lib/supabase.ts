import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

/**
 * `database.types.ts` is generated from the live schema by `npm run types:generate`.
 * Passing it here is what makes `.from("x").select("a, b")` a compile-time check
 * rather than a runtime surprise.
 *
 * That matters more here than it usually would. Every one of these shipped to
 * production and passed tsc, lint, tests and build first, because none of those
 * ever see SQL:
 *
 *   clients.resend_api_key / sendgrid_api_key   selected by 4 routes, never existed
 *   clients.from_email                          selected by test-provider, never existed
 *   subscriber_notes                            queried by 4 call sites, no such table
 *   nearby_subscribers()                        called by radius search, no such function
 *
 * PostgREST rejects an unknown column with 42703, and supabase-js reports that as
 * `{ error }` rather than throwing, so the usual outcome was a silent fallback to
 * defaults. With the generic in place each of those is a red squiggle instead.
 *
 * Regenerate after every migration. If a select stops compiling, the schema moved.
 */

// Server-only client using the service role key (never exposed to the browser)
// Lazily created at request time so the build doesn't fail when env vars are absent.
export function getSupabaseClient() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error(
      "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables."
    );
  }

  return createClient<Database>(supabaseUrl, supabaseKey, {
    auth: { persistSession: false },
  });
}
