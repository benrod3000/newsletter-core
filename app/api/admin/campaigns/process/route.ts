import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";
import { canSendCampaigns, getAdminContextFromHeaders } from "@/lib/admin-context";
import { sendCampaignBlast, getBaseUrl, parseGeoFilter } from "@/lib/send-campaign";

export async function POST(req: NextRequest) {
  const admin = getAdminContextFromHeaders(req.headers);
  if (!admin) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (!canSendCampaigns(admin)) return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  if (admin.role !== "owner" && !admin.clientId) {
    return NextResponse.json({ error: "No workspace assigned for this account." }, { status: 403 });
  }

  const supabase = getSupabaseClient();
  const nowIso = new Date().toISOString();
  const baseUrl = getBaseUrl(req);

  let dueQuery = supabase
    .from("campaigns")
    .select("id, client_id, subject, audience, geo_filter, editor_html, editor_css, plain_text")
    .eq("status", "scheduled")
    .lte("scheduled_for", nowIso);

  if (admin.role !== "owner" && admin.clientId) {
    dueQuery = dueQuery.eq("client_id", admin.clientId);
  }

  const { data: dueCampaigns, error: dueError } = await dueQuery;
  if (dueError) {
    return NextResponse.json({ error: `Failed to load scheduled campaigns: ${dueError.message}` }, { status: 500 });
  }

  if (!dueCampaigns || dueCampaigns.length === 0) {
    return NextResponse.json({ ok: true, processed: 0, sent: 0 });
  }

  let sent = 0;

  for (const campaign of dueCampaigns) {
    try {
      const result = await sendCampaignBlast({
        workspaceId: campaign.client_id,
        subject: campaign.subject,
        message: campaign.plain_text || "Newsletter update.",
        messageHtml: campaign.editor_html ?? "",
        messageCss: campaign.editor_css ?? "",
        audience: campaign.audience ?? "confirmed",
        geoFilter: parseGeoFilter(campaign.geo_filter),
        campaignId: campaign.id,
        baseUrl,
      });

      sent += result.sentCount;

      await supabase
        .from("campaigns")
        .update({
          status: "sent",
          sent_count: result.sentCount,
          last_sent_at: nowIso,
          last_error: null,
          updated_by: admin.username,
        })
        .eq("id", campaign.id);
    } catch (err) {
      await supabase
        .from("campaigns")
        .update({
          last_error: err instanceof Error ? err.message : "Send failed",
          updated_by: admin.username,
        })
        .eq("id", campaign.id);
    }
  }

  return NextResponse.json({ ok: true, processed: dueCampaigns.length, sent });
}
