import crypto from "crypto";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

/**
 * Workspace-scoped database credentials.
 *
 * The application's normal Supabase client authenticates as `service_role`, which
 * has rolbypassrls = true. Every row-level policy in the database is invisible to
 * it. That is correct for system work - cron jobs, provider webhooks, signup - and
 * completely wrong for handling a user's request, because it means tenant
 * isolation rests on each route handler remembering to filter.
 *
 * This module mints a different credential: a short-lived token asserting
 * `role: authenticated` and a single `workspace_id`. PostgREST reads the `role`
 * claim and switches the Postgres role for that request. `authenticated` has
 * rolbypassrls = false, so the policies added in migration 049 actually
 * constrain it, and `current_workspace_id()` reads the claim minted here.
 *
 * The security property worth stating explicitly: this token is minted only by
 * withWorkspace(), and only after membership has been verified against
 * workspace_users. The credential is derived from an authorization decision that
 * has already been made. There is no path that mints first and checks later, so a
 * token for a workspace the caller does not belong to cannot come into existence.
 *
 * Deliberately self-contained rather than sharing helpers with lib/jwt.ts. These
 * are two different credentials signed with two different secrets for two
 * different audiences, and the failure mode of accidentally signing a database
 * token with the session secret (or vice versa) is bad enough to be worth a few
 * duplicated lines.
 */

/**
 * Short by design. The token is minted per request and used immediately, so it
 * only has to survive the round trip. A leaked token is worthless almost at once,
 * and the window does not need tuning because nothing refreshes or stores it.
 */
export const DB_TOKEN_TTL_SECONDS = 60;

function getSupabaseJwtSecret(): string {
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!secret) {
    throw new Error(
      "SUPABASE_JWT_SECRET is required to mint workspace-scoped database tokens. " +
        "Supabase Dashboard > Project Settings > API > JWT Settings > JWT Secret. " +
        "Without it, RLS cannot be enforced and requests would silently fall back " +
        "to unscoped access, so this throws rather than degrading."
    );
  }
  return secret;
}

function base64Url(input: string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Mint a token scoped to exactly one workspace.
 *
 * Callers must have already established that `userId` is an active member of
 * `workspaceId`. This function does not check, and must never be exported to a
 * route handler directly - it is reachable through withWorkspace() only.
 */
export function mintWorkspaceDbToken(workspaceId: string, userId: string): string {
  const now = Math.floor(Date.now() / 1000);

  const header = base64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64Url(
    JSON.stringify({
      // Read by PostgREST to select the Postgres role for this request.
      role: "authenticated",
      aud: "authenticated",
      sub: userId,
      // Read by public.current_workspace_id(), which every policy keys on.
      workspace_id: workspaceId,
      iat: now,
      exp: now + DB_TOKEN_TTL_SECONDS,
    })
  );

  const signature = crypto
    .createHmac("sha256", getSupabaseJwtSecret())
    .update(`${header}.${payload}`)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  return `${header}.${payload}.${signature}`;
}

/**
 * A Supabase client that can only see one workspace.
 *
 * Queries written against this client need no `.eq("workspace_id", ...)` to be
 * safe - the database will not return another tenant's rows regardless of what
 * the query asks for. Existing filters are harmless and can stay; they are now
 * redundant rather than load-bearing.
 */
export function getWorkspaceScopedClient(
  workspaceId: string,
  userId: string
): SupabaseClient<Database> {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Missing SUPABASE_URL or SUPABASE_ANON_KEY. The anon key is the public " +
        "API key the scoped client presents; the minted token supplies the " +
        "identity and workspace."
    );
  }

  const token = mintWorkspaceDbToken(workspaceId, userId);

  return createClient<Database>(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}
