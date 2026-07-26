/**
 * Demo account configuration.
 *
 * The demo account is a deliberate weak point: its credentials are published,
 * and /api/auth/token skips the Turnstile check for it. That trade is
 * acceptable only while the account is confined to a workspace that holds no
 * real data, so the guards here are what make the trade safe.
 *
 * The email and password were previously hardcoded across six route files,
 * which meant the password could not be rotated without a deploy.
 */

import { getSupabaseClient } from "@/lib/supabase";

/** The demo account's email. Override with DEMO_ACCOUNT_EMAIL. */
export const DEMO_EMAIL = process.env.DEMO_ACCOUNT_EMAIL || "demo@veloce.app";

/**
 * The demo account's password.
 *
 * Throws when unset rather than falling back to a literal: a default here
 * would silently reinstate a published credential that cannot be changed.
 */
export function getDemoPassword(): string {
  const password = process.env.DEMO_ACCOUNT_PASSWORD;
  if (!password) {
    throw new Error(
      "DEMO_ACCOUNT_PASSWORD is required for demo account routes. " +
        "Set it in the environment; it must not be hardcoded."
    );
  }
  return password;
}

/** True when the given email is the demo account. Case-insensitive. */
export function isDemoAccount(email: string): boolean {
  return email.trim().toLowerCase() === DEMO_EMAIL.toLowerCase();
}

export type DemoWorkspaceCheck =
  | { ok: true; userId: string; workspaceId: string }
  | { ok: false; status: number; message: string };

/**
 * Resolve the demo user and confirm its workspace is marked sandbox_mode.
 *
 * Without this check, the demo routes would happily reset the password of, or
 * seed data into, whatever workspace the demo user happens to be attached to -
 * including one holding real customer data if the account were ever moved or
 * re-pointed. sandbox_mode is the existing flag for "this workspace does not
 * send real email" (migration 043), which is exactly the property required.
 */
export async function resolveDemoWorkspace(): Promise<DemoWorkspaceCheck> {
  const supabase = getSupabaseClient();

  const { data: user } = await supabase
    .from("workspace_users")
    .select("id, workspace_id")
    .eq("email", DEMO_EMAIL)
    .maybeSingle();

  if (!user) {
    return { ok: false, status: 404, message: "Demo user not found" };
  }

  const { data: workspace } = await supabase
    .from("clients")
    .select("id, sandbox_mode")
    .eq("id", user.workspace_id)
    .maybeSingle();

  if (!workspace) {
    return { ok: false, status: 404, message: "Demo workspace not found" };
  }

  if (!workspace.sandbox_mode) {
    return {
      ok: false,
      status: 409,
      message:
        "Refusing to act on the demo account: its workspace is not in sandbox mode. " +
        `Set sandbox_mode = true on clients.id = '${workspace.id}' if this really is the demo workspace.`,
    };
  }

  return { ok: true, userId: user.id, workspaceId: workspace.id };
}
