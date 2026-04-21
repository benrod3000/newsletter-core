import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";
import { getAdminContextFromHeaders } from "@/lib/admin-context";

type Role = "owner" | "editor" | "viewer";

function parseRole(value: unknown): Role | null {
  if (value === "owner" || value === "editor" || value === "viewer") return value;
  return null;
}

export async function POST(req: NextRequest) {
  const admin = getAdminContextFromHeaders(req.headers);
  if (!admin) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (admin.role !== "owner") return NextResponse.json({ error: "Forbidden." }, { status: 403 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body.username !== "string" || typeof body.password !== "string") {
    return NextResponse.json({ error: "Username and password are required." }, { status: 400 });
  }

  const username = body.username.trim().toLowerCase();
  const password = body.password;
  const role = parseRole(body.role);
  const clientId = typeof body.clientId === "string" && body.clientId.trim() ? body.clientId : null;

  if (!username || !role) {
    return NextResponse.json({ error: "Username and role are required." }, { status: 422 });
  }

  if (password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 422 });
  }

  if (role !== "owner" && !clientId) {
    return NextResponse.json({ error: "Workspace is required for editor/viewer." }, { status: 422 });
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("create_admin_user", {
    p_username: username,
    p_password: password,
    p_role: role,
    p_client_id: role === "owner" ? null : clientId,
  });

  if (error) {
    return NextResponse.json({ error: `Failed to create user: ${error.message}` }, { status: 500 });
  }

  return NextResponse.json({ ok: true, id: data }, { status: 201 });
}
