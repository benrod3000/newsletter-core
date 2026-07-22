import { NextRequest, NextResponse } from "next/server";
import { isUuid } from "@/lib/route-params";
import { getSupabaseClient } from "@/lib/supabase";
import {
  getClientContextFromJWT,
  assertWorkspaceAccess,
  canEditAsClient,
} from "@/lib/client-context";

/**
 * DELETE /api/clients/[workspaceId]/subscribers/[id]
 * Remove a subscriber from the workspace. JWT authenticated, requires edit permission.
 *
 * This is a hard-delete — the subscriber row is removed entirely.
 * (Unsubscribing via the public /api/unsubscribe endpoint also hard-deletes.)
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
    return NextResponse.json({ error: "Invalid subscriber ID" }, { status: 422 });
  }

  const supabase = getSupabaseClient();

  // Verify the subscriber exists and belongs to this workspace.
  const { data: subscriber, error: fetchError } = await supabase
    .from("subscribers")
    .select("id")
    .eq("id", id)
    .eq("client_id", workspaceId)
    .single();

  if (fetchError || !subscriber) {
    return NextResponse.json(
      { error: "Subscriber not found" },
      { status: 404 }
    );
  }

  const { error: deleteError } = await supabase
    .from("subscribers")
    .delete()
    .eq("id", id)
    .eq("client_id", workspaceId);

  if (deleteError) {
    console.error("Subscriber delete error:", deleteError);
    return NextResponse.json(
      { error: "Failed to delete subscriber" },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
