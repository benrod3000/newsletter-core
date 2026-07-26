import { NextResponse } from "next/server";
import { hashPassword } from "@/lib/jwt";
import { getSupabaseClient } from "@/lib/supabase";
import { getDemoPassword, resolveDemoWorkspace } from "@/lib/demo";
import { logError } from "@/lib/logger";

/**
 * POST /api/admin/demo/reset-password
 * Resets the demo account password. Fast - no subscriber/campaign seeding.
 * Protected by admin Basic Auth (handled by proxy.ts middleware).
 *
 * Refuses to run unless the demo user's workspace is flagged sandbox_mode, so
 * this can never reset credentials on a workspace holding real data.
 */
export async function POST() {
  try {
    const demo = await resolveDemoWorkspace();
    if (!demo.ok) {
      return NextResponse.json({ error: demo.message }, { status: demo.status });
    }

    const { error } = await getSupabaseClient()
      .from("workspace_users")
      .update({ password_hash: await hashPassword(getDemoPassword()) })
      .eq("id", demo.userId);

    if (error) {
      logError(error, { route: "admin.demo.resetPassword" });
      return NextResponse.json({ error: "Password reset failed" }, { status: 500 });
    }

    // Deliberately does not echo any part of the stored hash.
    return NextResponse.json({ ok: true, user_id: demo.userId });
  } catch (error) {
    logError(error, { route: "admin.demo.resetPassword" });
    return NextResponse.json({ error: "Password reset failed" }, { status: 500 });
  }
}
