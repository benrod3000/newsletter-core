import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";
import { getClientContextFromJWT, assertWorkspaceAccess } from "@/lib/client-context";
import { hashPassword } from "@/lib/jwt";

/**
 * GET /api/clients/[workspaceId]/users
 * List workspace users. Owner only.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params;
  const ctx = getClientContextFromJWT(req);
  if (!ctx || !assertWorkspaceAccess(ctx, workspaceId) || ctx.role !== "owner")
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("workspace_users")
    .select("id, email, role, is_active, last_login_at, created_at")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("List workspace users error:", error);
    return NextResponse.json({ error: "Failed to list users" }, { status: 500 });
  }

  return NextResponse.json({ users: data || [] });
}

/**
 * POST /api/clients/[workspaceId]/users
 * Create a workspace user. Owner only.
 * Body: { email, password, role? }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params;
  const ctx = getClientContextFromJWT(req);
  if (!ctx || !assertWorkspaceAccess(ctx, workspaceId) || ctx.role !== "owner")
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { email, password, role = "editor" } = body;

  if (!email || !password)
    return NextResponse.json({ error: "Email and password required" }, { status: 400 });

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return NextResponse.json({ error: "Invalid email format" }, { status: 400 });

  if (!["owner", "editor", "viewer"].includes(role))
    return NextResponse.json({ error: "Invalid role. Must be owner, editor, or viewer." }, { status: 400 });

  const supabase = getSupabaseClient();

  try {
    const passwordHash = await hashPassword(password);
    const { data, error } = await supabase
      .from("workspace_users")
      .insert({ workspace_id: workspaceId, email, password_hash: passwordHash, role })
      .select("id, email, role")
      .single();

    if (error) {
      if (error.code === "23505")
        return NextResponse.json({ error: "User with this email already exists." }, { status: 409 });
      return NextResponse.json({ error: "Failed to create user" }, { status: 500 });
    }

    return NextResponse.json(data, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
