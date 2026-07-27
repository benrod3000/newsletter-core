import { NextRequest, NextResponse } from "next/server";
import { getClientContextFromJWT, assertWorkspaceAccess } from "@/lib/client-context";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const auth = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };

/**
 * GET /api/clients/[workspaceId]/analytics/live
 * Returns the most recent campaign events (opens & clicks) for the real-time pulse.
 * Lightweight - queries last 5 minutes only, limited to 10 events.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params;
  const ctx = getClientContextFromJWT(req);
  if (!ctx || !assertWorkspaceAccess(ctx, workspaceId))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    // Get workspace campaign IDs
    const campsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/campaigns?select=id,title&workspace_id=eq.${workspaceId}&limit=50`,
      { headers: auth }
    );
    if (!campsRes.ok) return NextResponse.json({ events: [] });
    const campaigns = await campsRes.json();
    if (!Array.isArray(campaigns) || campaigns.length === 0)
      return NextResponse.json({ events: [] });

    const campaignMap = new Map(campaigns.map((c: any) => [c.id, c.title || "Untitled"]));
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

    // Fetch recent open & click events across all campaigns
    const eventsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/campaign_events?select=event_type,email,occurred_at,campaign_id&in=(event_type,open,click)&occurred_at=gte.${fiveMinAgo}&order=occurred_at.desc&limit=10`,
      { headers: auth }
    );
    if (!eventsRes.ok) return NextResponse.json({ events: [] });
    const events = await eventsRes.json();
    if (!Array.isArray(events)) return NextResponse.json({ events: [] });

    const mapped = events.map((e: any) => ({
      type: e.event_type,
      email: e.email,
      campaign: campaignMap.get(e.campaign_id) || "Unknown",
      campaign_id: e.campaign_id,
      timestamp: e.occurred_at,
    }));

    return NextResponse.json({ events: mapped, now: new Date().toISOString() });
  } catch {
    return NextResponse.json({ events: [] }, { status: 200 });
  }
}
