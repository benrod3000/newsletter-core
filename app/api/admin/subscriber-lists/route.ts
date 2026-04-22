import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";
import { getAdminContextFromHeaders } from "@/lib/admin-context";

async function resolveClientId(adminClientId: string | null) {
  if (adminClientId) return adminClientId;

  const supabase = getSupabaseClient();
  const { data } = await supabase
    .from("clients")
    .select("id")
    .eq("slug", "default")
    .maybeSingle();

  return data?.id ?? null;
}

export async function GET(req: NextRequest) {
  const admin = getAdminContextFromHeaders(req.headers);
  if (!admin) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const supabase = getSupabaseClient();
  let query = supabase
    .from("subscriber_lists")
    .select("id, name, description, opt_in_type, created_at, updated_at, client_id")
    .order("created_at", { ascending: false });

  if (admin.role !== "owner" && admin.clientId) {
    query = query.eq("client_id", admin.clientId);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: `Failed to load lists: ${error.message}` }, { status: 500 });
  }

  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest) {
  const admin = getAdminContextFromHeaders(req.headers);
  if (!admin) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (admin.role === "viewer") return NextResponse.json({ error: "Forbidden." }, { status: 403 });

  const body = await req.json();
  const { name, description, opt_in_type } = body;

  if (!name || typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "List name is required." }, { status: 400 });
  }

  const validOptInTypes = ["single", "double"];
  const finalOptInType = validOptInTypes.includes(opt_in_type) ? opt_in_type : "single";

  const clientId = await resolveClientId(admin.clientId);
  if (!clientId) {
    return NextResponse.json({ error: "No workspace available." }, { status: 422 });
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("subscriber_lists")
    .insert({
      client_id: clientId,
      name: name.trim(),
      description: description?.trim() ?? null,
      opt_in_type: finalOptInType,
    })
    .select("id, name, description, opt_in_type, created_at, updated_at, client_id")
    .single();

  if (error) {
    return NextResponse.json(
      { error: error.message.includes("unique") ? "A list with this name already exists." : error.message },
      { status: 500 }
    );
  }

  return NextResponse.json(data);
}
