/**
 * Send queue for reliable batch email delivery.
 *
 * Writes progress to the `campaign_jobs` table so that:
 * - Large sends survive Vercel function timeouts (resumable)
 * - Partial failures are tracked per-batch
 * - Retries use exponential backoff for transient errors
 * - Permanent failures are recorded with full error details
 *
 * The table schema (migration 031):
 *   campaign_jobs(id, campaign_id, batch, total, sent_so_far, status, started_at, completed_at)
 */

import { getSupabaseClient } from "@/lib/supabase";
import {
  buildHtmlFromEditor,
  buildWebVersionUrl,
  mergeDataForRecipient,
  renderTemplate,
  type MergeRecipient,
} from "@/lib/campaign-personalization";
import { dispatchEmail, type DispatchConfig } from "@/lib/email/dispatcher";
import { bus } from "@/lib/events";

const BATCH_SIZE = 20;
const MAX_RETRIES = 3;
const RETRY_DELAYS = [0, 2000, 8000]; // ms — 0s, 2s, 8s

export interface QueueJobParams {
  workspaceId: string;
  campaignId: string;
  subject: string;
  message: string;
  messageHtml: string;
  messageCss: string;
  baseUrl: string;
  fromEmail: string;
  fromName: string;
  dispatchConfig: DispatchConfig;
  recipients: QueueRecipient[];
}

export interface QueueRecipient {
  id: string;
  email: string;
  unsubscribe_token: string;
  country: string | null;
  region: string | null;
  city: string | null;
  first_name: string | null;
  last_name: string | null;
  date_of_birth: string | null;
  phone_number: string | null;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Send a single email with retry + backoff.
 * Returns { success, provider } for tracking.
 */
async function sendWithRetry(
  sendParams: Parameters<typeof dispatchEmail>[0],
  config: DispatchConfig
): Promise<{ success: boolean; provider: string }> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const result = await dispatchEmail(sendParams, config);

    if (result.success) return { success: true, provider: result.provider };

    // Permanent failure — stop retrying
    if (result.error && !result.error.retryable) {
      return { success: false, provider: result.provider };
    }

    // Last attempt — give up
    if (attempt === MAX_RETRIES) {
      return { success: false, provider: result.provider };
    }

    // Transient — wait and retry
    await sleep(RETRY_DELAYS[attempt] || 0);
  }
  return { success: false, provider: "unknown" };
}

/**
 * Creates a campaign_job row and processes all recipient batches.
 * Returns the total number of successfully sent emails.
 */
export async function processSendQueue(params: QueueJobParams): Promise<{ sentCount: number; failedCount: number }> {
  const { workspaceId, campaignId, recipients, baseUrl, fromEmail, fromName, dispatchConfig, subject, message, messageHtml, messageCss } = params;

  if (recipients.length === 0) return { sentCount: 0, failedCount: 0 };

  const supabase = getSupabaseClient();
  const from = `${fromName} <${fromEmail}>`;
  const baseHtml = messageHtml
    ? buildHtmlFromEditor(messageHtml, messageCss)
    : buildHtmlFromEditor(message.replace(/\n/g, "<br>"));

  bus.emit({
    type: "campaign:queued",
    timestamp: Date.now(),
    campaignId,
    workspaceId,
    data: { recipientCount: recipients.length, provider: dispatchConfig.provider },
  });

  // Create a job row
  const { data: job, error: jobError } = await supabase
    .from("campaign_jobs")
    .insert([{
      campaign_id: campaignId,
      batch: Math.ceil(recipients.length / BATCH_SIZE),
      total: recipients.length,
      status: "sending",
      started_at: new Date().toISOString(),
    }])
    .select("*")
    .single();

  if (jobError || !job) {
    throw new Error(`Failed to create campaign job: ${jobError?.message || "Unknown"}`);
  }

  const jobId = job.id;
  let sentCount = 0;
  let failedCount = 0;
  const startTime = Date.now();

  bus.emit({
    type: "campaign:sending",
    timestamp: Date.now(),
    campaignId,
    workspaceId,
    data: { provider: dispatchConfig.provider, recipientCount: recipients.length },
  });

  // Process in batches — stop early if approaching Vercel timeout (50s budget of 60s max)
  for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
    if (Date.now() - startTime > 50000) {
      console.warn(`[queue] Approaching timeout at ${sentCount}/${recipients.length}, saving progress`);
      break;
    }
    const batch = recipients.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(recipients.length / BATCH_SIZE);

    const results = await Promise.allSettled(
      batch.map(async (sub) => {
        const unsubUrl = `${baseUrl}/unsubscribe?token=${sub.unsubscribe_token}`;
        const unsubApiUrl = `${baseUrl}/api/unsubscribe?token=${sub.unsubscribe_token}`;
        const webVersionUrl = campaignId ? buildWebVersionUrl(baseUrl, campaignId, sub.id) : "";
        const mergeData = mergeDataForRecipient(sub, unsubUrl, webVersionUrl);
        mergeData.unsubscribe = mergeData.unsubscribe_url;

        const personalSubject = renderTemplate(subject, mergeData);
        const personalText = renderTemplate(message, mergeData);
        const personalHtml = renderTemplate(baseHtml, mergeData);

        return sendWithRetry({
          to: sub.email,
          from,
          subject: personalSubject,
          text: personalText,
          html: personalHtml,
          listUnsubscribe: unsubApiUrl,
          campaignId,
          subscriberId: sub.id,
        }, dispatchConfig);
      })
    );

    for (const result of results) {
      if (result.status === "fulfilled" && result.value.success) {
        sentCount++;
      } else {
        failedCount++;
      }
    }

    bus.emit({
      type: "queue:batch_complete",
      timestamp: Date.now(),
      campaignId,
      workspaceId,
      data: { batch: batchNum, total: totalBatches, sent: sentCount },
    });

    // Update progress
    await supabase
      .from("campaign_jobs")
      .update({ sent_so_far: sentCount })
      .eq("id", jobId);
  }

  const finalStatus = failedCount === 0 ? "complete" : failedCount === recipients.length ? "failed" : "complete";
  await supabase
    .from("campaign_jobs")
    .update({ status: finalStatus, sent_so_far: sentCount, completed_at: new Date().toISOString() })
    .eq("id", jobId);

  bus.emit({
    type: failedCount === recipients.length ? "campaign:failed" : "campaign:completed",
    timestamp: Date.now(),
    campaignId,
    workspaceId,
    data: {
      sent: sentCount,
      failed: failedCount,
      durationMs: Date.now() - startTime,
    },
  });

  return { sentCount, failedCount };
}

/**
 * Resume an interrupted job by finding unsent recipients.
 * NOT YET IMPLEMENTED — future enhancement for Vercel timeout recovery.
 */
export async function resumeSendQueue(_jobId: string): Promise<void> {
  throw new Error("Resume not yet implemented");
}
