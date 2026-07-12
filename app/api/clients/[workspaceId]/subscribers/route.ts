import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";
import {
  getClientContextFromJWT,
  assertWorkspaceAccess,
} from "@/lib/client-context";

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

  if (!context || !assertWorkspaceAccess(context, workspaceId)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
      return NextResponse.json(
        { error: "Failed to compute subscriber count" },
        { status: 500 }
      );
    }

    // Subscriber growth: new subscribers per day over the requested window.
    const since = new Date();
    since.setDate(since.getDate() - (days - 1));
    since.setHours(0, 0, 0, 0);

    const { data: recentSubscribers, error: growthError } = await supabase
      .from("subscribers")
      .select("created_at")
      .eq("client_id", workspaceId)
      .gte("created_at", since.toISOString());

    if (growthError) {
      console.error("Analytics growth error:", growthError);
      return NextResponse.json(
        { error: "Failed to compute subscriber growth" },
        { status: 500 }
      );
    }

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
    const subscriberGrowth = Object.entries(growthBuckets).map(
      ([date, count]) => ({ date, count })
    );

    // Campaigns that have actually gone out.
    const { data: sentCampaigns, error: campaignError } = await supabase
      .from("campaigns")
      .select("id, title, sent_count")
      .eq("client_id", workspaceId)
      .eq("status", "sent");

    if (campaignError) {
      console.error("Analytics campaigns error:", campaignError);
      return NextResponse.json(
        { error: "Failed to fetch campaigns" },
        { status: 500 }
      );
    }

    const campaigns = sentCampaigns || [];
    const campaignIds = campaigns.map((c) => c.id);

    // Pull open/click events for all sent campaigns in one query and bucket
    // them in memory (same approach as the admin per-campaign report route).
    let events: { campaign_id: string; event_type: string; email: string }[] = [];
    if (campaignIds.length > 0) {
      const { data: eventRows, error: eventsError } = await supabase
        .from("campaign_events")
        .select("campaign_id, event_type, email")
        .in("campaign_id", campaignIds)
        .in("event_type", ["open", "click"]);

      if (eventsError) {
        console.error("Analytics events error:", eventsError);
        return NextResponse.json(
          { error: "Failed to fetch campaign events" },
          { status: 500 }
        );
      }
      events = eventRows || [];
    }

    function uniqueEmailCount(campaignId: string, type: string) {
      return new Set(
        events
          .filter((e) => e.campaign_id === campaignId && e.event_type === type)
          .map((e) => e.email)
      ).size;
    }

    let totalSent = 0;
    let totalOpens = 0;
    let totalClicks = 0;

    const campaignStats = campaigns.map((c) => {
      const sent = c.sent_count ?? 0;
      const opens = uniqueEmailCount(c.id, "open");
      const clicks = uniqueEmailCount(c.id, "click");
      totalSent += sent;
      totalOpens += opens;
      totalClicks += clicks;
      return {
        id: c.id,
        name: c.title,
        sent,
        open_rate: sent > 0 ? (opens / sent) * 100 : 0,
        click_rate: sent > 0 ? (clicks / sent) * 100 : 0,
      };
    });

    const topCampaigns = campaignStats
      .sort((a, b) => b.open_rate - a.open_rate)
      .slice(0, topCampaignsLimit);

    return NextResponse.json(
      {
        total_subscribers: totalSubscribers || 0,
        campaigns_sent: campaigns.length,
        avg_open_rate: totalSent > 0 ? (totalOpens / totalSent) * 100 : 0,
        avg_click_rate: totalSent > 0 ? (totalClicks / totalSent) * 100 : 0,
        subscriber_growth: subscriberGrowth,
        top_campaigns: topCampaigns,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Analytics endpoint error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
