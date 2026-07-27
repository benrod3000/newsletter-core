import { NextRequest } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";
import {
  getClientContextFromJWT,
  assertWorkspaceAccess,
} from "@/lib/client-context";
import { apiSuccess, apiUnauthorized, apiInternalError } from "@/lib/api-response";

/**
 * GET /api/clients/[workspaceId]/analytics
 * Workspace-level analytics overview (JWT authenticated)
 *
 * Query params:
 * - days: length of the reporting window (default 14, max 90)
 * - topCampaigns: number of campaigns to return (default 5, max 20)
 *
 * Every rate is scoped to the window, and the equivalent preceding window is
 * returned as `previous` so the UI can show change rather than a bare number.
 *
 * Returns: {
 *   total_subscribers, new_subscribers, campaigns_sent,
 *   avg_open_rate, avg_click_rate,          // 0-100, within the window
 *   subscriber_growth: [{ date, count }],
 *   top_campaigns: [{ id, name, sent, open_rate, click_rate, sent_at }],
 *   previous: { new_subscribers, campaigns_sent, avg_open_rate, avg_click_rate },
 *   period: { days, start, previous_start, truncated }
 * }
 */

const EVENT_PAGE = 1000;
const EVENT_CAP = 50000;

type CampaignRow = {
  id: string;
  title: string;
  sent_count: number | null;
  last_sent_at: string | null;
  created_at: string;
};
type EventRow = { campaign_id: string; event_type: string; email: string };

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params;
  const context = getClientContextFromJWT(req);

  if (!context || !assertWorkspaceAccess(context, workspaceId)) return apiUnauthorized();

  const url = new URL(req.url);
  const daysRaw = parseInt(url.searchParams.get("days") || "14", 10);
  const days = Math.min(Math.max(Number.isFinite(daysRaw) ? daysRaw : 14, 1), 90);
  const topCampaignsLimit = Math.min(
    Math.max(parseInt(url.searchParams.get("topCampaigns") || "5", 10) || 5, 1),
    20
  );

  const now = Date.now();
  const windowMs = days * 86400000;
  const startDate = new Date(now - windowMs);
  const priorStartDate = new Date(now - windowMs * 2);

  const supabase = getSupabaseClient();

  try {
    // ── Subscribers ──────────────────────────────────────────────────────────
    // Unsubscribes hard-delete the row, so this is a current headcount rather
    // than a running total. New-in-window is the comparable figure.
    const { count: totalSubscribers, error: subCountError } = await supabase
      .from("subscribers")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId);

    if (subCountError) {
      console.error("Analytics subscriber count error:", subCountError);
      return apiInternalError("Failed to compute subscriber count");
    }

    const { data: windowSubscribers } = await supabase
      .from("subscribers")
      .select("created_at")
      .eq("workspace_id", workspaceId)
      .gte("created_at", priorStartDate.toISOString());

    let newSubscribers = 0;
    let prevNewSubscribers = 0;
    const growthBuckets: Record<string, number> = {};
    for (let i = 0; i < days; i++) {
      const d = new Date(startDate);
      d.setUTCDate(d.getUTCDate() + i);
      growthBuckets[d.toISOString().slice(0, 10)] = 0;
    }
    for (const row of windowSubscribers || []) {
      const t = new Date(row.created_at).getTime();
      if (t >= startDate.getTime()) {
        newSubscribers += 1;
        const key = new Date(row.created_at).toISOString().slice(0, 10);
        if (key in growthBuckets) growthBuckets[key] += 1;
      } else {
        prevNewSubscribers += 1;
      }
    }
    const subscriberGrowth = Object.entries(growthBuckets).map(([date, count]) => ({ date, count }));

    // ── Campaigns in this window and the preceding one ───────────────────────
    // Sent campaigns are stamped with last_sent_at; fall back to created_at for
    // rows that predate that column being populated.
    const { data: campaignRows, error: campaignErr } = await supabase
      .from("campaigns")
      .select("id, title, sent_count, last_sent_at, created_at")
      .eq("workspace_id", workspaceId)
      .eq("status", "sent")
      .order("last_sent_at", { ascending: false })
      .limit(500);

    if (campaignErr) {
      console.error("Analytics campaign fetch error:", campaignErr);
      return apiInternalError("Failed to load campaigns");
    }

    const sentAtOf = (c: CampaignRow) => new Date(c.last_sent_at || c.created_at).getTime();
    const all = (campaignRows || []) as CampaignRow[];
    const current = all.filter((c) => sentAtOf(c) >= startDate.getTime());
    const previous = all.filter(
      (c) => sentAtOf(c) >= priorStartDate.getTime() && sentAtOf(c) < startDate.getTime()
    );

    // ── Engagement events for those campaigns ────────────────────────────────
    // Counted per unique email, so one subscriber opening five times is one
    // open. (The materialized view double-counted these via a cartesian join.)
    const relevantIds = [...current, ...previous].map((c) => c.id);
    const events: EventRow[] = [];
    let truncated = false;

    if (relevantIds.length > 0) {
      let from = 0;
      // Paginate: an unbounded select caps at ~1000 rows and silently undercounts.
      for (;;) {
        const { data: page, error: evErr } = await supabase
          .from("campaign_events")
          .select("campaign_id, event_type, email")
          .in("campaign_id", relevantIds)
          .in("event_type", ["open", "click"])
          .range(from, from + EVENT_PAGE - 1);

        if (evErr) {
          console.error("Analytics event fetch error:", evErr);
          break;
        }
        const rows = (page || []) as EventRow[];
        events.push(...rows);
        if (rows.length < EVENT_PAGE) break;
        from += EVENT_PAGE;
        if (events.length >= EVENT_CAP) { truncated = true; break; }
      }
    }

    const uniq = new Map<string, Set<string>>(); // `${campaignId}:${type}` -> emails
    for (const e of events) {
      const key = `${e.campaign_id}:${e.event_type}`;
      let set = uniq.get(key);
      if (!set) { set = new Set(); uniq.set(key, set); }
      set.add(e.email);
    }
    const countFor = (id: string, type: string) => uniq.get(`${id}:${type}`)?.size ?? 0;

    function summarize(list: CampaignRow[]) {
      let sent = 0, opens = 0, clicks = 0;
      for (const c of list) {
        sent += c.sent_count ?? 0;
        opens += countFor(c.id, "open");
        clicks += countFor(c.id, "click");
      }
      return {
        campaigns_sent: list.length,
        avg_open_rate: sent > 0 ? (opens / sent) * 100 : 0,
        avg_click_rate: sent > 0 ? (clicks / sent) * 100 : 0,
      };
    }

    const currentSummary = summarize(current);
    const previousSummary = summarize(previous);

    const topCampaigns = current
      .map((c) => {
        const sent = c.sent_count ?? 0;
        const opens = countFor(c.id, "open");
        const clicks = countFor(c.id, "click");
        return {
          id: c.id,
          name: c.title,
          sent,
          open_rate: sent > 0 ? (opens / sent) * 100 : 0,
          click_rate: sent > 0 ? (clicks / sent) * 100 : 0,
          sent_at: c.last_sent_at || c.created_at,
        };
      })
      .sort((a, b) => b.open_rate - a.open_rate)
      .slice(0, topCampaignsLimit);

    return apiSuccess({
      total_subscribers: totalSubscribers || 0,
      new_subscribers: newSubscribers,
      campaigns_sent: currentSummary.campaigns_sent,
      avg_open_rate: currentSummary.avg_open_rate,
      avg_click_rate: currentSummary.avg_click_rate,
      subscriber_growth: subscriberGrowth,
      top_campaigns: topCampaigns,
      previous: {
        new_subscribers: prevNewSubscribers,
        campaigns_sent: previousSummary.campaigns_sent,
        avg_open_rate: previousSummary.avg_open_rate,
        avg_click_rate: previousSummary.avg_click_rate,
      },
      period: {
        days,
        start: startDate.toISOString(),
        previous_start: priorStartDate.toISOString(),
        truncated,
      },
    });
  } catch (error) {
    console.error("Analytics endpoint error:", error);
    return apiInternalError();
  }
}
