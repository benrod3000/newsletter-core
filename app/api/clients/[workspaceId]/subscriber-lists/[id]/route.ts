import { NextResponse } from "next/server";
import { isUuid } from "@/lib/route-params";
import { withWorkspace } from "@/lib/with-workspace";
import { logError } from "@/lib/logger";

/**
 * DELETE /api/clients/[workspaceId]/subscriber-lists/[id]
 * Delete a subscriber list. Requires edit permission.
 *
 * This only deletes the list container - subscriber records are not affected.
 * Memberships in subscriber_list_memberships are cleaned up by the DB cascade.
 */
export const DELETE = withWorkspace<{ workspaceId: string; id: string }>(
  async ({ ctx, db, params }) => {
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

    return NextResponse.json({ ok: true });
  },
  { minRole: "editor" }
);
