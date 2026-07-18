import { NextRequest, NextResponse } from "next/server";
import { createClientJWT, verifyPassword } from "@/lib/jwt";

/**
 * POST /api/auth/demo-login
 * Login for demo@veloce.app only. Bypasses Turnstile.
 * Uses normal password verification.
 */
export async function POST(req: NextRequest) {
  try {
    const { password } = await req.json();
    if (!password) {
      return NextResponse.json({ error: "Password required" }, { status: 400 });
    }

    const supabaseUrl = process.env.SUPABASE_URL!;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const auth = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, "Content-Type": "application/json" };

    const findRes = await fetch(
      `${supabaseUrl}/rest/v1/workspace_users?select=id,workspace_id,email,password_hash,role&email=eq.demo%40veloce.app&limit=1`,
      { headers: auth }
    );
    const users = await findRes.json();

    if (!Array.isArray(users) || users.length === 0) {
      return NextResponse.json({ error: "Demo user not found" }, { status: 404 });
    }

    const user = users[0];
    const { valid } = await verifyPassword(password, user.password_hash);

    if (!valid) {
      return NextResponse.json({ error: "Invalid password" }, { status: 401 });
    }

    const expiresIn = 86400 * 30;
    const token = createClientJWT(user.workspace_id, user.id, user.email, user.role, expiresIn);

    return NextResponse.json({
      token,
      workspaceId: user.workspace_id,
      email: user.email,
      role: user.role,
      expiresIn,
    });
  } catch (err: any) {
    console.error("Demo login error:", err?.message || err);
    return NextResponse.json({ error: "Login failed" }, { status: 500 });
  }
}
