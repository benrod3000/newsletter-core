import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";
import { getAdminContextFromHeaders } from "@/lib/admin-context";
import { jsonString } from "@/lib/json";

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
    .select("id, workspace_id, title, subject, sent_count, last_sent_at")
    .eq("id", campaignId)
    .single();

  if (admin.role !== "owner" && admin.clientId) {
    campaignQuery = supabase
      .from("campaigns")
      .select("id, workspace_id, title, subject, sent_count, last_sent_at")
      .eq("id", campaignId)
      .eq("workspace_id", admin.clientId)
      .single();
  }

  const { data: campaign, error: campaignError } = await campaignQuery;
  if (campaignError || !campaign) {
    return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
  }

  // Fetch all events for this campaign
  const { data: events } = await supabase
    .from("campaign_events")
    .select("event_type, email, url, metadata, subscriber_id")
    .eq("campaign_id", campaignId);

  const rows = events ?? [];

  /*
   * Uniqueness keys on the subscriber, not the email address.
   *
   * `campaign_events.email` becomes nullable in migration 073, because an SMS
   * event has no email address to record. Keying a Set on a nullable column
   * collapses every null into one member, so a channel with no addresses would
   * report exactly one unique open however many people opened it.
   *
   * `subscriber_id` is the thing actually being counted, and it is set on every
   * open and click the tracking routes write. The email fallback keeps legacy rows
   * that predate it counting as they always did.
   */
  function uniqueRecipientCount(type: string) {
    const seen = new Set<string>();
    for (const r of rows) {
      if (r.event_type !== type) continue;
      const who = r.subscriber_id ?? (r.email ? `email:${r.email}` : null);
      if (who) seen.add(who);
    }
    return seen.size;
  }

  const sentCount = campaign.sent_count ?? 0;
  const opens = uniqueRecipientCount("open");
  const clicks = uniqueRecipientCount("click");
  const bounces = uniqueRecipientCount("bounce");
  const complaints = uniqueRecipientCount("complaint");
  const unsubscribes = uniqueRecipientCount("unsubscribe");
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
    const city = jsonString(row.metadata, "city")?.trim() ?? "";
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
