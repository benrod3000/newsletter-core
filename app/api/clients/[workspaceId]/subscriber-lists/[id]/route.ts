import { NextRequest, NextResponse } from "next/server";
import { isUuid } from "@/lib/route-params";
import { getSupabaseClient } from "@/lib/supabase";
import {
  getClientContextFromJWT,
  assertWorkspaceAccess,
  canEditAsClient,
} from "@/lib/client-context";

/**
 * DELETE /api/clients/[workspaceId]/subscriber-lists/[id]
 * Delete a subscriber list. JWT authenticated, requires edit permission.
 *
 * This only deletes the list container - subscriber records are not affected.
 * Memberships in subscriber_list_memberships are cleaned up by the DB cascade.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string; id: string }> }
) {
  const { workspaceId, id } = await params;
  const context = getClientContextFromJWT(req);

  if (!context || !assertWorkspaceAccess(context, workspaceId)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!canEditAsClient(context)) {
    return NextResponse.json(
      { error: "Insufficient permissions" },
      { status: 403 }
    );
  }

  if (!isUuid(id)) {
    return NextResponse.json({ error: "Invalid list ID" }, { status: 422 });
  }

  const supabase = getSupabaseClient();

  // Verify the list exists and belongs to this workspace.
  const { data: list, error: fetchError } = await supabase
    .from("subscriber_lists")
    .select("id")
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .single();

  if (fetchError || !list) {
    return NextResponse.json(
      { error: "List not found" },
      { status: 404 }
    );
  }

  const { error: deleteError } = await supabase
    .from("subscriber_lists")
    .delete()
    .eq("id", id)
    .eq("workspace_id", workspaceId);

  if (deleteError) {
    console.error("List delete error:", deleteError);
    return NextResponse.json(
      { error: "Failed to delete list" },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
