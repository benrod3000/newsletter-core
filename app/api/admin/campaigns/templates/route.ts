import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";
import { getAdminContextFromHeaders, canEditCampaigns } from "@/lib/admin-context";

/**
 * GET /api/admin/campaigns/templates
 * Returns all templates for the admin's workspace.
 */
export async function GET(request: NextRequest) {
  const admin = getAdminContextFromHeaders(request.headers);
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized. Missing or invalid admin context." }, { status: 401 });
  }

  const clientId = admin.clientId;
  if (!clientId) {
    return NextResponse.json({ error: "No workspace selected." }, { status: 422 });
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("campaign_templates")
    .select("*")
    .eq("workspace_id", clientId)
    .order("updated_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: `Failed to fetch templates: ${error.message}` }, { status: 500 });
  }

  return NextResponse.json({ templates: data || [] });
}

/**
 * POST /api/admin/campaigns/templates
 * Creates a new template from the current campaign data.
 */
export async function POST(request: NextRequest) {
  const admin = getAdminContextFromHeaders(request.headers);
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  if (!canEditCampaigns(admin)) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const clientId = admin.clientId;
  if (!clientId) {
    return NextResponse.json({ error: "No workspace selected." }, { status: 422 });
  }

  let body: { name?: string; subject?: string; editor_html?: string; audience?: string; category?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 422 });
  }

  if (!body.name?.trim()) {
    return NextResponse.json({ error: "Template name is required." }, { status: 422 });
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("campaign_templates")
    .insert([{
      workspace_id: clientId,
      name: body.name.trim(),
      subject: body.subject || null,
      editor_html: body.editor_html || null,
      audience: body.audience || "confirmed",
      category: body.category || null,
    }])
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: `Failed to save template: ${error.message}` }, { status: 500 });
  }

  return NextResponse.json({ template: data }, { status: 201 });
}
