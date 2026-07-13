import { NextRequest, NextResponse } from "next/server";
import { createClientJWT, verifyPassword } from "@/lib/jwt";
import { rateLimit } from "@/lib/rate-limit";
import { loginSchema } from "@/lib/validators";
import { apiError } from "@/lib/api-error";
import { ZodError } from "zod";

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
  const ip = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "unknown";
  const { allowed, retryAfter } = rateLimit(`login:${ip}`, 5, 5 / 60);
  if (!allowed) {
    return NextResponse.json(
      { error: { code: "RATE_LIMITED", message: "Too many attempts", retryAfter } },
      { status: 429, headers: { "Retry-After": String(retryAfter), "Access-Control-Allow-Origin": "*" } }
    );
  }

  try {
    const body = loginSchema.parse(await req.json());
    const { email, password, workspaceId } = body;
    const supabaseUrl = process.env.SUPABASE_URL!;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const userEmail = email.toLowerCase().trim();
    const auth = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` };

    let url = `${supabaseUrl}/rest/v1/workspace_users?select=id,workspace_id,email,password_hash,role&email=eq.${encodeURIComponent(userEmail)}&is_active=eq.true&limit=1`;
    if (workspaceId) url += `&workspace_id=eq.${encodeURIComponent(workspaceId)}`;

    const res = await fetch(url, { headers: auth });
    const users = await res.json();

    if (!users?.length) {
      return apiError(401, "INVALID_CREDENTIALS", "Invalid email or password");
    }

    const user = users[0];
    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) {
      return apiError(401, "INVALID_CREDENTIALS", "Invalid email or password");
    }

    const expiresIn = 86400 * 30;
    const token = createClientJWT(user.workspace_id, user.id, user.email, user.role, expiresIn);

    return NextResponse.json({
      token, workspaceId: user.workspace_id, email: user.email, role: user.role, expiresIn,
    }, { status: 200, headers: { "Access-Control-Allow-Origin": "*" } });
  } catch (e: any) {
    if (e instanceof ZodError) {
      return apiError(400, "VALIDATION_ERROR", "Invalid request", { fields: e.errors });
    }
    console.error("Login error:", e?.message);
    return apiError(500, "INTERNAL_ERROR", "Login failed");
  }
}
