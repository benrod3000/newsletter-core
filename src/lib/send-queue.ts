/**
 * Campaign send queue.
 *
 * The recipient list lives in Postgres, not in this process. A send is two
 * phases:
 *
 *   enqueueCampaignJob()  creates a campaign_jobs row and writes one
 *                         campaign_job_recipients row per recipient with a
 *                         single INSERT ... SELECT. The list never enters Node.
 *
 *   drainCampaignJob()    claims pending recipients in batches, sends them, and
 *                         records the outcome. Stops when its time budget is
 *                         spent, leaving the remaining rows pending.
 *
 * Everything that used to be fragile falls out of that shape:
 *   - Resume is "claim the pending rows again" - no separate resume path.
 *   - Double-sending is prevented by the (job_id, subscriber_id) primary key
 *     and by claiming rows with FOR UPDATE SKIP LOCKED.
 *   - A job is only ever marked complete when zero pending rows remain, so a
 *     timeout can no longer be reported as a successful send.
 *   - Memory is bounded by BATCH_SIZE, not by list size.
 */

import { getSupabaseClient } from "@/lib/supabase";
import {
  buildHtmlFromEditor,
  buildWebVersionUrl,
  mergeDataForRecipient,
  renderTemplate,
} from "@/lib/campaign-personalization";
import { injectTracking } from "@/lib/campaign-tracking";
import { dispatchEmail, type DispatchConfig } from "@/lib/email/dispatcher";
import { bus } from "@/lib/events";
import { logError, logWarn } from "@/lib/logger";

/** Recipients sent per claim. Bounds memory and the size of a lost batch. */
const BATCH_SIZE = 100;
/** Concurrent sends within a batch. */
const CONCURRENCY = 20;
const MAX_RETRIES = 3;
const RETRY_DELAYS = [0, 2000, 8000]; // ms

/**
 * How long a single drain may run. Callers set maxDuration on the route; this
 * leaves headroom to record results and hand off before the platform kills us.
 */
export const DEFAULT_TIME_BUDGET_MS = 100_000;

export interface EnqueueParams {
  workspaceId: string;
  campaignId: string | null;
  audience: string;
  geo: {
    country: string | null;
    regions: string[];
    cities: string[];
    center_lat: number | null;
    center_lng: number | null;
    radius_km: number | null;
  };
}

export interface DrainParams {
  jobId: string;
  workspaceId: string;
  campaignId: string | null;
  subject: string;
  message: string;
  messageHtml: string;
  messageCss: string;
  baseUrl: string;
  fromEmail: string;
  fromName: string;
  dispatchConfig: DispatchConfig;
  timeBudgetMs?: number;
}

export interface DrainResult {
  sentCount: number;
  failedCount: number;
  /** Recipients still waiting. > 0 means the job is unfinished. */
  remaining: number;
  /** True when the drain stopped on its time budget rather than running dry. */
  interrupted: boolean;
}

interface ClaimedRecipient {
  subscriber_id: string;
  email: string;
  unsubscribe_token: string;
  first_name: string | null;
  last_name: string | null;
  date_of_birth: string | null;
  phone_number: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Audience strings of the form "list:<uuid>" select an explicit list.
 *
 * Exported so the pre-send recipient estimate parses the audience exactly as the
 * send does. Duplicating this would let the count shown to a user and the set
 * actually mailed disagree over what "list:..." means, which is precisely the
 * class of bug the shared SQL predicate exists to prevent.
 */
export function parseAudience(audience: string): { audience: string; listId: string | null } {
  if (audience.startsWith("list:")) {
    return { audience: "all", listId: audience.slice(5) || null };
  }
  return { audience, listId: null };
}

/**
 * Create a job and queue its recipients. Returns the job id and how many
 * recipients were queued (0 means there was nobody to send to).
 */
export async function enqueueCampaignJob(
  params: EnqueueParams
): Promise<{ jobId: string; queued: number }> {
  const supabase = getSupabaseClient();
  const { audience, listId } = parseAudience(params.audience);

  const { data: job, error: jobError } = await supabase
    .from("campaign_jobs")
    .insert([
      {
        campaign_id: params.campaignId,
        // Required since migration 048. campaign_jobs.workspace_id is NOT NULL
        // with a foreign key, so omitting it fails the insert and throws below,
        // which takes down every campaign send.
        workspace_id: params.workspaceId,
        batch: 0,
        total: 0,
        status: "sending",
        started_at: new Date().toISOString(),
      },
    ])
    .select("id")
    .single();

  if (jobError || !job) {
    throw new Error(`Failed to create campaign job: ${jobError?.message ?? "unknown"}`);
  }

  const { data: queued, error: enqueueError } = await supabase.rpc(
    "enqueue_campaign_recipients",
    {
      p_job_id: job.id,
      p_workspace: params.workspaceId,
      p_audience: audience,
      // `?? undefined` rather than null: these RPC args have SQL defaults, and
      // omitting one takes that default. The generated signature makes them
      // optional, so an explicit null is a type error and, for p_list_id, a
      // different query than "no list filter".
      p_list_id: listId ?? undefined,
      p_country: params.geo.country ?? undefined,
      p_regions: params.geo.regions ?? undefined,
      p_cities: params.geo.cities ?? undefined,
      p_center_lat: params.geo.center_lat ?? undefined,
      p_center_lng: params.geo.center_lng ?? undefined,
      p_radius_km: params.geo.radius_km ?? undefined,
    }
  );

  if (enqueueError) {
    await supabase
      .from("campaign_jobs")
      .update({ status: "failed", completed_at: new Date().toISOString() })
      .eq("id", job.id);
    throw new Error(`Failed to queue recipients: ${enqueueError.message}`);
  }

  const total = typeof queued === "number" ? queued : 0;

  await supabase
    .from("campaign_jobs")
    .update({ total, batch: Math.ceil(total / BATCH_SIZE) })
    .eq("id", job.id);

  bus.emit({
    type: "campaign:queued",
    timestamp: Date.now(),
    campaignId: params.campaignId ?? "",
    workspaceId: params.workspaceId,
    data: { recipientCount: total },
  });

  return { jobId: job.id, queued: total };
}

/** Send one email, retrying only errors the transport says are retryable. */
async function sendWithRetry(
  sendParams: Parameters<typeof dispatchEmail>[0],
  config: DispatchConfig
): Promise<{ success: boolean; error?: string }> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const result = await dispatchEmail(sendParams, config);
    if (result.success) return { success: true };

    if (result.error && !result.error.retryable) {
      return { success: false, error: result.error.message };
    }
    if (attempt === MAX_RETRIES) {
      return { success: false, error: result.error?.message ?? "send failed" };
    }
    await sleep(RETRY_DELAYS[attempt] ?? 0);
  }
  return { success: false, error: "send failed" };
}

/** Run `workers` promises at a time over `items`. */
async function mapWithConcurrency<T, R>(
  items: T[],
  workers: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(workers, items.length) }, worker));
  return results;
}

/**
 * Send pending recipients for a job until they run out or the time budget does.
 * Safe to call repeatedly and safe to call concurrently.
 */
export async function drainCampaignJob(params: DrainParams): Promise<DrainResult> {
  const supabase = getSupabaseClient();
  const {
    jobId, workspaceId, campaignId, subject, message, messageHtml, messageCss,
    baseUrl, fromEmail, fromName, dispatchConfig,
  } = params;

  const timeBudgetMs = params.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS;
  const startedAt = Date.now();
  const from = `${fromName} <${fromEmail}>`;
  const baseHtml = messageHtml
    ? buildHtmlFromEditor(messageHtml, messageCss)
    : buildHtmlFromEditor(message.replace(/\n/g, "<br>"));

  let sentCount = 0;
  let failedCount = 0;
  let interrupted = false;

  bus.emit({
    type: "campaign:sending",
    timestamp: Date.now(),
    campaignId: campaignId ?? "",
    workspaceId,
    data: { provider: dispatchConfig.provider },
  });

  for (;;) {
    // >= so an already-exhausted budget stops before claiming a batch it has
    // no time to send.
    if (Date.now() - startedAt >= timeBudgetMs) {
      interrupted = true;
      break;
    }

    const { data: claimed, error: claimError } = await supabase.rpc(
      "claim_campaign_recipients",
      { p_job_id: jobId, p_limit: BATCH_SIZE }
    );

    if (claimError) {
      logError(claimError, { scope: "send-queue.claim", jobId });
      interrupted = true;
      break;
    }

    const batch = (claimed ?? []) as ClaimedRecipient[];
    if (batch.length === 0) break;

    const sentIds: string[] = [];
    const failedIds: string[] = [];
    let lastError: string | undefined;

    const outcomes = await mapWithConcurrency(batch, CONCURRENCY, async (sub) => {
      const unsubUrl = `${baseUrl}/unsubscribe?token=${sub.unsubscribe_token}`;
      const unsubApiUrl = `${baseUrl}/api/unsubscribe?token=${sub.unsubscribe_token}`;
      const webVersionUrl = campaignId
        ? buildWebVersionUrl(baseUrl, campaignId, sub.subscriber_id)
        : "";

      const mergeData = mergeDataForRecipient(
        {
          id: sub.subscriber_id,
          email: sub.email,
          unsubscribe_token: sub.unsubscribe_token,
          country: sub.country,
          region: sub.region,
          city: sub.city,
          first_name: sub.first_name,
          last_name: sub.last_name,
          date_of_birth: sub.date_of_birth,
          phone_number: sub.phone_number,
        },
        unsubUrl,
        webVersionUrl
      );

      const html = campaignId
        ? injectTracking(
            renderTemplate(baseHtml, mergeData.html),
            campaignId,
            sub.subscriber_id,
            baseUrl
          )
        : renderTemplate(baseHtml, mergeData.html);

      const result = await sendWithRetry(
        {
          to: sub.email,
          from,
          subject: renderTemplate(subject, mergeData.text),
          text: renderTemplate(message, mergeData.text),
          html,
          listUnsubscribe: unsubApiUrl,
          campaignId: campaignId ?? undefined,
          subscriberId: sub.subscriber_id,
          workspaceId,
        },
        dispatchConfig
      );

      return { id: sub.subscriber_id, ...result };
    });

    for (const outcome of outcomes) {
      if (outcome.success) {
        sentIds.push(outcome.id);
        sentCount++;
      } else {
        failedIds.push(outcome.id);
        failedCount++;
        lastError = outcome.error;
      }
    }

    const { error: completeError } = await supabase.rpc("complete_campaign_recipients", {
      p_job_id: jobId,
      p_sent: sentIds,
      p_failed: failedIds,
      p_error: lastError ?? undefined,
    });

    if (completeError) {
      // The rows stay claimed and become eligible again once claimed_at goes
      // stale, so nothing is lost - but it will be retried, so say so.
      logError(completeError, { scope: "send-queue.complete", jobId, batch: batch.length });
    }

    await supabase.from("campaign_jobs").update({ sent_so_far: sentCount }).eq("id", jobId);
  }

  const { data: progressRows } = await supabase.rpc("campaign_job_progress", {
    p_job_id: jobId,
  });
  const progress = (progressRows ?? [])[0] as
    | { pending: number; sent: number; failed: number }
    | undefined;
  const remaining = progress?.pending ?? 0;

  // Only terminal when nothing is left. An interrupted drain stays 'sending' so
  // the recovery cron can pick it up - the old code marked it complete, which
  // made partial sends invisible.
  const finished = remaining === 0;
  const totalFailed = progress?.failed ?? failedCount;
  const totalSent = progress?.sent ?? sentCount;

  await supabase
    .from("campaign_jobs")
    .update({
      status: finished ? (totalSent === 0 && totalFailed > 0 ? "failed" : "complete") : "sending",
      sent_so_far: totalSent,
      completed_at: finished ? new Date().toISOString() : null,
    })
    .eq("id", jobId);

  if (interrupted && remaining > 0) {
    logWarn("send-queue: time budget spent, job left open for recovery", {
      jobId, campaignId, sent: totalSent, remaining,
    });
  }

  bus.emit({
    type: finished && totalSent === 0 && totalFailed > 0 ? "campaign:failed" : "campaign:completed",
    timestamp: Date.now(),
    campaignId: campaignId ?? "",
    workspaceId,
    data: {
      sent: totalSent,
      failed: totalFailed,
      remaining,
      durationMs: Date.now() - startedAt,
    },
  });

  return { sentCount, failedCount, remaining, interrupted };
}
