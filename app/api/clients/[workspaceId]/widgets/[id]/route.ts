import { NextResponse } from "next/server";
import { isUuid } from "@/lib/route-params";
import { withWorkspace } from "@/lib/with-workspace";
import { logError } from "@/lib/logger";
import { isWidgetSize, WIDGET_SIZES } from "@/lib/widget-config";

const ALLOWED_FIELDS = [
  "name", "headline", "description", "download_url",
  "button_text", "success_message", "placeholder", "list_id", "is_active",
  "fields", "styles", "type", "size", "collect_location",
  // Operator-written copy for the lead magnet delivery email. Empty means "use
  // the built-in wording", which is why these are nullable rather than defaulted.
  "email_subject", "email_body",
] as const;

/**
 * PATCH /api/clients/[workspaceId]/widgets/[id]
 * Update a widget's configuration. Requires edit permission.
 */
export const PATCH = withWorkspace<{ workspaceId: string; id: string }>(
  async ({ req, ctx, db, params }) => {
    const { id } = params;

    if (!isUuid(id)) {
      return NextResponse.json({ error: "Invalid widget ID" }, { status: 422 });
    }

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { data: existing, error: fetchError } = await db
      .from("widgets")
      .select("id")
      .eq("id", id)
      .eq("workspace_id", ctx.workspaceId)
      .maybeSingle();

    if (fetchError) {
      logError(fetchError, { route: "clients.widgets.update", workspaceId: ctx.workspaceId, id });
      return NextResponse.json({ error: "Failed to update widget" }, { status: 500 });
    }
    if (!existing) {
      return NextResponse.json({ error: "Widget not found" }, { status: 404 });
    }

    if (body.size !== undefined && !isWidgetSize(body.size)) {
      return NextResponse.json(
        { error: `Size must be one of: ${WIDGET_SIZES.join(", ")}` },
        { status: 400 }
      );
    }

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    for (const field of ALLOWED_FIELDS) {
      if (body[field] !== undefined) {
        updates[field] = typeof body[field] === "string" ? (body[field] as string).trim() : body[field];
      }
    }

    if (Object.keys(updates).length <= 1) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    const { data, error } = await db
      .from("widgets")
      .update(updates)
      .eq("id", id)
      .eq("workspace_id", ctx.workspaceId)
      .select()
      .single();

    if (error) {
      logError(error, { route: "clients.widgets.update", workspaceId: ctx.workspaceId, id });
      return NextResponse.json({ error: "Failed to update widget" }, { status: 500 });
    }

    return NextResponse.json({ widget: data }, { status: 200 });
  },
  { minRole: "editor" }
);

/**
 * DELETE /api/clients/[workspaceId]/widgets/[id]
 * Delete a widget and its submissions. Requires edit permission.
 */
export const DELETE = withWorkspace<{ workspaceId: string; id: string }>(
  async ({ ctx, db, params }) => {
    const { id } = params;

    if (!isUuid(id)) {
      return NextResponse.json({ error: "Invalid widget ID" }, { status: 422 });
    }

    const { data: existing, error: fetchError } = await db
      .from("widgets")
      .select("id")
      .eq("id", id)
      .eq("workspace_id", ctx.workspaceId)
      .maybeSingle();

    if (fetchError) {
      logError(fetchError, { route: "clients.widgets.delete", workspaceId: ctx.workspaceId, id });
      return NextResponse.json({ error: "Failed to delete widget" }, { status: 500 });
    }
    if (!existing) {
      return NextResponse.json({ error: "Widget not found" }, { status: 404 });
    }

    const { error: deleteError } = await db
      .from("widgets")
      .delete()
      .eq("id", id)
      .eq("workspace_id", ctx.workspaceId);

    if (deleteError) {
      logError(deleteError, { route: "clients.widgets.delete", workspaceId: ctx.workspaceId, id });
      return NextResponse.json({ error: "Failed to delete widget" }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  },
  { minRole: "editor" }
);
