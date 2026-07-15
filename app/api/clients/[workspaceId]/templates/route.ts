import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";
import { getClientContextFromJWT, assertWorkspaceAccess, canEditAsClient } from "@/lib/client-context";

/**
 * GET /api/clients/{workspaceId}/templates
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const context = getClientContextFromJWT(request);
  if (!context || !assertWorkspaceAccess(context, workspaceId)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("campaign_templates")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("updated_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: `Failed to fetch templates: ${error.message}` }, { status: 500 });
  }

  return NextResponse.json({ templates: data || [] });
}

/**
 * POST /api/clients/{workspaceId}/templates
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const context = getClientContextFromJWT(request);
  if (!context || !assertWorkspaceAccess(context, workspaceId)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canEditAsClient(context)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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
      workspace_id: workspaceId,
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
