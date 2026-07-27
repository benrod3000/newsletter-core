import { NextResponse } from "next/server";
import { withWorkspace } from "@/lib/with-workspace";
import { isUuid } from "@/lib/route-params";
import { logError } from "@/lib/logger";

/**
 * DELETE /api/clients/[workspaceId]/segments/[id]
 */
export const DELETE = withWorkspace<{ workspaceId: string; id: string }>(
  async ({ ctx, db, params }) => {
    const { id } = params;

    if (!isUuid(id)) {
      return NextResponse.json({ error: "Invalid segment ID" }, { status: 422 });
    }

    const { error } = await db
      .from("saved_segments")
      .delete()
      .eq("id", id)
      .eq("workspace_id", ctx.workspaceId);

    if (error) {
      logError(error, { workspaceId: ctx.workspaceId, segmentId: id, action: "delete-segment" });
      return NextResponse.json({ error: "Failed to delete segment" }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  },
  // canEditAsClient was imported here but never called, so a viewer could delete
  // saved segments. Expressing the gate as minRole makes forgetting to call it
  // impossible rather than merely unlikely.
  { minRole: "editor" }
);
