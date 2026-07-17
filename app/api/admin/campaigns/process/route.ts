import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";
import { sendCampaignBlast, getBaseUrl, parseGeoFilter } from "@/lib/send-campaign";
import { requireCronSecret } from "@/lib/cron-auth";
import { logError } from "@/lib/logger";

async function processScheduledCampaigns(req: NextRequest) {
  const auth = requireCronSecret(req);
  if (auth) return auth;
  const supabase = getSupabaseClient();
  const nowIso = new Date().toISOString();
  const baseUrl = getBaseUrl(req);
  let dueQuery = supabase
    .from("campaigns")
    .select("id, client_id, subject, audience, geo_filter, editor_html, editor_css, plain_text")
    .eq("status", "scheduled")
    .lte("scheduled_for", nowIso);
  const { data: dueCampaigns, error: dueError } = await dueQuery;
  if (dueError) return NextResponse.json({ error: `Failed to load scheduled campaigns: ${dueError.message}` }, { status: 500 });
  if (!dueCampaigns || dueCampaigns.length === 0) return NextResponse.json({ ok: true, processed: 0, sent: 0 });
  let sent = 0;
  for (const campaign of dueCampaigns) {
    try {
      const result = await sendCampaignBlast({
        workspaceId: campaign.client_id, subject: campaign.subject,
        message: campaign.plain_text || "Newsletter update.",
        messageHtml: campaign.editor_html ?? "", messageCss: campaign.editor_css ?? "",
        audience: campaign.audience ?? "confirmed", geoFilter: parseGeoFilter(campaign.geo_filter),
        campaignId: campaign.id, baseUrl,
      });
      sent += result.sentCount;
      await supabase.from("campaigns").update({ status: "sent", sent_count: result.sentCount, last_sent_at: nowIso, last_error: null, updated_by: "cron" }).eq("id", campaign.id);
    } catch (err) {
      logError(err, { campaignId: campaign.id, workspaceId: campaign.client_id })
      await supabase.from("campaigns").update({ last_error: err instanceof Error ? err.message : "Send failed", updated_by: "cron" }).eq("id", campaign.id);
    }
  }
  return NextResponse.json({ ok: true, processed: dueCampaigns.length, sent });
}

export const POST = processScheduledCampaigns;
export const GET = processScheduledCampaigns;
