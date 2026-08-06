import { NextResponse } from "next/server";
import { isUuid } from "@/lib/route-params";
import { withWorkspace } from "@/lib/with-workspace";
import { logError } from "@/lib/logger";
import { audit, AUDIT_ACTIONS } from "@/lib/audit-log";

/**
 * DELETE /api/clients/[workspaceId]/subscribers/[id]
 * Remove a subscriber from the workspace. Requires edit permission.
 *
 * This is a hard-delete - the subscriber row is removed entirely.
 * (Unsubscribing via the public /api/unsubscribe endpoint also hard-deletes.)
 *
 * Both are the compliance problem ARCHITECTURE.md invariant 5 names: nothing
 * with compliance meaning should be deleted, it should be tombstoned. Suppression
 * as a record is one of the two items accruing cost daily - every hard-delete
 * loses the proof that consent was withdrawn, and the churn analytics with it.
 * Phase 1 replaces this with ChannelIdentity + suppression state.
 */
export const DELETE = withWorkspace<{ workspaceId: string; id: string }>(
  async ({ req, ctx, db, params }) => {
    const { id } = params;

    if (!isUuid(id)) {
      return NextResponse.json({ error: "Invalid subscriber ID" }, { status: 422 });
    }

    const { data: subscriber, error: fetchError } = await db
      .from("subscribers")
      .select("id")
      .eq("id", id)
      .eq("workspace_id", ctx.workspaceId)
      .maybeSingle();

    if (fetchError) {
      logError(fetchError, { route: "clients.subscribers.delete", workspaceId: ctx.workspaceId, id });
      return NextResponse.json({ error: "Failed to delete subscriber" }, { status: 500 });
    }
    if (!subscriber) {
      return NextResponse.json({ error: "Subscriber not found" }, { status: 404 });
    }

    const { error: deleteError } = await db
      .from("subscribers")
      .delete()
      .eq("id", id)
      .eq("workspace_id", ctx.workspaceId);

    if (deleteError) {
      logError(deleteError, { route: "clients.subscribers.delete", workspaceId: ctx.workspaceId, id });
      return NextResponse.json({ error: "Failed to delete subscriber" }, { status: 500 });
    }

    await audit(req, ctx, AUDIT_ACTIONS.SUBSCRIBER_DELETED, { deleted: 1, ids: [id], source: "single" });

    return NextResponse.json({ ok: true });
  },
  { minRole: "editor" }
);
