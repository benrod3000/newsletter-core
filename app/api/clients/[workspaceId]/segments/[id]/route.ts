import { NextRequest, NextResponse } from "next/server";
import { getClientContextFromJWT, assertWorkspaceAccess, canEditAsClient } from "@/lib/client-context";
import { logError } from "@/lib/logger";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const auth = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" };

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

  try {
    await fetch(
      `${SUPABASE_URL}/rest/v1/saved_segments?id=eq.${id}&workspace_id=eq.${workspaceId}`,
      { method: "DELETE", headers: auth }
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    logError(err, { workspaceId, segmentId: id, action: 'delete-segment' });
    return NextResponse.json({ error: "Failed to delete segment" }, { status: 500 });
  }
}
