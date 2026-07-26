import { NextRequest, NextResponse } from "next/server";
import { getClientContextFromJWT, assertWorkspaceAccess, canEditAsClient } from "@/lib/client-context";
import { getSupabaseClient } from "@/lib/supabase";
import { isUuid } from "@/lib/route-params";
import { logError } from "@/lib/logger";

/**
 * DELETE /api/clients/[workspaceId]/segments/[id]
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string; id: string }> }
) {
  const { workspaceId, id } = await params;
  const ctx = getClientContextFromJWT(req);
  if (!ctx || !assertWorkspaceAccess(ctx, workspaceId))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // canEditAsClient was imported but never enforced here - a viewer could
  // delete saved segments.
  if (!canEditAsClient(ctx)) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  if (!isUuid(id)) {
    return NextResponse.json({ error: "Invalid segment ID" }, { status: 422 });
  }

  try {
    const { error } = await getSupabaseClient()
      .from("saved_segments")
      .delete()
      .eq("id", id)
      .eq("workspace_id", workspaceId);

    if (error) {
      logError(error, { workspaceId, segmentId: id, action: "delete-segment" });
      return NextResponse.json({ error: "Failed to delete segment" }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    logError(err, { workspaceId, segmentId: id, action: 'delete-segment' });
    return NextResponse.json({ error: "Failed to delete segment" }, { status: 500 });
  }
}
