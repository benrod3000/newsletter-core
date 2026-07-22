import { NextResponse } from "next/server";
import { verifyPassword } from "@/lib/jwt";
import { getSupabaseClient } from "@/lib/supabase";
import { DEMO_EMAIL, getDemoPassword } from "@/lib/demo";
import { logError } from "@/lib/logger";

/**
 * GET /api/admin/demo/check-login
 * Diagnostics: checks the demo user exists and its password matches the
 * configured DEMO_ACCOUNT_PASSWORD.
 * Protected by admin Basic Auth.
 */
export async function GET() {
  try {
    const { data: user } = await getSupabaseClient()
      .from("workspace_users")
      .select("id, email, password_hash, is_active")
      .eq("email", DEMO_EMAIL)
      .maybeSingle();

    if (!user) {
      return NextResponse.json({ user_found: false });
    }

    const { valid } = await verifyPassword(getDemoPassword(), user.password_hash);

    return NextResponse.json({
      user_found: true,
      is_active: user.is_active,
      // 3 segments = current "iterations:salt:hash" format, 2 = legacy.
      hash_format: (user.password_hash || "").split(":").length === 3 ? "valid" : "invalid",
      // Named for the configured password rather than embedding its value.
      password_matches_configured: valid,
    });
  } catch (error) {
    logError(error, { route: "admin.demo.checkLogin" });
    return NextResponse.json({ error: "Check failed" }, { status: 500 });
  }
}
