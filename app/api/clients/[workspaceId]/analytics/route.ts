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
 * - days: number of days of subscriber growth history to return (default 14, max 90)
 * - topCampaigns: number of top campaigns to return (default 5, max 20)
 *
 * Returns: {
 *   total_subscribers: number,
 *   campaigns_sent: number,
 *   avg_open_rate: number,   // 0-100
 *   avg_click_rate: number,  // 0-100
 *   subscriber_growth: [{ date: "YYYY-MM-DD", count: number }],
 *   top_campaigns: [{ id, name, sent, open_rate, click_rate }]
 * }
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params;
  const context = getClientContextFromJWT(req);

  if (!context || !assertWorkspaceAccess(context, workspaceId)) return apiUnauthorized();

  const url = new URL(req.url);
  const days = Math.min(parseInt(url.searchParams.get("days") || "14"), 90);
  const topCampaignsLimit = Math.min(
    parseInt(url.searchParams.get("topCampaigns") || "5"),
    20
  );

  const supabase = getSupabaseClient();

  try {
    // Total subscribers currently on file for this workspace.
    // NOTE: unsubscribes hard-delete the row (see /api/unsubscribe), so this
    // is already a "current" count, not a running total.
    const { count: totalSubscribers, error: subCountError } = await supabase
      .from("subscribers")
      .select("id", { count: "exact", head: true })
      .eq("client_id", workspaceId);

    if (subCountError) {
      console.error("Analytics subscriber count error:", subCountError);
      return apiInternalError("Failed to compute subscriber count");
    }

    // Subscriber growth: try materialized view first, fall back to manual bucketing
    let subscriberGrowth: { date: string; count: number }[] = [];
    try {
      const { data: mvGrowth, error: mvGrowthErr } = await supabase
        .from("mv_subscriber_growth")
        .select("day, count")
        .eq("client_id", workspaceId)
        .order("day", { ascending: true });

      if (!mvGrowthErr && mvGrowth) {
        subscriberGrowth = mvGrowth.map((r: any) => ({ date: r.day, count: r.count }));
      }
    } catch { /* view may not exist yet */ }

    // Fallback: manual bucketing from subscribers table
    if (subscriberGrowth.length === 0) {
      const since = new Date();
      since.setDate(since.getDate() - (days - 1));
      since.setHours(0, 0, 0, 0);

      const { data: recentSubscribers } = await supabase
        .from("subscribers")
        .select("created_at")
        .eq("client_id", workspaceId)
        .gte("created_at", since.toISOString());

      const growthBuckets: Record<string, number> = {};
      for (let i = 0; i < days; i++) {
        const d = new Date(since);
        d.setDate(d.getDate() + i);
        growthBuckets[d.toISOString().slice(0, 10)] = 0;
      }
      for (const row of recentSubscribers || []) {
        const day = new Date(row.created_at).toISOString().slice(0, 10);
        if (day in growthBuckets) growthBuckets[day] += 1;
      }
      subscriberGrowth = Object.entries(growthBuckets).map(([date, count]) => ({ date, count }));
    }

    // Campaign performance: try materialized view first, fall back to raw events scan
    let topCampaigns: { id: string; name: string; sent: number; open_rate: number; click_rate: number }[] = [];
    let totalSent = 0;
    let totalOpens = 0;
    let totalClicks = 0;
    let campaignsSent = 0;

    try {
      const { data: mvStats, error: mvStatsErr } = await supabase
        .from("mv_campaign_stats")
        .select("campaign_id, title, sent_count, opens, clicks, open_rate, click_rate")
        .eq("client_id", workspaceId)
        .order("created_at", { ascending: false })
        .limit(topCampaignsLimit);

      if (!mvStatsErr && mvStats) {
        for (const row of mvStats as any[]) {
          totalSent += row.sent_count || 0;
          totalOpens += row.opens || 0;
          totalClicks += row.clicks || 0;
        }
        campaignsSent = (mvStats as any[]).length;
        topCampaigns = (mvStats as any[]).map((r) => ({
          id: r.campaign_id,
          name: r.title,
          sent: r.sent_count || 0,
          open_rate: r.open_rate || 0,
          click_rate: r.click_rate || 0,
        }));
      }
    } catch { /* view may not exist yet */ }

    // Fallback: raw campaign_events scan
    if (topCampaigns.length === 0) {
      const { data: sentCampaigns } = await supabase
        .from("campaigns")
        .select("id, title, sent_count")
        .eq("client_id", workspaceId)
        .eq("status", "sent");

      const campaigns = sentCampaigns || [];
      campaignsSent = campaigns.length;
      const campaignIds = campaigns.map((c) => c.id);

      let events: { campaign_id: string; event_type: string; email: string }[] = [];
      if (campaignIds.length > 0) {
        const { data: eventRows } = await supabase
          .from("campaign_events")
          .select("campaign_id, event_type, email")
          .in("campaign_id", campaignIds)
          .in("event_type", ["open", "click"]);
        events = eventRows || [];
      }

      function uniqueEmailCount(campaignId: string, type: string) {
        return new Set(
          events.filter((e) => e.campaign_id === campaignId && e.event_type === type).map((e) => e.email)
        ).size;
      }

      const campaignStats = campaigns.map((c) => {
        const sent = c.sent_count ?? 0;
        const opens = uniqueEmailCount(c.id, "open");
        const clicks = uniqueEmailCount(c.id, "click");
        totalSent += sent;
        totalOpens += opens;
        totalClicks += clicks;
        return { id: c.id, name: c.title, sent, open_rate: sent > 0 ? (opens / sent) * 100 : 0, click_rate: sent > 0 ? (clicks / sent) * 100 : 0 };
      });

      topCampaigns = campaignStats.sort((a, b) => b.open_rate - a.open_rate).slice(0, topCampaignsLimit);
    }

    return apiSuccess({
        total_subscribers: totalSubscribers || 0,
        campaigns_sent: campaignsSent,
        avg_open_rate: totalSent > 0 ? (totalOpens / totalSent) * 100 : 0,
        avg_click_rate: totalSent > 0 ? (totalClicks / totalSent) * 100 : 0,
        subscriber_growth: subscriberGrowth,
        top_campaigns: topCampaigns,
      });
  } catch (error) {
    console.error("Analytics endpoint error:", error);
    return apiInternalError();
  }
}
