import { NextRequest } from "next/server";
import { requireCronSecret } from "@/lib/cron-auth";
import { apiSuccess, apiInternalError } from "@/lib/api-response";

/**
 * GET /api/admin/campaigns/recover
 * Finds orphaned campaign_jobs (stuck in 'sending' for >15 min)
 * and resumes them from where they left off.
 *
 * Called by Vercel cron every 10 minutes.
 */
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const auth = requireCronSecret(req);
  if (auth) return auth;

  const suUrl = process.env.SUPABASE_URL;
  const suKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!suUrl || !suKey) return apiInternalError("Missing Supabase env vars");

  const authHeaders = { apikey: suKey, Authorization: `Bearer ${suKey}`, "Content-Type": "application/json" };

  try {
    // Find jobs stuck for >15 minutes
    const staleTime = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const jobsRes = await fetch(
      `${suUrl}/rest/v1/campaign_jobs?select=id,campaign_id,total,sent_so_far&status=eq.sending&started_at=lt.${encodeURIComponent(staleTime)}&limit=5`,
      { headers: authHeaders }
    );

    if (!jobsRes.ok) {
      return apiInternalError(`Failed to query campaign_jobs: ${jobsRes.status}`);
    }

    const jobs = await jobsRes.json();
    if (!Array.isArray(jobs) || jobs.length === 0) {
      return apiSuccess({ recovered: 0, message: "No orphaned jobs found" });
    }

    let recovered = 0;

    for (const job of jobs) {
      console.log(`[recover] Found orphaned job ${job.id} for campaign ${job.campaign_id} at ${job.sent_so_far}/${job.total}`);

      // Mark as failed if recovery isn't possible (campaign deleted, etc.)
      try {
        // Re-query the campaign to get recipient info
        const campRes = await fetch(
          `${suUrl}/rest/v1/campaigns?select=id,client_id,subject,audience,editor_html,editor_css,plain_text&id=eq.${job.campaign_id}&limit=1`,
          { headers: authHeaders }
        );
        const campaigns = await campRes.json();
        if (!Array.isArray(campaigns) || campaigns.length === 0) {
          // Campaign deleted — mark job as failed
          await fetch(`${suUrl}/rest/v1/campaign_jobs?id=eq.${job.id}`, {
            method: "PATCH",
            headers: { ...authHeaders, Prefer: "return=minimal" },
            body: JSON.stringify({ status: "failed", completed_at: new Date().toISOString() }),
          });
          continue;
        }

        const campaign = campaigns[0];

        // Get all recipients for this campaign
        const subsRes = await fetch(
          `${suUrl}/rest/v1/subscribers?select=id,email,unsubscribe_token,country,region,city,first_name,last_name,date_of_birth,phone_number&client_id=eq.${campaign.client_id}&limit=${job.total}&offset=${job.sent_so_far}`,
          { headers: authHeaders }
        );
        const remainingRecipients = await subsRes.json();

        if (!Array.isArray(remainingRecipients) || remainingRecipients.length === 0) {
          // No recipients left — mark job as complete
          await fetch(`${suUrl}/rest/v1/campaign_jobs?id=eq.${job.id}`, {
            method: "PATCH",
            headers: { ...authHeaders, Prefer: "return=minimal" },
            body: JSON.stringify({ status: "complete", completed_at: new Date().toISOString() }),
          });
          recovered++;
          continue;
        }

        // Queue the remaining sends via the existing send pipeline
        const { processSendQueue } = await import("@/lib/send-queue");
        const { buildDispatcherConfig } = await import("@/lib/email/dispatcher");

        // Get workspace provider config
        const clientRes = await fetch(
          `${suUrl}/rest/v1/clients?select=email_provider,fallback_provider,sendgrid_api_key,resend_api_key,sender_email,sender_name&id=eq.${campaign.client_id}&limit=1`,
          { headers: authHeaders }
        );
        const clients = await clientRes.json();
        const client = Array.isArray(clients) && clients.length > 0 ? clients[0] : {};

        const dispatchConfig = buildDispatcherConfig(client);
        const fromEmail = client?.sender_email || process.env.SENDGRID_FROM_EMAIL || "noreply@veloce.app";
        const fromName = client?.sender_name || "Veloce";

        const result = await processSendQueue({
          workspaceId: campaign.client_id,
          campaignId: campaign.id,
          subject: campaign.subject || "Newsletter update",
          message: campaign.plain_text || "",
          messageHtml: campaign.editor_html || "",
          messageCss: campaign.editor_css || "",
          baseUrl: process.env.NEXT_PUBLIC_APP_URL || "",
          fromEmail,
          fromName,
          dispatchConfig,
          recipients: remainingRecipients.map((r: any) => ({
            id: r.id,
            email: r.email,
            unsubscribe_token: r.unsubscribe_token,
            country: r.country,
            region: r.region,
            city: r.city,
            first_name: r.first_name,
            last_name: r.last_name,
            date_of_birth: r.date_of_birth,
            phone_number: r.phone_number,
          })),
        });

        console.log(`[recover] Campaign ${campaign.id}: sent ${result.sentCount}, failed ${result.failedCount}`);
        recovered++;
      } catch (err: any) {
        console.error(`[recover] Failed to recover job ${job.id}:`, err?.message);
        // Mark as failed
        await fetch(`${suUrl}/rest/v1/campaign_jobs?id=eq.${job.id}`, {
          method: "PATCH",
          headers: { ...authHeaders, Prefer: "return=minimal" },
          body: JSON.stringify({ status: "failed", completed_at: new Date().toISOString() }),
        }).catch(() => {});
      }
    }

    return apiSuccess({ recovered, message: `Recovered ${recovered} orphaned jobs` });
  } catch (err: any) {
    console.error("[recover] Error:", err?.message);
    return apiInternalError(err?.message || "Recovery failed");
  }
}
