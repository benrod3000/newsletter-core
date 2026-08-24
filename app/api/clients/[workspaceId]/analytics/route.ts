import { fetchAllRows } from "@/lib/paginate";
import { withWorkspace } from "@/lib/with-workspace";
import { apiSuccess, apiInternalError } from "@/lib/api-response";

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
 *   lead_magnet: { submissions, clicks, click_rate },   // capture forms, not campaigns
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

export const GET = withWorkspace<{ workspaceId: string }>(
  async ({ req, db, params }) => {
    const { workspaceId } = params;

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

  // Scoped to this workspace by RLS - see withWorkspace/db-token.
    const supabase = db;

  try {
    // ── Subscribers ──────────────────────────────────────────────────────────
    // A current headcount. Unsubscribes no longer delete the row - they set
    // `suppressed` as of migration 065 - so this counts everyone on file including
    // people who have opted out. New-in-window below is the comparable figure.
    const { count: totalSubscribers, error: subCountError } = await supabase
      .from("subscribers")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId);

    if (subCountError) {
      console.error("Analytics subscriber count error:", subCountError);
      return apiInternalError("Failed to compute subscriber count");
    }

    /*
     * Counted by the database, and the daily rows paged.
     *
     * This fetched every subscriber created since the start of the *previous*
     * window in one unbounded select, then counted the results in JS. PostgREST
     * caps a response at 1,000 rows with no error and no ordering guarantee, so on
     * any workspace with more history than that the count was of an arbitrary
     * thousand.
     *
     * It failed in the most misleading possible way here. 10,300 contacts were
     * imported on one day, and ten more signed up over the following fortnight. The
     * thousand rows that came back were all from the import - so `newSubscribers`
     * was 0, the growth chart was flat, and the ten real signups were invisible.
     * "No growth" was not a rendering problem; the number genuinely was zero.
     *
     * The two totals are now `count: exact` head queries, which the database
     * computes and no ceiling applies to. Only the current window's rows are
     * fetched, and paged, because bucketing by day needs the individual timestamps
     * and PostgREST cannot GROUP BY.
     */
    const [{ count: newSubscribersCount }, { count: prevNewSubscribersCount }] = await Promise.all([
      supabase
        .from("subscribers")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId)
        .gte("created_at", startDate.toISOString()),
      supabase
        .from("subscribers")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId)
        .gte("created_at", priorStartDate.toISOString())
        .lt("created_at", startDate.toISOString()),
    ]);

    const newSubscribers = newSubscribersCount ?? 0;
    const prevNewSubscribers = prevNewSubscribersCount ?? 0;

    const growthBuckets: Record<string, number> = {};
    for (let i = 0; i < days; i++) {
      const d = new Date(startDate);
      d.setUTCDate(d.getUTCDate() + i);
      growthBuckets[d.toISOString().slice(0, 10)] = 0;
    }

    const windowSubscribers = await fetchAllRows((afterId, pageSize) => {
      let q = supabase
        .from("subscribers")
        .select("id, created_at")
        .eq("workspace_id", workspaceId)
        .gte("created_at", startDate.toISOString())
        .order("id", { ascending: true })
        .limit(pageSize);
      if (afterId) q = q.gt("id", afterId);
      return q;
    });

    for (const row of windowSubscribers) {
      if (!row.created_at) continue;
      const key = new Date(row.created_at).toISOString().slice(0, 10);
      if (key in growthBuckets) growthBuckets[key] += 1;
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

    /*
     * Capture-form engagement, which campaign analytics cannot see.
     *
     * Everything above is per campaign: events are fetched with
     * `.in("campaign_id", ...)` and the rates divide by `sent_count`. A lead magnet
     * has no campaign row, so its clicks carry `campaign_id = null` and are excluded
     * by construction.
     *
     * That was invisible while nothing had been sent. It stopped being invisible the
     * moment capture forms began delivering: at the time of writing, every single
     * engagement event in the database is a lead-magnet click, so analytics was
     * excluding 100% of the engagement that exists and reporting zero opens and zero
     * clicks - correctly, for campaigns, and uselessly for the operator.
     *
     * Reported separately rather than folded into the campaign rates, because they
     * measure different things. `submissions` is the denominator: one lead magnet
     * email goes out per form submission, so a click rate against it is meaningful.
     * There is deliberately no open rate - a delivery email carries no tracking
     * pixel, and inventing one from clicks would be worse than omitting it.
     */
    const leadMagnetWindow = async (from: Date, to: Date | null) => {
      let submissionsQuery = supabase
        .from("widget_events")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId)
        .eq("event_type", "submission")
        .gte("occurred_at", from.toISOString());
      let clicksQuery = supabase
        .from("campaign_events")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId)
        .eq("metadata->>tracking_kind", "lead_magnet")
        .gte("occurred_at", from.toISOString());

      if (to) {
        submissionsQuery = submissionsQuery.lt("occurred_at", to.toISOString());
        clicksQuery = clicksQuery.lt("occurred_at", to.toISOString());
      }

      const [{ count: submissions }, { count: clicks }] = await Promise.all([
        submissionsQuery,
        clicksQuery,
      ]);

      const s = submissions ?? 0;
      const c = clicks ?? 0;
      return { submissions: s, clicks: c, click_rate: s > 0 ? (c / s) * 100 : 0 };
    };

    const [leadMagnet, prevLeadMagnet] = await Promise.all([
      leadMagnetWindow(startDate, null),
      leadMagnetWindow(priorStartDate, startDate),
    ]);

    return apiSuccess({
      total_subscribers: totalSubscribers || 0,
      new_subscribers: newSubscribers,
      lead_magnet: leadMagnet,
      campaigns_sent: currentSummary.campaigns_sent,
      avg_open_rate: currentSummary.avg_open_rate,
      avg_click_rate: currentSummary.avg_click_rate,
      subscriber_growth: subscriberGrowth,
      top_campaigns: topCampaigns,
      previous: {
        new_subscribers: prevNewSubscribers,
        lead_magnet: prevLeadMagnet,
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
},
  { minRole: "viewer" }
);
