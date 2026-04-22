import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";
import { getAdminContextFromHeaders } from "@/lib/admin-context";
import { hashPassword } from "@/lib/jwt";

/**
 * POST /api/admin/workspace-users
 * Create a workspace user (admin only)
 * Used for setting up client portal access
 * 
 * Headers: x-admin-username, x-admin-role (must be owner), x-admin-client-id
 * 
 * Body: {
 *   email: string;
 *   password: string;
 *   role?: "owner" | "editor" | "viewer"; // default "editor"
 * }
 * 
 * Response: { id: string; email: string; role: string; workspace_id: string; }
 */
export async function POST(req: NextRequest) {
  const admin = getAdminContextFromHeaders(req.headers);
  
  // Only workspace owners can create users
  if (!admin || admin.role !== "owner") {
    return NextResponse.json(
      { error: "Unauthorized. Only workspace owners can create users." },
      { status: 401 }
    );
  }

  if (!admin.clientId) {
    return NextResponse.json(
      { error: "No workspace found." },
      { status: 422 }
    );
  }

  const body = await req.json();
  const { email, password, role = "editor" } = body;

  if (!email || !password) {
    return NextResponse.json(
      { error: "Email and password required" },
      { status: 400 }
    );
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json(
      { error: "Invalid email format" },
      { status: 400 }
    );
  }

  if (!["owner", "editor", "viewer"].includes(role)) {
    return NextResponse.json(
      { error: "Invalid role. Must be owner, editor, or viewer." },
      { status: 400 }
    );
  }

  const supabase = getSupabaseClient();

  try {
    // Hash the password
    const passwordHash = await hashPassword(password);

    // Create the workspace user
    const { data, error } = await supabase
      .from("workspace_users")
      .insert({
        workspace_id: admin.clientId,
        email,
        password_hash: passwordHash,
        role,
      })
      .select("id, email, role, workspace_id")
      .single();

    if (error) {
      console.error("Workspace user creation error:", error);
      if (error.code === "23505") {
        // Unique constraint violation
        return NextResponse.json(
          { error: "User with this email already exists in this workspace." },
          { status: 409 }
        );
      }
      return NextResponse.json(
        { error: "Failed to create workspace user" },
        { status: 500 }
      );
    }

    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    console.error("Workspace user creation endpoint error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/admin/workspace-users
 * List workspace users (admin only)
 * 
 * Headers: x-admin-username, x-admin-role, x-admin-client-id
 * 
 * Response: { users: [{id, email, role, is_active, last_login_at, ...}] }
 */
export async function GET(req: NextRequest) {
  const admin = getAdminContextFromHeaders(req.headers);

  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!admin.clientId) {
    return NextResponse.json(
      { error: "No workspace found." },
      { status: 422 }
    );
  }

  const supabase = getSupabaseClient();

  try {
    const { data, error } = await supabase
      .from("workspace_users")
      .select("id, email, role, is_active, last_login_at, created_at")
      .eq("workspace_id", admin.clientId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Workspace users fetch error:", error);
      return NextResponse.json(
        { error: "Failed to fetch workspace users" },
        { status: 500 }
      );
    }

    return NextResponse.json({ users: data || [] }, { status: 200 });
  } catch (error) {
    console.error("Workspace users endpoint error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
