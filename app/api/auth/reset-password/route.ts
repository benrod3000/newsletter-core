import { NextRequest, NextResponse } from "next/server";
import { hashPassword } from "@/lib/jwt";
import { rateLimit } from "@/lib/rate-limit";

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
  const forwarded = req.headers.get("x-forwarded-for");
  const ip = forwarded ? forwarded.split(",")[0].trim() : req.headers.get("x-real-ip") || "unknown";
  const { allowed, retryAfter } = await rateLimit(`reset-password:${ip}`, 3, 3 / 60, "closed");
  if (!allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Please try again later." },
      { status: 429, headers: { "Retry-After": String(retryAfter), "Access-Control-Allow-Origin": "*" } }
    );
  }

  try {
    const { token, password } = await req.json();
    if (!token || !password || password.length < 6) {
      return NextResponse.json({ error: "Valid token and password (6+ chars) required" }, { status: 400, headers: CORS_HEADERS });
    }

    const supabaseUrl = process.env.SUPABASE_URL!;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

    const findRes = await fetch(
      `${supabaseUrl}/rest/v1/workspace_users?select=id,reset_token,reset_token_expires_at&reset_token=eq.${encodeURIComponent(token)}&limit=1`,
      { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
    );
    const users = await findRes.json();

    if (!users?.length) {
      return NextResponse.json({ error: "Invalid or expired reset token." }, { status: 400, headers: CORS_HEADERS });
    }

    const user = users[0];
    if (user.reset_token_expires_at && new Date(user.reset_token_expires_at) < new Date()) {
      return NextResponse.json({ error: "Reset token has expired. Please request a new one." }, { status: 400, headers: CORS_HEADERS });
    }

    const passwordHash = await hashPassword(password);
    await fetch(`${supabaseUrl}/rest/v1/workspace_users?id=eq.${user.id}`, {
      method: "PATCH",
      headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ password_hash: passwordHash, reset_token: null, reset_token_expires_at: null }),
    });

    return NextResponse.json({ ok: true, message: "Password reset successfully." }, { status: 200, headers: CORS_HEADERS });
  } catch (error: any) {
    console.error("Reset password error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500, headers: CORS_HEADERS });
  }
}
