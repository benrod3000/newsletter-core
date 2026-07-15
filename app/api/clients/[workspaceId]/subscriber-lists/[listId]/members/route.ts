import { NextRequest, NextResponse } from "next/server";
import { getClientContextFromJWT, assertWorkspaceAccess } from "@/lib/client-context";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const auth = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" };

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string; listId: string }> }
) {
  const { workspaceId, listId } = await params;
  const ctx = getClientContextFromJWT(req);
  if (!ctx || !assertWorkspaceAccess(ctx, workspaceId))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { subscriber_ids } = await req.json();
  if (!Array.isArray(subscriber_ids) || subscriber_ids.length === 0) {
    return NextResponse.json({ error: "subscriber_ids required" }, { status: 400 });
  }

  // Verify list belongs to workspace
  const listRes = await fetch(`${SUPABASE_URL}/rest/v1/subscriber_lists?id=eq.${listId}&workspace_id=eq.${workspaceId}&select=id`, { headers: auth });
  const listData = await listRes.json();
  if (!Array.isArray(listData) || listData.length === 0) {
    return NextResponse.json({ error: "List not found" }, { status: 404 });
  }

  // Bulk insert memberships, ignoring duplicates
  const memberships = subscriber_ids.map((subId: string) => ({
    subscriber_id: subId,
    list_id: listId,
  }));

  const batchSize = 100;
  for (let i = 0; i < memberships.length; i += batchSize) {
    await fetch(`${SUPABASE_URL}/rest/v1/subscriber_list_memberships`, {
      method: "POST",
      headers: { ...auth, Prefer: "resolution=ignore-duplicates" },
      body: JSON.stringify(memberships.slice(i, i + batchSize)),
    });
  }

  return NextResponse.json({ ok: true, moved: subscriber_ids.length }, { status: 200 });
}
