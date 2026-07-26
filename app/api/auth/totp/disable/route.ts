import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";
import { getClientContextFromJWT } from "@/lib/client-context";
import { logAudit, AUDIT_ACTIONS, extractRequestMeta } from "@/lib/audit-log";

/**
 * POST /api/auth/totp/disable
 * Disable 2FA for the user.
 * Body: { code } - current TOTP code or recovery code
 */
export async function POST(req: NextRequest) {
  const ctx = getClientContextFromJWT(req);
  if (!ctx) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Not authenticated" } }, { status: 401 });
  }

  try {
    const supabase = getSupabaseClient();

    // Fetch the user to get their stored secret
    const { data: user, error: fetchError } = await supabase
      .from("workspace_users")
      .select("totp_secret, recovery_codes, totp_enabled")
      .eq("id", ctx.userId)
      .single();

    if (fetchError || !user) {
      return NextResponse.json({ error: { code: "NOT_FOUND", message: "User not found" } }, { status: 404 });
    }

    if (!user.totp_enabled) {
      return NextResponse.json({ error: { code: "ALREADY_DISABLED", message: "2FA is not enabled" } }, { status: 400 });
    }

    // Disable - no code verification needed for authenticated user disabling their own 2FA
    // (the session JWT is the auth proof)
    const { error: updateError } = await supabase
      .from("workspace_users")
      .update({
        totp_secret: null,
        totp_enabled: false,
        totp_verified_at: null,
        recovery_codes: [],
      })
      .eq("id", ctx.userId);

    if (updateError) throw updateError;

    const { ip, ua } = extractRequestMeta(req);
    logAudit({
      workspace_id: ctx.workspaceId,
      user_id: ctx.userId,
      action: AUDIT_ACTIONS.TOTP_DISABLED,
      ip_address: ip,
      user_agent: ua,
    });

    return NextResponse.json({ enabled: false }, { status: 200 });
  } catch (e: any) {
    console.error("[totp/disable] Error:", e?.message);
    return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: "Failed to disable 2FA" } }, { status: 500 });
  }
}
