import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";
import { getAdminContextFromHeaders } from "@/lib/admin-context";

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function POST(
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
  const { subscriberIds } = body;

  if (!Array.isArray(subscriberIds)) {
    return NextResponse.json({ error: "subscriberIds must be an array." }, { status: 400 });
  }

  const supabase = getSupabaseClient();
  let listQuery = supabase
    .from("subscriber_lists")
    .select("id, client_id")
    .eq("id", id);

  if (admin.role !== "owner" && admin.clientId) {
    listQuery = listQuery.eq("client_id", admin.clientId);
  }

  const { data: list, error: listError } = await listQuery.single();
  if (listError || !list) {
    return NextResponse.json({ error: "List not found." }, { status: 404 });
  }

  const inserts = subscriberIds.map((sid: string) => ({
    list_id: id,
    subscriber_id: sid,
  }));

  const { error } = await supabase.from("subscriber_list_memberships").insert(inserts);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, added: subscriberIds.length });
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

  const body = await req.json();
  const { subscriberIds } = body;

  if (!Array.isArray(subscriberIds)) {
    return NextResponse.json({ error: "subscriberIds must be an array." }, { status: 400 });
  }

  const supabase = getSupabaseClient();
  let query = supabase
    .from("subscriber_list_memberships")
    .delete()
    .eq("list_id", id)
    .in("subscriber_id", subscriberIds);

  const { error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, removed: subscriberIds.length });
}
