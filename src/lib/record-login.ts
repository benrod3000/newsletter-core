import { getSupabaseClient } from "./supabase";
import { logError } from "./logger";

/**
 * Stamp a successful sign-in onto the user's row.
 *
 * Both login paths - password and TOTP - previously did this with a hand-rolled
 * `fetch` at PostgREST:
 *
 *     const auth = { apikey: key, Authorization: `Bearer ${key}` };
 *     await fetch(url, { method: "PATCH", headers: { ...auth, Prefer: "return=minimal" },
 *                        body: JSON.stringify({ last_login_at: ... }) }).catch(() => {});
 *
 * which never once worked. There is no `Content-Type: application/json`, and
 * PostgREST answers a PATCH carrying a JSON body without it with 415
 * Unsupported Media Type. The write was rejected every time.
 *
 * Two things then hid it. `fetch` does not throw on an HTTP error status, so
 * the `.catch(() => {})` was not even the thing swallowing it - the rejected
 * response was simply discarded unread. And `logAudit` on the next line *did*
 * work, so the audit log filled with 45 `login` events while
 * `workspace_users.last_login_at` stayed NULL for every user in the database.
 * The Team panel reads that column, so it showed "NEVER LOGGED IN" beside
 * accounts that had just signed in to look at it.
 *
 * Through supabase-js now, like every other write in this codebase, with the
 * error checked. A failure here must not fail the sign-in - the user is
 * authenticated and blocking them over a telemetry column would be the wrong
 * trade - but it is reported rather than dropped.
 */
export async function recordLogin(
  userId: string,
  meta: { ip: string; ua: string }
): Promise<void> {
  const supabase = getSupabaseClient();

  const { error } = await supabase
    .from("workspace_users")
    .update({
      last_login_at: new Date().toISOString(),
      last_login_ip: meta.ip,
      last_login_user_agent: meta.ua,
    })
    .eq("id", userId);

  if (error) {
    logError(error, { route: "auth.recordLogin", userId });
  }
}
