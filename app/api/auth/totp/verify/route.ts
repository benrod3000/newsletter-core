import { NextRequest, NextResponse } from "next/server";
import { createClientJWT, verifyPendingTOTPJWT } from "@/lib/jwt";
import { verifyTOTP } from "@/lib/totp";
import { getSupabaseClient } from "@/lib/supabase";
import { logAudit, AUDIT_ACTIONS, extractRequestMeta } from "@/lib/audit-log";

/**
 * POST /api/auth/totp/verify
 * Verify a TOTP code during login (step 2 of 2FA).
 * Body: { partial_token, code }
 */
export async function POST(req: NextRequest) {
  const { ip, ua } = extractRequestMeta(req);

  try {
    const { partial_token, code } = await req.json();

    if (!partial_token || !code) {
      return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Token and code are required" } }, { status: 400 });
    }

    // Verify the partial token (issued during password step).
    // Only accepts audience "totp_pending" — a full session token cannot be
    // replayed here, and a pending token cannot be used anywhere else.
    const payload = verifyPendingTOTPJWT(partial_token);
    if (!payload) {
      return NextResponse.json({ error: { code: "INVALID_TOKEN", message: "Session expired. Please log in again." } }, { status: 401 });
    }

    const supabase = getSupabaseClient();
    const { data: user, error } = await supabase
      .from("workspace_users")
      .select("totp_secret, totp_enabled, recovery_codes")
      .eq("id", payload.userId)
      .single();

    if (error || !user) {
      return NextResponse.json({ error: { code: "NOT_FOUND", message: "User not found" } }, { status: 404 });
    }

    if (!user.totp_enabled || !user.totp_secret) {
      return NextResponse.json({ error: { code: "NO_2FA", message: "2FA is not enabled" } }, { status: 400 });
    }

    // Check recovery codes first
    const recoveryIndex = (user.recovery_codes || []).findIndex((rc: string) => rc === code.trim().toUpperCase());
    if (recoveryIndex >= 0) {
      // Remove used recovery code
      const updatedCodes = [...user.recovery_codes];
      updatedCodes.splice(recoveryIndex, 1);
      await supabase.from("workspace_users").update({ recovery_codes: updatedCodes }).eq("id", payload.userId);
    } else if (!verifyTOTP(code, user.totp_secret)) {
      logAudit({ workspace_id: payload.workspaceId, user_id: payload.userId, action: AUDIT_ACTIONS.LOGIN_FAILED, details: { reason: "invalid_totp" }, ip_address: ip, user_agent: ua });
      return NextResponse.json({ error: { code: "INVALID_CODE", message: "Invalid code. Try again." } }, { status: 401 });
    }

    const expiresIn = 86400 * 30;
    const token = createClientJWT(payload.workspaceId, payload.userId, payload.email, payload.role, expiresIn);

    // Update last login
    const supabaseUrl = process.env.SUPABASE_URL!;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const auth = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` };
    await fetch(`${supabaseUrl}/rest/v1/workspace_users?id=eq.${payload.userId}`, {
      method: "PATCH",
      headers: { ...auth, "Prefer": "return=minimal" },
      body: JSON.stringify({ last_login_at: new Date().toISOString(), last_login_ip: ip, last_login_user_agent: ua }),
    }).catch(() => {});

    logAudit({ workspace_id: payload.workspaceId, user_id: payload.userId, action: AUDIT_ACTIONS.TOTP_VERIFIED, ip_address: ip, user_agent: ua });

    return NextResponse.json({
      token, workspaceId: payload.workspaceId, email: payload.email, role: payload.role, expiresIn,
    }, { status: 200 });
  } catch (e: any) {
    console.error("[totp/verify] Error:", e?.message);
    return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: "Verification failed" } }, { status: 500 });
  }
}
