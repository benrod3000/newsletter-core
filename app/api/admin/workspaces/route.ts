import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";
import { getAdminContextFromHeaders } from "@/lib/admin-context";

function isMissingSchemaObject(error: { code?: string; message?: string } | null | undefined) {
  if (!error) return false;
  const message = (error.message ?? "").toLowerCase();
  return (
    error.code === "PGRST205" ||
    message.includes("could not find the table") ||
    message.includes("relation") && message.includes("does not exist")
  );
}

function normalizeSlug(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export async function GET(req: NextRequest) {
  const admin = getAdminContextFromHeaders(req.headers);
  if (!admin) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (admin.role !== "owner") return NextResponse.json({ error: "Forbidden." }, { status: 403 });

  const supabase = getSupabaseClient();

  const [{ data: clients, error: clientsError }, { data: users, error: usersError }] = await Promise.all([
    supabase.from("clients").select("id, name, slug, created_at").order("created_at", { ascending: true }),
    supabase
      .from("admin_users")
      .select("id, username, role, active, client_id, created_at")
      .order("created_at", { ascending: false }),
  ]);

  if (clientsError) {
    if (isMissingSchemaObject(clientsError)) {
      return NextResponse.json({
        clients: [],
        users: [],
        setupRequired: true,
        setupMessage:
          "Admin workspace tables are missing. Run Supabase migrations 006-010 (or at least 006-008) to enable workspaces.",
      });
    }
    return NextResponse.json({ error: `Failed to load workspaces: ${clientsError.message}` }, { status: 500 });
  }

  if (usersError) {
    if (isMissingSchemaObject(usersError)) {
      return NextResponse.json({
        clients: clients ?? [],
        users: [],
        setupRequired: true,
        setupMessage:
          "Admin user table is missing. Run Supabase migrations 006-010 (or at least 006-008) to enable workspace users.",
      });
    }
    return NextResponse.json({ error: `Failed to load users: ${usersError.message}` }, { status: 500 });
  }

  return NextResponse.json({ clients: clients ?? [], users: users ?? [], setupRequired: false });
}

export async function POST(req: NextRequest) {
  const admin = getAdminContextFromHeaders(req.headers);
  if (!admin) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (admin.role !== "owner") return NextResponse.json({ error: "Forbidden." }, { status: 403 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body.name !== "string") {
    return NextResponse.json({ error: "Workspace name is required." }, { status: 400 });
  }

  const name = body.name.trim();
  const slugInput = typeof body.slug === "string" && body.slug.trim() ? body.slug : name;
  const slug = normalizeSlug(slugInput);

  if (!name) {
    return NextResponse.json({ error: "Workspace name is required." }, { status: 422 });
  }

  if (!slug) {
    return NextResponse.json({ error: "Workspace slug is invalid." }, { status: 422 });
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("create_client_workspace", {
    p_name: name,
    p_slug: slug,
  });

  if (error) {
    return NextResponse.json({ error: `Failed to create workspace: ${error.message}` }, { status: 500 });
  }

  return NextResponse.json({ ok: true, id: data, slug }, { status: 201 });
}
