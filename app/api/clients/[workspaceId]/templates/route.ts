import { NextResponse } from "next/server";
import { withWorkspace } from "@/lib/with-workspace";

/**
 * GET /api/clients/{workspaceId}/templates
 */
export const GET = withWorkspace(async ({ ctx, db }) => {
  const { data, error } = await db
    .from("campaign_templates")
    .select("*")
    .eq("workspace_id", ctx.workspaceId)
    .order("updated_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: `Failed to fetch templates: ${error.message}` }, { status: 500 });
  }

  return NextResponse.json({ templates: data || [] });
});

/**
 * POST /api/clients/{workspaceId}/templates
 */
export const POST = withWorkspace(
  async ({ req, ctx, db }) => {
    let body: { name?: string; subject?: string; editor_html?: string; audience?: string; category?: string };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 422 });
    }

    if (!body.name?.trim()) {
      return NextResponse.json({ error: "Template name is required." }, { status: 422 });
    }

    const { data, error } = await db
      .from("campaign_templates")
      .insert([{
        workspace_id: ctx.workspaceId,
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
  },
  { minRole: "editor" }
);
