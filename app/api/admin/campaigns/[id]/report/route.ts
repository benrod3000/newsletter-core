import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";
import { getAdminContextFromHeaders } from "@/lib/admin-context";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = getAdminContextFromHeaders(req.headers);
  if (!admin) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const { id: campaignId } = await params;
  const supabase = getSupabaseClient();

  // Verify campaign access
  let campaignQuery = supabase
    .from("campaigns")
    .select("id, client_id, title, subject, sent_count, last_sent_at")
    .eq("id", campaignId)
    .single();

  if (admin.role !== "owner" && admin.clientId) {
    campaignQuery = supabase
      .from("campaigns")
      .select("id, client_id, title, subject, sent_count, last_sent_at")
      .eq("id", campaignId)
      .eq("client_id", admin.clientId)
      .single();
  }

  const { data: campaign, error: campaignError } = await campaignQuery;
  if (campaignError || !campaign) {
    return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
  }

  // Fetch all events for this campaign
  const { data: events } = await supabase
    .from("campaign_events")
    .select("event_type, email, url, metadata")
    .eq("campaign_id", campaignId);

  const rows = events ?? [];

  function uniqueEmailCount(type: string) {
    return new Set(rows.filter((r) => r.event_type === type).map((r) => r.email)).size;
  }

  const sentCount = campaign.sent_count ?? 0;
  const opens = uniqueEmailCount("open");
  const clicks = uniqueEmailCount("click");
  const bounces = uniqueEmailCount("bounce");
  const complaints = uniqueEmailCount("complaint");
  const unsubscribes = uniqueEmailCount("unsubscribe");
  const openRate = sentCount > 0 ? Math.round((opens / sentCount) * 100) : 0;
  const clickRate = sentCount > 0 ? Math.round((clicks / sentCount) * 100) : 0;

  // Top clicked URLs
  const urlCounts: Record<string, number> = {};
  for (const row of rows.filter((r) => r.event_type === "click" && r.url)) {
    urlCounts[row.url!] = (urlCounts[row.url!] ?? 0) + 1;
  }
  const topUrls = Object.entries(urlCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([url, count]) => ({ url, count }));

  const cityCounts: Record<string, number> = {};
  for (const row of rows.filter((r) => r.event_type === "click")) {
    const city = typeof row.metadata?.city === "string" ? row.metadata.city.trim() : "";
    if (!city) continue;
    cityCounts[city] = (cityCounts[city] ?? 0) + 1;
  }
  const topCities = Object.entries(cityCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([city, count]) => ({ city, count }));

  return NextResponse.json({
    campaign: {
      id: campaign.id,
      title: campaign.title,
      subject: campaign.subject,
      sentCount,
      lastSentAt: campaign.last_sent_at,
    },
    stats: { opens, clicks, bounces, complaints, unsubscribes, openRate, clickRate },
    topUrls,
    topCities,
  });
}
