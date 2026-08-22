import { NextRequest, NextResponse } from "next/server";
import { createClientJWT, verifyPendingTOTPJWT } from "@/lib/jwt";
import { verifyTOTP } from "@/lib/totp";
import { getSupabaseClient } from "@/lib/supabase";
import { logAudit, AUDIT_ACTIONS, extractRequestMeta } from "@/lib/audit-log";
import { recordLogin } from "@/lib/record-login";
import { rateLimit } from "@/lib/rate-limit";

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
    // Only accepts audience "totp_pending" - a full session token cannot be
    // replayed here, and a pending token cannot be used anywhere else.
    const payload = verifyPendingTOTPJWT(partial_token);
    if (!payload) {
      return NextResponse.json({ error: { code: "INVALID_TOKEN", message: "Session expired. Please log in again." } }, { status: 401 });
    }

    /*
     * Bound the second factor, which was unbounded.
     *
     * /api/auth/token limits *password* attempts to five a minute. Nothing
     * limited this, and the only ceiling on guessing was the partial token's
     * five-minute life - during which a six-digit code could be attempted as
     * fast as the endpoint would answer, and a fresh partial token could be
     * minted by repeating the password step. An attacker holding a correct
     * password could therefore grind the second factor at will, which is most
     * of the value of having one.
     *
     * Keyed by user, not by IP: the account is what is under attack, and an IP
     * key is defeated by spreading requests across addresses. Fails closed, for
     * the same reason the login limiter does - a Redis outage must not quietly
     * remove the ceiling.
     *
     * Placed after the token check so an unauthenticated caller cannot consume
     * another account's budget: reaching here already requires a valid,
     * unexpired partial token, which requires the password.
     */
    const rl = await rateLimit(`totp:${payload.userId}`, 5, 5 / 60, "closed");
    if (!rl.allowed) {
      logAudit({
        workspace_id: payload.workspaceId,
        user_id: payload.userId,
        action: AUDIT_ACTIONS.LOGIN_FAILED,
        details: { reason: "totp_rate_limited" },
        ip_address: ip,
        user_agent: ua,
      });
      return NextResponse.json(
        { error: { code: "RATE_LIMITED", message: "Too many codes tried. Wait a moment and try again.", retryAfter: rl.retryAfter } },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter) } }
      );
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

    // Check recovery codes first. Hoisted so the null case is handled once:
    // recovery_codes is nullable, and the spread below assumed it was not.
    // Unreachable in practice (findIndex on [] returns -1) but only by accident.
    const recoveryCodes = user.recovery_codes ?? [];
    const recoveryIndex = recoveryCodes.findIndex((rc: string) => rc === code.trim().toUpperCase());
    if (recoveryIndex >= 0) {
      // Remove used recovery code
      const updatedCodes = [...recoveryCodes];
      updatedCodes.splice(recoveryIndex, 1);
      await supabase.from("workspace_users").update({ recovery_codes: updatedCodes }).eq("id", payload.userId);
    } else if (!verifyTOTP(code, user.totp_secret)) {
      logAudit({ workspace_id: payload.workspaceId, user_id: payload.userId, action: AUDIT_ACTIONS.LOGIN_FAILED, details: { reason: "invalid_totp" }, ip_address: ip, user_agent: ua });
      return NextResponse.json({ error: { code: "INVALID_CODE", message: "Invalid code. Try again." } }, { status: 401 });
    }

    const expiresIn = 86400 * 30;
    const token = createClientJWT(payload.workspaceId, payload.userId, payload.email, payload.role, expiresIn);

    await recordLogin(payload.userId, { ip, ua });

    logAudit({ workspace_id: payload.workspaceId, user_id: payload.userId, action: AUDIT_ACTIONS.TOTP_VERIFIED, ip_address: ip, user_agent: ua });

    return NextResponse.json({
      token, workspaceId: payload.workspaceId, email: payload.email, role: payload.role, expiresIn,
    }, { status: 200 });
  } catch (e: any) {
    console.error("[totp/verify] Error:", e?.message);
    return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: "Verification failed" } }, { status: 500 });
  }
}
