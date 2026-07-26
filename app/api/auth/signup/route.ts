import { NextRequest, NextResponse } from "next/server";
import { createClientJWT, hashPassword } from "@/lib/jwt";
import { rateLimit } from "@/lib/rate-limit";
import { isDisposableEmail } from "@/lib/disposable-emails";
import { verifyTurnstileToken } from "@/lib/turnstile";
import { sendTransactionalEmail } from "@/lib/email-sender";
import { getClientIp } from "@/lib/client-ip";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

async function supabaseFetch(path: string, options: RequestInit = {}) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase env vars");

  const res = await fetch(`${url}/rest/v1${path}`, {
    ...options,
    headers: {
      "apikey": key,
      "Authorization": `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase ${res.status}: ${err}`);
  }
  return res;
}

export async function POST(req: NextRequest) {
  // Rate limit: 3 signup attempts per minute per IP
  const ip = getClientIp(req);
  const { allowed, retryAfter } = await rateLimit(`signup:${ip}`, 3, 3 / 60, "closed");
  if (!allowed) {
    return NextResponse.json(
      { error: "Too many signup attempts. Please try again later." },
      { status: 429, headers: { "Retry-After": String(retryAfter), "Access-Control-Allow-Origin": "*" } }
    );
  }

  try {
    const body = await req.json();
    const { email, password, workspace_name, turnstile_token } = body;

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "Valid email required" }, { status: 400, headers: CORS_HEADERS });
    }
    if (!password || password.length < 6) {
      return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400, headers: CORS_HEADERS });
    }

    if (!turnstile_token || !(await verifyTurnstileToken(turnstile_token))) {
      return NextResponse.json({ error: "Security check failed. Please try again." }, { status: 400, headers: CORS_HEADERS });
    }

    const userEmail = email.toLowerCase().trim();

    if (isDisposableEmail(userEmail)) {
      return NextResponse.json({ error: "Disposable email addresses are not allowed. Please use a permanent email." }, { status: 400, headers: CORS_HEADERS });
    }

    const workspaceName = (workspace_name || "My Workspace").trim();
    const passwordHash = await hashPassword(password);
    const baseSlug = userEmail.split("@")[0]
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
    const slug = `${baseSlug}-${crypto.randomUUID().split("-")[0]}`;

    // Check if email already exists
    const checkRes = await supabaseFetch(
      `/workspace_users?select=id&email=eq.${encodeURIComponent(userEmail)}&limit=1`,
      { headers: { "Prefer": "count=exact" } }
    );
    const existing = await checkRes.json();
    if (existing && existing.length > 0) {
      return NextResponse.json({ error: "An account with this email already exists." }, { status: 409, headers: CORS_HEADERS });
    }

    // Create workspace via REST API (slug includes a random suffix, so collisions are near-impossible)
    let workspaceId: string | null = null;

    try {
      const wsRes = await supabaseFetch("/clients", {
        method: "POST",
        body: JSON.stringify({ name: workspaceName, slug }),
        headers: { "Prefer": "return=representation" },
      });
      const wsData = await wsRes.json();
      workspaceId = wsData?.[0]?.id || null;
    } catch (err) {
      console.error("Workspace creation failed:", err);
      return NextResponse.json(
        { error: "Unable to create workspace. Please try again." },
        { status: 500, headers: CORS_HEADERS }
      );
    }

    // If Supabase returned no data despite a 2xx response, fail safely
    if (!workspaceId) {
      console.error("Workspace creation returned no ID");
      return NextResponse.json(
        { error: "Unable to set up workspace. Please try again." },
        { status: 500, headers: CORS_HEADERS }
      );
    }

    // Create user
    const userRes = await supabaseFetch("/workspace_users", {
      method: "POST",
      body: JSON.stringify({
        workspace_id: workspaceId,
        email: userEmail,
        password_hash: passwordHash,
        role: "owner",
        is_active: true,
      }),
      headers: { "Prefer": "return=representation" },
    });
    const userData = await userRes.json();
    const user = userData?.[0];

    if (!user) {
      return NextResponse.json({ error: "Failed to create user" }, { status: 500, headers: CORS_HEADERS });
    }

    const expiresIn = 86400 * 30;
    const token = createClientJWT(user.workspace_id, user.id, user.email, "owner", expiresIn);

    // Send welcome email (non-blocking - don't fail signup if email fails)
    sendTransactionalEmail({
      to: userEmail,
      subject: "Welcome to Veloce!",
      html: `
        <div style="font-family:system-ui,sans-serif;max-width:480px;margin:40px auto;border:3px solid #0a0a0a;padding:32px;background:#f5f5f0">
          <h1 style="font-size:28px;text-transform:uppercase;letter-spacing:0.02em;margin:0 0 8px">Welcome to <span style="color:#2f7f5f">Veloce</span></h1>
          <p style="font-size:14px;color:#555;margin:0 0 20px">Your workspace <strong>${workspaceName}</strong> is ready.</p>
          <hr style="border:none;border-top:2px solid #0a0a0a;margin:16px 0" />
          <p style="font-size:13px;color:#555">Start building your audience right away:</p>
          <ul style="font-size:13px;color:#555;padding-left:20px">
            <li><strong>Import subscribers</strong> from your Dashboard</li>
            <li><strong>Create a newsletter</strong> with our drag-free editor</li>
            <li><strong>Connect SendGrid or SES</strong> in Settings to start sending</li>
          </ul>
          <hr style="border:none;border-top:2px solid #0a0a0a;margin:16px 0" />
          <a href="${process.env.APP_URL || "https://newsletter.brod3000.com"}/dashboard" style="display:inline-block;padding:12px 28px;background:#f5e642;color:#0a0a0a;font-weight:bold;font-size:13px;text-transform:uppercase;letter-spacing:0.05em;text-decoration:none;border:3px solid #0a0a0a">Go to Dashboard</a>
          <p style="font-size:11px;color:#999;margin-top:20px">If you didn't sign up for Veloce, you can ignore this email.</p>
        </div>
      `,
    }).catch(err => console.error("Welcome email failed:", err));

    return NextResponse.json({
      token,
      workspaceId: user.workspace_id,
      email: user.email,
      role: "owner",
      expiresIn,
      workspace_name: workspaceName,
    }, { status: 201, headers: CORS_HEADERS });
  } catch (error: any) {
    console.error("Signup error:", error?.message || error, error?.stack?.slice(0, 500));
    return NextResponse.json(
      { error: error?.message || "Internal server error" },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
