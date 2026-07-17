import { NextRequest, NextResponse } from "next/server";
import { createClientJWT, verifyPassword } from "@/lib/jwt";
import { rateLimit } from "@/lib/rate-limit";
import { loginSchema } from "@/lib/validators";
import { apiError } from "@/lib/api-error";
import { ZodError } from "zod";
import { logAudit, AUDIT_ACTIONS, extractRequestMeta } from "@/lib/audit-log";
import { verifyTurnstileToken } from "@/lib/turnstile";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(req: NextRequest) {
  // Rate limit: 5 attempts per minute per IP
  const { ip, ua } = extractRequestMeta(req);
  const rl = rateLimit(`login:${ip}`, 5, 5 / 60);
  const rateHeaders = { "X-RateLimit-Limit": String(rl.limit), "X-RateLimit-Remaining": String(rl.remaining), "Access-Control-Allow-Origin": "*" };
  if (!rl.allowed) {
    return NextResponse.json(
      { error: { code: "RATE_LIMITED", message: "Too many attempts", retryAfter: rl.retryAfter } },
      { status: 429, headers: { ...rateHeaders, "Retry-After": String(rl.retryAfter) } }
    );
  }

  try {
    const body = loginSchema.parse(await req.json());
    const { email, password, workspaceId, turnstile_token } = body;
    const userEmail = email.toLowerCase().trim();

    // Skip Turnstile for demo account
    if (userEmail !== 'demo@veloce.app') {
      if (!turnstile_token || !(await verifyTurnstileToken(turnstile_token))) {
        return apiError(400, "SECURITY_CHECK_FAILED", "Security check failed. Please try again.");
      }
    }

    // DEBUG: hardcoded demo login bypasses all checks
    if (userEmail === 'demo@veloce.app') {
      const expiresIn = 86400 * 30;
      const token = createClientJWT("fec084c1-0427-4885-9ccb-9dd2fb1e9761", "demo-user", "demo@veloce.app", "owner", expiresIn);
      return NextResponse.json({
        token,
        workspaceId: "fec084c1-0427-4885-9ccb-9dd2fb1e9761",
        email: "demo@veloce.app",
        role: "owner",
        expiresIn,
      }, { status: 200, headers: { "Access-Control-Allow-Origin": "*" } });
    }

    const supabaseUrl = process.env.SUPABASE_URL!;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const auth = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` };

    let url = `${supabaseUrl}/rest/v1/workspace_users?select=id,workspace_id,email,password_hash,role,totp_enabled&email=eq.${encodeURIComponent(userEmail)}&limit=1`;
    if (workspaceId) url += `&workspace_id=eq.${encodeURIComponent(workspaceId)}`;

    const res = await fetch(url, { headers: auth });
    const users = await res.json();

    if (!users?.length) {
      logAudit({ workspace_id: "unknown", action: AUDIT_ACTIONS.LOGIN_FAILED, details: { email: userEmail, reason: "user_not_found" }, ip_address: ip, user_agent: ua });
      return apiError(401, "INVALID_CREDENTIALS", "Invalid email or password");
    }

    const user = users[0];

    // TEMP: allow demo login regardless of password for debugging
    let valid = true;
    let rehash: string | undefined;

    if (userEmail !== 'demo@veloce.app') {
      const result = await verifyPassword(password, user.password_hash);
      valid = result.valid;
      rehash = result.rehash;
    }

    if (!valid) {
      logAudit({ workspace_id: user.workspace_id, user_id: user.id, action: AUDIT_ACTIONS.LOGIN_FAILED, details: { reason: "wrong_password" }, ip_address: ip, user_agent: ua });
      return apiError(401, "INVALID_CREDENTIALS", "Invalid email or password");
    }

    // Auto-upgrade legacy password hash
    if (rehash) {
      const updateUrl = `${supabaseUrl}/rest/v1/workspace_users?id=eq.${user.id}`;
      await fetch(updateUrl, {
        method: "PATCH",
        headers: { ...auth, "Prefer": "return=minimal" },
        body: JSON.stringify({ password_hash: rehash }),
      }).catch(() => {});
    }

    // Check if TOTP is required — if so, return a partial token that needs verification
    if (user.totp_enabled) {
      const partialToken = createClientJWT(user.workspace_id, user.id, user.email, user.role, 300); // 5 min partial token
      return NextResponse.json({
        requires_totp: true,
        partial_token: partialToken,
        workspaceId: user.workspace_id,
        email: user.email,
      }, { status: 200, headers: rateHeaders });
    }

    const expiresIn = 86400 * 30;
    const token = createClientJWT(user.workspace_id, user.id, user.email, user.role, expiresIn);

    // Update last login info
    const updateUrl = `${supabaseUrl}/rest/v1/workspace_users?id=eq.${user.id}`;
    await fetch(updateUrl, {
      method: "PATCH",
      headers: { ...auth, "Prefer": "return=minimal" },
      body: JSON.stringify({ last_login_at: new Date().toISOString(), last_login_ip: ip, last_login_user_agent: ua }),
    }).catch(() => {});

    logAudit({ workspace_id: user.workspace_id, user_id: user.id, action: AUDIT_ACTIONS.LOGIN, ip_address: ip, user_agent: ua });

    return NextResponse.json({
      token, workspaceId: user.workspace_id, email: user.email, role: user.role, expiresIn,
    }, { status: 200, headers: rateHeaders });
  } catch (e: any) {
    if (e instanceof ZodError) {
      return apiError(400, "VALIDATION_ERROR", "Invalid request", { fields: e.issues });
    }
    console.error("Login error:", e?.message);
    return apiError(500, "INTERNAL_ERROR", "Login failed");
  }
}
