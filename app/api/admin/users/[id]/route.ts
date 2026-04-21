import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";
import { getAdminContextFromHeaders } from "@/lib/admin-context";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = getAdminContextFromHeaders(req.headers);
  if (!admin) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (admin.role !== "owner") return NextResponse.json({ error: "Forbidden." }, { status: 403 });

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "User id is required." }, { status: 400 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body.action !== "string") {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const supabase = getSupabaseClient();

  if (body.action === "set-active") {
    if (typeof body.active !== "boolean") {
      return NextResponse.json({ error: "active must be boolean." }, { status: 422 });
    }

    const { error } = await supabase.rpc("set_admin_user_active", {
      p_user_id: id,
      p_active: body.active,
    });

    if (error) {
      return NextResponse.json({ error: `Failed to update user status: ${error.message}` }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  }

  if (body.action === "reset-password") {
    const password = typeof body.password === "string" ? body.password : "";
    if (password.length < 8) {
      return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 422 });
    }

    const { error } = await supabase.rpc("reset_admin_user_password", {
      p_user_id: id,
      p_password: password,
    });

    if (error) {
      return NextResponse.json({ error: `Failed to reset password: ${error.message}` }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unsupported action." }, { status: 400 });
}
