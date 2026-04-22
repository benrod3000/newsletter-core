import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";
import { getAdminContextFromHeaders } from "@/lib/admin-context";

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = getAdminContextFromHeaders(req.headers);
  if (!admin) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const { id } = await params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: "Invalid list ID." }, { status: 422 });
  }

  const supabase = getSupabaseClient();
  let query = supabase
    .from("subscriber_lists")
    .select("id, name, description, opt_in_type, created_at, updated_at, client_id")
    .eq("id", id);

  if (admin.role !== "owner" && admin.clientId) {
    query = query.eq("client_id", admin.clientId);
  }

  const { data: list, error: listError } = await query.single();
  if (listError || !list) {
    return NextResponse.json({ error: "List not found." }, { status: 404 });
  }

  const { data: members, error: membersError } = await supabase
    .from("subscriber_list_memberships")
    .select("subscriber_id")
    .eq("list_id", id);

  if (membersError) {
    return NextResponse.json({ error: `Failed to load members: ${membersError.message}` }, { status: 500 });
  }

  return NextResponse.json({
    ...list,
    memberCount: members?.length ?? 0,
  });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = getAdminContextFromHeaders(req.headers);
  if (!admin) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (admin.role === "viewer") return NextResponse.json({ error: "Forbidden." }, { status: 403 });

  const { id } = await params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: "Invalid list ID." }, { status: 422 });
  }

  const body = await req.json();
  const { name, description, opt_in_type } = body;

  if (!name || typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "List name is required." }, { status: 400 });
  }

  const validOptInTypes = ["single", "double"];
  const updateData: Record<string, unknown> = {
    name: name.trim(),
    description: description?.trim() ?? null,
    updated_at: new Date().toISOString(),
  };

  if (validOptInTypes.includes(opt_in_type)) {
    updateData.opt_in_type = opt_in_type;
  }

  const supabase = getSupabaseClient();
  let query = supabase
    .from("subscriber_lists")
    .update(updateData)
    .eq("id", id);

  if (admin.role !== "owner" && admin.clientId) {
    query = query.eq("client_id", admin.clientId);
  }

  const { data, error } = await query.select("id, name, description, opt_in_type, created_at, updated_at, client_id").single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = getAdminContextFromHeaders(req.headers);
  if (!admin) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (admin.role === "viewer") return NextResponse.json({ error: "Forbidden." }, { status: 403 });

  const { id } = await params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: "Invalid list ID." }, { status: 422 });
  }

  const supabase = getSupabaseClient();
  let query = supabase.from("subscriber_lists").delete().eq("id", id);

  if (admin.role !== "owner" && admin.clientId) {
    query = query.eq("client_id", admin.clientId);
  }

  const { error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
