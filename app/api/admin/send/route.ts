import { NextRequest } from "next/server";
import { canSendCampaigns, getAdminContextFromHeaders } from "@/lib/admin-context";
import { sendCampaignBlast } from "@/lib/send-campaign";
import { parseGeoFilter, getApiBaseUrl } from "@/lib/geo-utils";
import type { Audience } from "@/lib/send-campaign";
import { buildDispatcherConfig } from "@/lib/email/dispatcher";
import { dispatchEmail } from "@/lib/email/dispatcher";
import { getSupabaseClient } from "@/lib/supabase";
import { renderTemplate, buildHtmlFromEditor } from "@/lib/campaign-personalization";
import { apiSuccess, apiError, apiUnauthorized, apiForbidden, apiNotFound, apiInternalError } from "@/lib/api-response";
import { PLATFORM_FALLBACK_FROM_EMAIL } from "@/lib/platform-sender";

/** POST /api/admin/send - Send campaign or test. Delegates to sendCampaignBlast. */
export async function POST(req: NextRequest) {
  const admin = getAdminContextFromHeaders(req.headers);
  if (!admin) return apiUnauthorized();
  if (!canSendCampaigns(admin)) return apiForbidden();
  if (admin.role !== "owner" && !admin.clientId) return apiForbidden("No workspace assigned");

  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body.subject !== "string" || typeof body.message !== "string") {
      return apiError(400, "INVALID_REQUEST", "Invalid request body");
    }

    const subject = body.subject.trim();
    const message = body.message.trim();
    const messageHtml = typeof body.html === "string" ? body.html.trim() : "";
    const messageCss = typeof body.css === "string" ? body.css.trim() : "";
    const audience: Audience = body.audience === "all" || body.audience === "pending" || body.audience === "claimed_offer"
      ? body.audience
      : typeof body.audience === "string" && body.audience.startsWith("list:")
        ? body.audience
        : "confirmed";
    const geoFilter = parseGeoFilter(body.geoFilter);
    const testEmail = typeof body.testEmail === "string" ? body.testEmail.trim().toLowerCase() : "";
    const campaignId = typeof body.campaignId === "string" ? body.campaignId : null;

    if (!subject || !message) return apiError(422, "VALIDATION_ERROR", "Subject and message required");

    const supabase = getSupabaseClient();
    const baseUrl = getApiBaseUrl(req);
    let workspaceId = admin.clientId || "";

    // Resolve workspace from campaign
    if (campaignId) {
      let q = supabase.from("campaigns").select("id, workspace_id").eq("id", campaignId);
      if (admin.role !== "owner" && admin.clientId) q = q.eq("workspace_id", admin.clientId);
      const { data: camp } = await q.single();
      if (!camp) return apiNotFound("Campaign");
      workspaceId = camp.workspace_id;
    }

    // Test send
    if (testEmail) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(testEmail)) {
        return apiError(422, "VALIDATION_ERROR", "Invalid test email address");
      }

      const baseHtml = messageHtml
        ? buildHtmlFromEditor(messageHtml, messageCss)
        : buildHtmlFromEditor(message.replace(/\n/g, "<br>"));

      // Same { html, text } shape as mergeDataForRecipient so the test path
      // renders exactly like a real send.
      const sampleValues = {
        first_name: "Friend", last_name: "", full_name: "Friend", email: testEmail,
        unsubscribe_url: `${baseUrl}/unsubscribe?token=test`,
        web_version_url: `${baseUrl}/web/test-campaign?s=test`,
      };
      const sampleData = { html: sampleValues, text: sampleValues };

      const { data: client, error: clientError } = await supabase.from("clients")
        .select("email_provider, sendgrid_api_key, resend_api_key, sender_email, sender_name")
        .eq("id", workspaceId).maybeSingle();

      // Before migration 055 this select always failed on the two key columns and
      // the error was dropped, so `buildDispatcherConfig({})` decided the provider.
      // A test send is meant to prove the workspace's real configuration works;
      // one that quietly uses different settings proves nothing.
      if (clientError || !client) {
        return apiError(500, "CONFIG_ERROR", "Could not load workspace sending configuration.");
      }

      const config = buildDispatcherConfig(client);
      const fromEmail = client.sender_email || process.env.SENDGRID_FROM_EMAIL || PLATFORM_FALLBACK_FROM_EMAIL;
      const fromName = client.sender_name || "Veloce";

      await dispatchEmail({
        to: testEmail,
        from: `${fromName} <${fromEmail}>`,
        subject: `[TEST] ${renderTemplate(subject, sampleData.text)}`,
        text: renderTemplate(message, sampleData.text),
        html: renderTemplate(baseHtml, sampleData.html),
      }, config);

      if (campaignId) {
        await supabase.from("campaigns").update({
          last_test_sent_at: new Date().toISOString(),
          last_test_recipient: testEmail,
          updated_by: admin.username,
        }).eq("id", campaignId);
      }

      return apiSuccess({ testSent: true });
    }

    // Full send - canonical pipeline
    const result = await sendCampaignBlast({
      workspaceId,
      subject,
      message,
      messageHtml,
      messageCss,
      audience,
      geoFilter,
      campaignId,
      baseUrl,
    });

    return apiSuccess({
      jobId: result.jobId,
      queued: result.queued,
      sentCount: result.sentCount,
      failedCount: result.failedCount,
      // > 0 means the send is unfinished and recovery will continue it.
      remaining: result.remaining,
    });
  } catch (err: any) {
    console.error("[admin/send] Error:", err?.message || err);
    return apiInternalError(err?.message || "Send failed");
  }
}
