import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";
import { createClientJWT, verifyPassword } from "@/lib/jwt";

/**
 * POST /api/auth/token
 * Client login endpoint - exchange email + password for JWT token
 * 
 * Body: {
 *   email: string;
 *   password: string;
 *   workspaceId?: string; // optional, for specific workspace login
 * }
 * 
 * Response: {
 *   token: string;
 *   workspaceId: string;
 *   email: string;
 *   role: "owner" | "editor" | "viewer";
 *   expiresIn: number; // seconds
 * }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email, password, workspaceId } = body;

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password required" },
        { status: 400 }
      );
    }

    const supabase = getSupabaseClient();

    // Find workspace user by email
    let query = supabase
      .from("workspace_users")
      .select("id, workspace_id, email, password_hash, role, is_active")
      .eq("email", email)
      .eq("is_active", true);

    // If workspaceId provided, filter to that workspace
    if (workspaceId) {
      query = query.eq("workspace_id", workspaceId);
    }

    const { data: user, error: userError } = await query.maybeSingle();

    if (userError || !user) {
      return NextResponse.json(
        { error: "Invalid email or password" },
        { status: 401 }
      );
    }

    // Verify password
    const passwordValid = await verifyPassword(password, user.password_hash);
    if (!passwordValid) {
      return NextResponse.json(
        { error: "Invalid email or password" },
        { status: 401 }
      );
    }

    // Create JWT token (30 day expiry)
    const expiresInSeconds = 86400 * 30;
    const token = createClientJWT(
      user.workspace_id,
      user.id,
      user.email,
      user.role as "owner" | "editor" | "viewer",
      expiresInSeconds
    );

    // Update last_login_at
    await supabase
      .from("workspace_users")
      .update({ last_login_at: new Date().toISOString() })
      .eq("id", user.id);

    return NextResponse.json(
      {
        token,
        workspaceId: user.workspace_id,
        email: user.email,
        role: user.role,
        expiresIn: expiresInSeconds,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Auth token error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
