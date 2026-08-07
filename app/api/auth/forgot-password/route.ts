import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { rateLimit } from "@/lib/rate-limit";
import { sendTransactionalEmail } from "@/lib/email-sender";
import { getClientIp } from "@/lib/client-ip";
import { verifyTurnstileToken } from "@/lib/turnstile";
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
  // Rate limit: 3 requests per minute per IP
  const ip = getClientIp(req);
  const { allowed, retryAfter } = await rateLimit(`forgot-password:${ip}`, 3, 3 / 60, "closed");
  if (!allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      { status: 429, headers: { "Retry-After": String(retryAfter), "Access-Control-Allow-Origin": "*" } }
    );
  }

  try {
    const { email, turnstile_token } = await req.json();
    if (!email) {
      return NextResponse.json({ error: "Email required" }, { status: 400, headers: CORS_HEADERS });
    }

    if (!turnstile_token || !(await verifyTurnstileToken(turnstile_token))) {
      return NextResponse.json({ error: "Security check failed. Please try again." }, { status: 400, headers: CORS_HEADERS });
    }

    const supabaseUrl = process.env.SUPABASE_URL!;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const userEmail = email.toLowerCase().trim();
    const resetToken = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 3600000).toISOString();

    const findRes = await fetch(
      `${supabaseUrl}/rest/v1/workspace_users?select=id,email,workspace_id&email=eq.${encodeURIComponent(userEmail)}&limit=1`,
      { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
    );
    const users = await findRes.json();

    if (!users?.length) {
      return NextResponse.json({ ok: true }, { status: 200, headers: CORS_HEADERS });
    }

    await fetch(`${supabaseUrl}/rest/v1/workspace_users?id=eq.${users[0].id}`, {
      method: "PATCH",
      headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ reset_token: resetToken, reset_token_expires_at: expiresAt }),
    });

    // Send reset email (non-blocking)
    const appUrl = process.env.APP_URL || "https://newsletter.brod3000.com";
    const resetUrl = `${appUrl}/reset-password?token=${resetToken}`;
    // Awaited, unlike before, so a failure is observable. The response below is
    // deliberately unchanged either way - see the note there.
    let sent = false;
    try {
      sent = await sendTransactionalEmail({
      to: userEmail,
      subject: "Reset your Veloce password",
      html: `
        <div style="font-family:system-ui,sans-serif;max-width:480px;margin:40px auto;border:3px solid #0a0a0a;padding:32px;background:#f5f5f0">
          <h1 style="font-size:28px;text-transform:uppercase;letter-spacing:0.02em;margin:0 0 8px">Reset Your <span style="color:#2f7f5f">Password</span></h1>
          <p style="font-size:14px;color:#555;margin:0 0 20px">Click the button below to reset your password. This link expires in <strong>1 hour</strong>.</p>
          <a href="${resetUrl}" style="display:inline-block;padding:12px 28px;background:#f5e642;color:#0a0a0a;font-weight:bold;font-size:13px;text-transform:uppercase;letter-spacing:0.05em;text-decoration:none;border:3px solid #0a0a0a">Reset Password</a>
          <hr style="border:none;border-top:2px solid #0a0a0a;margin:20px 0" />
          <p style="font-size:11px;color:#999">If you didn't request a password reset, you can ignore this email.</p>
          <p style="font-size:11px;color:#999;word-break:break-all">Or paste this link: <a href="${resetUrl}" style="color:#2f7f5f">${resetUrl}</a></p>
        </div>
      `,
    });
    } catch (err) {
      // Logged where every other error goes, rather than a console line nobody
      // reads. This is how "password reset has never worked" stayed invisible.
      logError(err, { route: "auth.forgot-password", email: userEmail });
    }

    await logAudit({
      workspace_id: users[0].workspace_id,
      user_id: users[0].id,
      action: sent ? AUDIT_ACTIONS.PASSWORD_RESET_SENT : AUDIT_ACTIONS.PASSWORD_RESET_FAILED,
      details: { email: userEmail },
      ip_address: ip,
      user_agent: req.headers.get("user-agent") || "unknown",
    });

    // Always { ok: true }, whether the address exists, does not exist, or the
    // send failed. Responding differently would turn this endpoint into an
    // account enumeration oracle - anyone could test whether an email has an
    // account here. The operator sees the failure in Security Activity; the
    // requester deliberately cannot. Do not "improve" this by surfacing errors.
    return NextResponse.json({ ok: true }, { status: 200, headers: CORS_HEADERS });
  } catch (error: any) {
    console.error("Forgot password error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500, headers: CORS_HEADERS });
  }
}
