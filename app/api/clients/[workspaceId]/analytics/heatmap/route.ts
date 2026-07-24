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

  const url = new URL(req.url);
  // Scope to the same window as the rest of the analytics page. Previously this
  // was always all-time, so changing the period selector silently did nothing.
  const daysParam = parseInt(url.searchParams.get("days") || "", 10);
  const windowDays = Number.isFinite(daysParam) ? Math.min(Math.max(daysParam, 1), 90) : 0;
  const since = windowDays > 0 ? new Date(Date.now() - windowDays * 86400000).toISOString() : null;

  // Buckets were computed in the server's timezone (UTC on Vercel), so "best
  // hour to send" was wrong for everyone outside UTC. The client passes its
  // offset (Date#getTimezoneOffset: minutes to add to local to reach UTC).
  const tzRaw = parseInt(url.searchParams.get("tzOffset") || "", 10);
  const tzOffsetMin = Number.isFinite(tzRaw) ? Math.min(Math.max(tzRaw, -840), 840) : 0;

  try {
    // Get campaign IDs for this workspace, then query events by campaign_id
    // (avoids URL overflow from 5,000 subscriber_id=eq.UUID conditions)
    const campaignsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/campaigns?select=id&client_id=eq.${workspaceId}&limit=100`,
      { headers: auth }
    );
    if (!campaignsRes.ok) {
      return NextResponse.json({ hours: [], days: [], totalOpens: 0, bestHour: -1, bestDay: -1 }, { status: 200 });
    }
    const campaigns = await campaignsRes.json();
    if (!Array.isArray(campaigns) || campaigns.length === 0) {
      return NextResponse.json({ hours: [], days: [], totalOpens: 0, bestHour: -1, bestDay: -1 });
    }

    const campaignIds = campaigns.map((c: any) => c.id);
    const BATCH_SIZE = 50;
    let allEvents: { occurred_at: string }[] = [];

    for (let i = 0; i < campaignIds.length; i += BATCH_SIZE) {
      const batch = campaignIds.slice(i, i + BATCH_SIZE);
      const idFilters = batch.map((id: string) => `campaign_id=eq.${id}`).join(",");
      const sinceFilter = since ? `&occurred_at=gte.${since}` : "";
      const eventsRes = await fetch(
        `${SUPABASE_URL}/rest/v1/campaign_events?select=occurred_at&event_type=eq.open&or=(${idFilters})${sinceFilter}&limit=10000`,
        { headers: auth }
      );
      if (!eventsRes.ok) {
        continue;
      }
      const batchEvents = await eventsRes.json();
      if (Array.isArray(batchEvents)) {
        allEvents = allEvents.concat(batchEvents);
        if (allEvents.length >= 20000) { allEvents = allEvents.slice(0, 20000); break; }
      }
    }

    const events = allEvents;

    // Build hour-of-day counts (24 hours) and day-of-week counts (7 days)
    const hours = new Array(24).fill(0);
    const days = new Array(7).fill(0);

    for (const e of events) {
      // Shift into the viewer's local time, then read UTC parts so the bucket
      // is independent of whatever timezone this server happens to run in.
      const d = new Date(new Date(e.occurred_at).getTime() - tzOffsetMin * 60000);
      hours[d.getUTCHours()]++;
      days[d.getUTCDay()]++;
    }

    const maxHour = Math.max(...hours, 1);
    const maxDay = Math.max(...days, 1);

    return NextResponse.json({
      hours: hours.map((count, hour) => ({ hour, count, pct: Math.round((count / maxHour) * 100) })),
      days: days.map((count, day) => ({ day, count, pct: Math.round((count / maxDay) * 100) })),
      totalOpens: events.length,
      bestHour: hours.indexOf(Math.max(...hours)),
      bestDay: days.indexOf(Math.max(...days)),
      windowDays: windowDays || null,
      tzOffsetMinutes: tzOffsetMin,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}
