import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";
import { getClientContextFromJWT } from "@/lib/client-context";
import { verifyTOTP, generateRecoveryCodes } from "@/lib/totp";
import { logAudit, AUDIT_ACTIONS, extractRequestMeta } from "@/lib/audit-log";

/**
 * POST /api/auth/totp/enable
 * Verify a TOTP code and enable 2FA for the user.
 * Body: { secret, code }
 */
export async function POST(req: NextRequest) {
  const ctx = getClientContextFromJWT(req);
  if (!ctx) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Not authenticated" } }, { status: 401 });
  }

  try {
    const { secret, code } = await req.json();

    if (!secret || !code) {
      return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Secret and code are required" } }, { status: 400 });
    }

    if (!verifyTOTP(code, secret)) {
      return NextResponse.json({ error: { code: "INVALID_CODE", message: "Invalid code. Try again." } }, { status: 400 });
    }

    const recoveryCodes = generateRecoveryCodes();
    const supabase = getSupabaseClient();

    const { error } = await supabase
      .from("workspace_users")
      .update({
        totp_secret: secret,
        totp_enabled: true,
        totp_verified_at: new Date().toISOString(),
        recovery_codes: recoveryCodes,
      })
      .eq("id", ctx.userId);

    if (error) throw error;

    const { ip, ua } = extractRequestMeta(req);
    logAudit({
      workspace_id: ctx.workspaceId,
      user_id: ctx.userId,
      action: AUDIT_ACTIONS.TOTP_ENABLED,
      ip_address: ip,
      user_agent: ua,
    });

    return NextResponse.json({ enabled: true, recovery_codes: recoveryCodes }, { status: 200 });
  } catch (e: any) {
    console.error("[totp/enable] Error:", e?.message);
    return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: "Failed to enable 2FA" } }, { status: 500 });
  }
}
