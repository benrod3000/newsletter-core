import { NextRequest, NextResponse } from "next/server";
import { createClientJWT, verifyPassword } from "@/lib/jwt";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(req: NextRequest) {
  try {
    const { email, password, workspaceId } = await req.json();
    if (!email || !password) {
      return NextResponse.json({ error: "Email and password required" }, { status: 400, headers: CORS_HEADERS });
    }

    const supabaseUrl = process.env.SUPABASE_URL!;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const userEmail = email.toLowerCase().trim();
    const auth = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` };

    let url = `${supabaseUrl}/rest/v1/workspace_users?select=id,workspace_id,email,password_hash,role&email=eq.${encodeURIComponent(userEmail)}&is_active=eq.true&limit=1`;
    if (workspaceId) url += `&workspace_id=eq.${encodeURIComponent(workspaceId)}`;

    const res = await fetch(url, { headers: auth });
    const users = await res.json();

    if (!users?.length) {
      return NextResponse.json({ error: "Invalid email or password" }, { status: 401, headers: CORS_HEADERS });
    }

    const user = users[0];
    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) {
      return NextResponse.json({ error: "Invalid email or password" }, { status: 401, headers: CORS_HEADERS });
    }

    const expiresIn = 86400 * 30;
    const token = createClientJWT(user.workspace_id, user.id, user.email, user.role, expiresIn);

    return NextResponse.json({
      token, workspaceId: user.workspace_id, email: user.email, role: user.role, expiresIn,
    }, { status: 200, headers: CORS_HEADERS });
  } catch (e: any) {
    console.error("Login error:", e?.message);
    return NextResponse.json({ error: "Login failed" }, { status: 500, headers: CORS_HEADERS });
  }
}
