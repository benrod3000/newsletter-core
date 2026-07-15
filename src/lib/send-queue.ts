/**
 * Send queue for reliable batch email delivery.
 *
 * Writes progress to the `campaign_jobs` table so that:
 * - Large sends survive Vercel function timeouts (resumable)
 * - Partial failures are tracked per-batch
 * - Each campaign send has an audit trail
 *
 * The table schema (migration 031):
 *   campaign_jobs(id, campaign_id, batch, total, sent_so_far, status, started_at, completed_at)
 */

import sgMail from "@sendgrid/mail";
import { getSupabaseClient } from "@/lib/supabase";
import {
  buildHtmlFromEditor,
  buildWebVersionUrl,
  mergeDataForRecipient,
  renderTemplate,
  type MergeRecipient,
} from "@/lib/campaign-personalization";

const BATCH_SIZE = 20;

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
  sgApiKey: string;
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

/**
 * Creates a campaign_job row and processes all recipient batches.
 * Returns the total number of successfully sent emails.
 */
export async function processSendQueue(params: QueueJobParams): Promise<{ sentCount: number; failedCount: number }> {
  const { workspaceId, campaignId, recipients, baseUrl, fromEmail, fromName, sgApiKey, subject, message, messageHtml, messageCss } = params;

  if (recipients.length === 0) return { sentCount: 0, failedCount: 0 };

  sgMail.setApiKey(sgApiKey);
  const supabase = getSupabaseClient();
  const from = `${fromName} <${fromEmail}>`;
  const baseHtml = messageHtml
    ? buildHtmlFromEditor(messageHtml, messageCss)
    : buildHtmlFromEditor(message.replace(/\n/g, "<br>"));

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

  // Process in batches
  for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
    const batch = recipients.slice(i, i + BATCH_SIZE);
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

        await sgMail.send({
          to: sub.email,
          from,
          subject: personalSubject,
          text: personalText,
          html: personalHtml,
          headers: {
            "List-Unsubscribe": `<${unsubApiUrl}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          },
        });
      })
    );

    // Count successes and failures
    for (const result of results) {
      if (result.status === "fulfilled") {
        sentCount++;
      } else {
        failedCount++;
        console.error(`[queue] Failed to send to batch ${Math.floor(i / BATCH_SIZE) + 1}:`, result.reason);
      }
    }

    // Update progress
    await supabase
      .from("campaign_jobs")
      .update({ sent_so_far: sentCount })
      .eq("id", jobId);
  }

  // Mark job complete
  const finalStatus = failedCount === 0 ? "complete" : failedCount === recipients.length ? "failed" : "complete";
  await supabase
    .from("campaign_jobs")
    .update({ status: finalStatus, sent_so_far: sentCount, completed_at: new Date().toISOString() })
    .eq("id", jobId);

  return { sentCount, failedCount };
}

/**
 * Resume an interrupted job by finding unsent recipients.
 * NOT YET IMPLEMENTED — future enhancement for Vercel timeout recovery.
 */
export async function resumeSendQueue(_jobId: string): Promise<void> {
  // Future: query campaign_jobs for status='sending' and resume
  // by cross-referencing sent_so_far with the full recipient list
  // stored in campaign_jobs metadata or re-queried from subscribers.
  throw new Error("Resume not yet implemented");
}
