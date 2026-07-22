import { getSupabaseClient } from "@/lib/supabase";
import { checkSendingLimit } from "@/lib/sending-limits";
import {
  enqueueCampaignJob,
  drainCampaignJob,
  DEFAULT_TIME_BUDGET_MS,
} from "@/lib/send-queue";
import type { GeoFilter } from "@/lib/geo-utils";
import type { DispatchConfig } from "@/lib/email/dispatcher";

/**
 * Audience selector.
 *
 * The template-literal member is what makes this a real union — the previous
 * `| string` collapsed it back to `string`, so a typo'd audience compiled fine
 * and silently sent to the wrong people.
 */
export type Audience = "all" | "confirmed" | "pending" | "claimed_offer" | `list:${string}`;

/**
 * Look up the workspace's configured sending provider and build dispatch config.
 */
async function getWorkspaceSender(
  supabase: ReturnType<typeof getSupabaseClient>,
  workspaceId: string
): Promise<{ fromEmail: string; fromName: string; dispatchConfig: DispatchConfig }> {
  const { data: client } = await supabase
    .from("clients")
    .select(
      "email_provider, fallback_provider, sandbox_mode, ses_from_email, sender_email, sender_name, sendgrid_api_key, resend_api_key"
    )
    .eq("id", workspaceId)
    .maybeSingle();

  return {
    fromEmail:
      client?.sender_email || client?.ses_from_email || process.env.SENDGRID_FROM_EMAIL || "noreply@veloce.app",
    fromName: client?.sender_name || "Veloce",
    dispatchConfig: {
      provider: client?.email_provider || "sendgrid",
      fallbackProvider: client?.fallback_provider || undefined,
      sandbox: client?.sandbox_mode === true,
      credentials: {
        sendgrid: client?.sendgrid_api_key || process.env.SENDGRID_API_KEY,
        resend: client?.resend_api_key || process.env.RESEND_API_KEY,
      },
    },
  };
}

export interface SendCampaignBlastParams {
  workspaceId: string;
  subject: string;
  message: string;
  messageHtml: string;
  messageCss: string;
  audience: Audience | string;
  geoFilter: GeoFilter;
  campaignId: string | null;
  baseUrl: string;
  /** Override the drain time budget (defaults to the queue's own). */
  timeBudgetMs?: number;
}

export interface SendCampaignBlastResult {
  jobId: string | null;
  queued: number;
  sentCount: number;
  failedCount: number;
  /** Recipients still pending. > 0 means recovery will finish the job. */
  remaining: number;
}

/**
 * Queue a campaign and send as much of it as fits in one invocation.
 *
 * Recipient selection happens in the database (see migration 044), so this
 * never materialises the list. Whatever is left when the time budget runs out
 * stays pending and is finished by /api/admin/campaigns/recover.
 */
export async function sendCampaignBlast(
  params: SendCampaignBlastParams
): Promise<SendCampaignBlastResult> {
  const supabase = getSupabaseClient();
  const { workspaceId, audience, geoFilter, campaignId } = params;

  const { jobId, queued } = await enqueueCampaignJob({
    workspaceId,
    campaignId,
    audience,
    geo: {
      country: geoFilter.country,
      regions: geoFilter.regions,
      cities: geoFilter.cities,
      center_lat: geoFilter.center_lat,
      center_lng: geoFilter.center_lng,
      radius_km: geoFilter.radius_km,
    },
  });

  if (queued === 0) {
    await supabase
      .from("campaign_jobs")
      .update({ status: "complete", completed_at: new Date().toISOString() })
      .eq("id", jobId);
    return { jobId, queued: 0, sentCount: 0, failedCount: 0, remaining: 0 };
  }

  // Enforced once, against the real recipient count, before anything is sent.
  await checkSendingLimit(supabase, workspaceId, queued);

  const { fromEmail, fromName, dispatchConfig } = await getWorkspaceSender(supabase, workspaceId);

  const result = await drainCampaignJob({
    jobId,
    workspaceId,
    campaignId,
    subject: params.subject,
    message: params.message,
    messageHtml: params.messageHtml,
    messageCss: params.messageCss,
    baseUrl: params.baseUrl,
    fromEmail,
    fromName,
    dispatchConfig,
    timeBudgetMs: params.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS,
  });

  return {
    jobId,
    queued,
    sentCount: result.sentCount,
    failedCount: result.failedCount,
    remaining: result.remaining,
  };
}
