import { createClient } from "@supabase/supabase-js";

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

  return createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false },
  });
}
