import { NextRequest, NextResponse } from "next/server";
import { getClientContextFromJWT, assertWorkspaceAccess } from "@/lib/client-context";
import { getSupabaseClient } from "@/lib/supabase";
import { fetchAllRows } from "@/lib/paginate";
import { logError } from "@/lib/logger";

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

  const supabase = getSupabaseClient();

  try {
    // Queried by workspace_id directly rather than by collecting campaign ids
    // and filtering on those. The old shape had three separate truncations
    // stacked on top of each other, none of which produced an error:
    //
    //   campaigns   limit=100    events from a workspace's 101st campaign
    //                            onward were simply absent
    //   events      limit=10000  PostgREST caps a response at 1,000 rows
    //                            regardless, so each batch was short
    //   accumulator 20,000 cap   silently truncated whatever survived
    //
    // A busy workspace therefore got a heatmap built from a fraction of its
    // opens and no indication that "best hour to send" was computed from a
    // sample. campaign_events.workspace_id is NOT NULL, so none of it was needed.
    let events: { occurred_at: string }[];
    try {
      events = await fetchAllRows<{ id: string; occurred_at: string }>((afterId, pageSize) => {
        let q = supabase
          .from("campaign_events")
          .select("id, occurred_at")
          .eq("workspace_id", workspaceId)
          .eq("event_type", "open")
          .order("id", { ascending: true })
          .limit(pageSize);
        if (since) q = q.gte("occurred_at", since);
        if (afterId) q = q.gt("id", afterId);
        return q;
      });
    } catch (err) {
      logError(err, { route: "clients.analytics.heatmap", workspaceId });
      return NextResponse.json({ error: "Failed to load heatmap" }, { status: 500 });
    }

    if (events.length === 0) {
      return NextResponse.json({ hours: [], days: [], matrix: [], totalOpens: 0, bestHour: -1, bestDay: -1 });
    }


    // Build hour-of-day counts (24 hours), day-of-week counts (7 days), and a
    // day x hour matrix so the client can filter one axis by a selection on
    // the other (e.g. "day-of-week breakdown for 3pm opens only").
    const hours = new Array(24).fill(0);
    const days = new Array(7).fill(0);
    const matrix = Array.from({ length: 7 }, () => new Array(24).fill(0));

    for (const e of events) {
      // Shift into the viewer's local time, then read UTC parts so the bucket
      // is independent of whatever timezone this server happens to run in.
      const d = new Date(new Date(e.occurred_at).getTime() - tzOffsetMin * 60000);
      const hour = d.getUTCHours();
      const day = d.getUTCDay();
      hours[hour]++;
      days[day]++;
      matrix[day][hour]++;
    }

    const maxHour = Math.max(...hours, 1);
    const maxDay = Math.max(...days, 1);

    return NextResponse.json({
      hours: hours.map((count, hour) => ({ hour, count, pct: Math.round((count / maxHour) * 100) })),
      days: days.map((count, day) => ({ day, count, pct: Math.round((count / maxDay) * 100) })),
      // cells[i].counts[hour] = opens on day i at that hour. Kept flat rather than
      // nested per-hour objects since the client only needs raw counts to re-derive
      // percentages against whatever subset it's currently viewing.
      matrix: matrix.map((counts, day) => ({ day, counts })),
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
