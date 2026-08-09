import { NextResponse } from "next/server";
import { isUuid } from "@/lib/route-params";
import type { TablesUpdate } from "@/lib/database.types";
import { withWorkspace } from "@/lib/with-workspace";
import { logError } from "@/lib/logger";
import { audit, AUDIT_ACTIONS } from "@/lib/audit-log";

/**
 * DELETE /api/clients/[workspaceId]/subscriber-lists/[id]
 * Delete a subscriber list. Requires edit permission.
 *
 * This only deletes the list container - subscriber records are not affected.
 * Memberships in subscriber_list_memberships are cleaned up by the DB cascade.
 */
export const DELETE = withWorkspace<{ workspaceId: string; id: string }>(
  async ({ req, ctx, db, params }) => {
    const { id } = params;

    if (!isUuid(id)) {
      return NextResponse.json({ error: "Invalid list ID" }, { status: 422 });
    }

    // Verify the list exists and belongs to this workspace. The delete below is
    // scoped too, so this exists to distinguish 404 from a silent no-op.
    const { data: list, error: fetchError } = await db
      .from("subscriber_lists")
      .select("id")
      .eq("id", id)
      .eq("workspace_id", ctx.workspaceId)
      .maybeSingle();

    if (fetchError) {
      logError(fetchError, { route: "clients.subscriber-lists.delete", workspaceId: ctx.workspaceId, id });
      return NextResponse.json({ error: "Failed to delete list" }, { status: 500 });
    }
    if (!list) {
      return NextResponse.json({ error: "List not found" }, { status: 404 });
    }

    const { error: deleteError } = await db
      .from("subscriber_lists")
      .delete()
      .eq("id", id)
      .eq("workspace_id", ctx.workspaceId);

    if (deleteError) {
      logError(deleteError, { route: "clients.subscriber-lists.delete", workspaceId: ctx.workspaceId, id });
      return NextResponse.json({ error: "Failed to delete list" }, { status: 500 });
    }

    await audit(req, ctx, AUDIT_ACTIONS.LIST_DELETED, { list_id: id });

    return NextResponse.json({ ok: true });
  },
  { minRole: "editor" }
);

/**
 * PATCH /api/clients/[workspaceId]/subscriber-lists/[id]
 * Rename or re-describe a list.
 *
 * The Lists page previously offered delete and nothing else, so a typo in a
 * list name could only be corrected by deleting the list - which takes its
 * membership with it.
 */
export const PATCH = withWorkspace<{ workspaceId: string; id: string }>(
  async ({ req, ctx, db, params }) => {
    const { id } = params;

    if (!isUuid(id)) {
      return NextResponse.json({ error: "Invalid list ID" }, { status: 422 });
    }

    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

    const updates: Record<string, unknown> = {};
    if (typeof body.name === "string" && body.name.trim()) updates.name = body.name.trim();
    if (typeof body.description === "string") updates.description = body.description.trim() || null;
    if (body.opt_in_type === "single" || body.opt_in_type === "double") {
      updates.opt_in_type = body.opt_in_type;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    const { data, error } = await db
      .from("subscriber_lists")
      .update(updates as TablesUpdate<"subscriber_lists">)
      .eq("id", id)
      .eq("workspace_id", ctx.workspaceId)
      .select("*")
      .maybeSingle();

    if (error) {
      logError(error, { route: "clients.subscriber-lists.update", workspaceId: ctx.workspaceId, id });
      return NextResponse.json({ error: "Failed to update list" }, { status: 500 });
    }
    if (!data) return NextResponse.json({ error: "List not found" }, { status: 404 });

    await audit(req, ctx, AUDIT_ACTIONS.LIST_UPDATED, { list_id: id, fields: Object.keys(updates) });

    return NextResponse.json(data);
  },
  { minRole: "editor" }
);
