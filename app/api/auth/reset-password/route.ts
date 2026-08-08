import { NextRequest, NextResponse } from "next/server";
import { hashPassword } from "@/lib/jwt";
import { rateLimit } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/client-ip";
import { verifyTurnstileToken } from "@/lib/turnstile";
import crypto from "node:crypto";
import { getSupabaseClient } from "@/lib/supabase";
import { logError } from "@/lib/logger";
import { logAudit, AUDIT_ACTIONS } from "@/lib/audit-log";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(req: NextRequest) {
  // Rate limit: 3 attempts per minute per IP
  const ip = getClientIp(req);
  const { allowed, retryAfter } = await rateLimit(`reset-password:${ip}`, 3, 3 / 60, "closed");
  if (!allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Please try again later." },
      { status: 429, headers: { "Retry-After": String(retryAfter), "Access-Control-Allow-Origin": "*" } }
    );
  }

  try {
    const { token, password, turnstile_token } = await req.json();
    if (!token || !password || password.length < 6) {
      return NextResponse.json({ error: "Valid token and password (6+ chars) required" }, { status: 400, headers: CORS_HEADERS });
    }

    if (!turnstile_token || !(await verifyTurnstileToken(turnstile_token))) {
      return NextResponse.json({ error: "Security check failed. Please try again." }, { status: 400, headers: CORS_HEADERS });
    }

    const supabase = getSupabaseClient();

    // Looked up by hash: the database stores a SHA-256, never the token. The
    // previous version selected on `reset_token`, a column that has never
    // existed, so PostgREST answered 400, no user was found, and every reset
    // reported "invalid or expired token" - which is exactly the symptom, for
    // every token, always.
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

    const { data: user, error: findError } = await supabase
      .from("workspace_users")
      .select("id, workspace_id, reset_token_expires_at")
      .eq("reset_token_hash", tokenHash)
      .maybeSingle();

    if (findError) {
      logError(findError, { route: "auth.reset-password.lookup" });
      return NextResponse.json({ error: "Internal server error" }, { status: 500, headers: CORS_HEADERS });
    }

    if (!user) {
      return NextResponse.json({ error: "Invalid or expired reset token." }, { status: 400, headers: CORS_HEADERS });
    }

    if (!user.reset_token_expires_at || new Date(user.reset_token_expires_at) < new Date()) {
      // A row with no expiry is treated as expired rather than as valid
      // forever, which is the safer direction for a credential.
      return NextResponse.json({ error: "Reset token has expired. Please request a new one." }, { status: 400, headers: CORS_HEADERS });
    }

    const passwordHash = await hashPassword(password);

    // Clearing the token in the same statement makes it single-use. Checked,
    // because a password that appears to change and does not is worse than one
    // that visibly fails.
    const { error: updateError } = await supabase
      .from("workspace_users")
      .update({ password_hash: passwordHash, reset_token_hash: null, reset_token_expires_at: null })
      .eq("id", user.id);

    if (updateError) {
      logError(updateError, { route: "auth.reset-password.update", userId: user.id });
      return NextResponse.json({ error: "Could not reset password. Please try again." }, { status: 500, headers: CORS_HEADERS });
    }

    await logAudit({
      workspace_id: user.workspace_id,
      user_id: user.id,
      action: AUDIT_ACTIONS.PASSWORD_CHANGED,
      details: { via: "reset link" },
      ip_address: getClientIp(req),
      user_agent: req.headers.get("user-agent") || "unknown",
    });

    return NextResponse.json({ ok: true, message: "Password reset successfully." }, { status: 200, headers: CORS_HEADERS });
  } catch (error: any) {
    console.error("Reset password error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500, headers: CORS_HEADERS });
  }
}
