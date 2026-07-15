import { NextRequest, NextResponse } from "next/server";
import { getClientContextFromJWT, assertWorkspaceAccess } from "@/lib/client-context";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const auth = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string; subscriberId: string }> }
) {
  const { workspaceId, subscriberId } = await params;
  const ctx = getClientContextFromJWT(req);
  if (!ctx || !assertWorkspaceAccess(ctx, workspaceId))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    // Fetch all subscriber data in parallel
    const [subRes, eventsRes, tagsRes, notesRes, membershipsRes] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/subscribers?id=eq.${subscriberId}&client_id=eq.${workspaceId}&select=*&limit=1`, { headers: auth }),
      fetch(`${SUPABASE_URL}/rest/v1/campaign_events?subscriber_id=eq.${subscriberId}&select=*&order=occurred_at.asc&limit=500`, { headers: auth }),
      fetch(`${SUPABASE_URL}/rest/v1/subscriber_tags?subscriber_id=eq.${subscriberId}&select=tag,created_at&limit=100`, { headers: auth }),
      fetch(`${SUPABASE_URL}/rest/v1/subscriber_notes?subscriber_id=eq.${subscriberId}&select=*&limit=100`, { headers: auth }),
      fetch(`${SUPABASE_URL}/rest/v1/subscriber_list_memberships?subscriber_id=eq.${subscriberId}&select=list_id&limit=50`, { headers: auth }),
    ]);

    const [subData, events, tags, notes, memberships] = await Promise.all([
      subRes.json(), eventsRes.json(), tagsRes.json(), notesRes.json(), membershipsRes.json(),
    ]);

    const subscriber = Array.isArray(subData) ? subData[0] : null;
    if (!subscriber) return NextResponse.json({ error: "Subscriber not found" }, { status: 404 });

    return NextResponse.json({
      exported_at: new Date().toISOString(),
      subscriber,
      campaigns: Array.isArray(events) ? events : [],
      tags: Array.isArray(tags) ? tags : [],
      notes: Array.isArray(notes) ? notes : [],
      list_memberships: Array.isArray(memberships) ? memberships : [],
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}
