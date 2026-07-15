import { NextRequest, NextResponse } from "next/server";
import { getClientContextFromJWT, assertWorkspaceAccess } from "@/lib/client-context";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const auth = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params;
  const ctx = getClientContextFromJWT(req);
  if (!ctx || !assertWorkspaceAccess(ctx, workspaceId))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    // Get campaign open events for this workspace
    const subsRes = await fetch(`${SUPABASE_URL}/rest/v1/subscribers?select=id&client_id=eq.${workspaceId}&limit=5000`, { headers: auth });
    const subs = await subsRes.json();
    if (!Array.isArray(subs) || subs.length === 0) {
      return NextResponse.json({ hours: [], days: [] });
    }

    const subIds = subs.map((s: any) => `subscriber_id=eq.${s.id}`).join(",");
    const eventsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/campaign_events?select=occurred_at&event_type=eq.open&or=(${subIds})&limit=10000`,
      { headers: auth }
    );
    const events = await eventsRes.json();
    if (!Array.isArray(events)) return NextResponse.json({ hours: [], days: [] });

    // Build hour-of-day counts (24 hours) and day-of-week counts (7 days)
    const hours = new Array(24).fill(0);
    const days = new Array(7).fill(0);

    for (const e of events) {
      const d = new Date(e.occurred_at);
      hours[d.getHours()]++;
      days[d.getDay()]++;
    }

    const maxHour = Math.max(...hours, 1);
    const maxDay = Math.max(...days, 1);

    return NextResponse.json({
      hours: hours.map((count, hour) => ({ hour, count, pct: Math.round((count / maxHour) * 100) })),
      days: days.map((count, day) => ({ day, count, pct: Math.round((count / maxDay) * 100) })),
      totalOpens: events.length,
      bestHour: hours.indexOf(Math.max(...hours)),
      bestDay: days.indexOf(Math.max(...days)),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}
