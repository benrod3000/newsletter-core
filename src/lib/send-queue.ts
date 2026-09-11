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
import { buildRecipientEmail } from "@/lib/email/recipient-email";
import { dispatchEmail, type DispatchConfig } from "@/lib/email/dispatcher";
import { buildRecipientSms } from "@/lib/sms/recipient-sms";
import {
  dispatchSms,
  smsMessagesPerSecond,
  type SmsDispatchConfig,
} from "@/lib/sms/dispatcher";
import { OPTED_OUT_ERROR_CODE } from "@/lib/sms/twilio";
import { partitionBySendableNow } from "@/lib/sms/quiet-hours";
import { bus } from "@/lib/events";
import { logError, logWarn } from "@/lib/logger";
import type { Branding } from "@/lib/branding";

/** The channels this queue can carry. */
export type Channel = "email" | "sms";

/** Recipients sent per claim. Bounds memory and the size of a lost batch. */
const BATCH_SIZE = 100;

/**
 * Concurrent sends within a batch, per channel.
 *
 * 20 is right for email, where the constraint is our own throughput and the
 * provider accepts parallel requests happily.
 *
 * It is badly wrong for SMS. A Twilio long code accepts about one message per
 * second, and going faster does not fail loudly - the messages are accepted and
 * queued at the provider, so this job reports a completed send while people
 * receive texts over the following hours. The SMS figure is derived from the
 * transport at drain time rather than hardcoded here, because it is an external
 * ceiling that differs between a long code, a toll-free number and a messaging
 * service.
 */
const EMAIL_CONCURRENCY = 20;
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
  /**
   * Defaults to email so every existing caller keeps its behaviour.
   *
   * This is threaded all the way into `campaign_audience()`, so the eligibility
   * rule and the targeting rules come from one place per channel. An SMS job
   * must not grow a separate idea of who a segment is.
   */
  channel?: Channel;
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
  baseUrl: string;
  timeBudgetMs?: number;

  /**
   * Defaults to email. Must match what the job was enqueued as, which is why
   * `campaign_jobs.channel` is denormalized: the drain and the recovery cron
   * read it from the job rather than the campaign, so editing a campaign
   * mid-drain cannot change how its queued recipients are sent.
   */
  channel?: Channel;

  // --- email ---
  subject: string;
  message: string;
  messageHtml: string;
  messageCss: string;
  fromEmail: string;
  fromName: string;
  /** Workspace branding for the email shell. Defaults applied if omitted. */
  branding?: Branding;
  dispatchConfig: DispatchConfig;

  // --- sms ---
  /** The campaign's SMS body, merge tags unresolved. Required when channel is sms. */
  smsBody?: string;
  /** Sender number, E.164. Required when channel is sms. */
  smsFrom?: string;
  smsConfig?: SmsDispatchConfig;
}

export interface DrainResult {
  sentCount: number;
  failedCount: number;
  /** Held back for quiet hours. Not failures - they are retried on a later run. */
  deferredCount: number;
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
  /** Added by migration 075 for the quiet-hours gate. */
  timezone: string | null;
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
  const channel: Channel = params.channel ?? "email";

  const { data: job, error: jobError } = await supabase
    .from("campaign_jobs")
    .insert([
      {
        campaign_id: params.campaignId,
        // Recorded on the job, not read from the campaign at drain time. A
        // campaign edited while its job is draining must not change how the
        // already-queued recipients are sent.
        channel,
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
      p_channel: channel,
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
    data: { recipientCount: total, channel },
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

/**
 * Send one SMS, retrying only what the transport says is worth retrying.
 *
 * The email twin of this is `sendWithRetry`. Having both go through the same
 * shape is most of why SMS was moved onto this queue: the code being replaced
 * caught every failure into `failed++` and retried none of them, so a rate
 * limit that clears in a second was as fatal as an invalid number.
 *
 * Returns the same `{ success, error }` shape as the email path so the drain
 * loop does not have to care which channel produced it.
 */
async function sendSmsWithRetry(
  sendParams: Parameters<typeof dispatchSms>[0],
  config: SmsDispatchConfig,
  supabase: ReturnType<typeof getSupabaseClient>
): Promise<{ success: boolean; error?: string }> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const result = await dispatchSms(sendParams, config);
    if (result.success) return { success: true };

    if (result.error?.code === OPTED_OUT_ERROR_CODE) {
      // Twilio keeps its own opt-out list per sender. Someone who replied STOP
      // directly to the number is refused here whatever this database believes,
      // so record it: otherwise every future campaign re-attempts them, re-fails,
      // and logs a failure for a person who has already said no.
      if (sendParams.subscriberId) {
        const { error } = await supabase
          .from("subscribers")
          .update({ sms_consent: false, sms_consented_at: null })
          .eq("id", sendParams.subscriberId);
        if (error) {
          logError(error, { scope: "send-queue.sms.optout", subscriberId: sendParams.subscriberId });
        }
      }
      return { success: false, error: result.error.message };
    }

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
    baseUrl, fromEmail, fromName, dispatchConfig, branding,
  } = params;

  const channel: Channel = params.channel ?? "email";
  const timeBudgetMs = params.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS;
  const startedAt = Date.now();

  if (channel === "sms" && (!params.smsBody || !params.smsFrom || !params.smsConfig)) {
    // Fail before claiming anything. Claiming first would increment `attempts`
    // on real recipients and, after three passes, exhaust them permanently
    // against a configuration error that has nothing to do with them.
    throw new Error("SMS drain requires smsBody, smsFrom and smsConfig");
  }

  const from = `${fromName} <${fromEmail}>`;
  // Only built for email. Rendering an HTML shell for an SMS job would run the
  // whole branding and template pipeline to produce something nothing reads.
  const baseHtml =
    channel === "email"
      ? messageHtml
        ? buildHtmlFromEditor(messageHtml, messageCss, branding)
        : buildHtmlFromEditor(message.replace(/\n/g, "<br>"), "", branding)
      : "";

  /**
   * Concurrency is the provider's ceiling for SMS and ours for email.
   *
   * Exceeding a Twilio long code's one-per-second does not error: the messages
   * are accepted, queued at the provider, and delivered over the next few hours
   * while this job has already reported success.
   */
  const concurrency =
    channel === "sms" ? Math.max(1, smsMessagesPerSecond(params.smsConfig!)) : EMAIL_CONCURRENCY;

  let sentCount = 0;
  let failedCount = 0;
  let interrupted = false;

  /*
   * Recipients held back for quiet hours, released once the drain stops.
   *
   * Deliberately NOT released as each batch is processed. Releasing immediately
   * would set claimed_at back to NULL, and the very next claim - which orders by
   * subscriber_id - would hand back the same rows, forever, until the time
   * budget ran out. Leaving them claimed for the duration of this drain means
   * the claim skips them and moves on to recipients it can actually send to.
   *
   * They keep status 'pending', so `campaign_job_progress` still counts them as
   * remaining, the job stays 'sending', and the recovery cron comes back for
   * them when the clock has moved.
   */
  const deferredIds: string[] = [];

  bus.emit({
    type: "campaign:sending",
    timestamp: Date.now(),
    campaignId: campaignId ?? "",
    workspaceId,
    data: {
      channel,
      provider: channel === "sms" ? params.smsConfig!.provider : dispatchConfig.provider,
    },
  });

  for (;;) {
    // >= so an already-exhausted budget stops before claiming a batch it has
    // no time to send.
    if (Date.now() - startedAt >= timeBudgetMs) {
      interrupted = true;
      break;
    }

    // The channel is load-bearing here, not cosmetic. The claim re-checks
    // opt-out at dispatch time, and which consent column counts depends on it.
    // Claiming an SMS job with the email default would retire every recipient
    // lacking separate email consent as permanently `failed`.
    const { data: claimed, error: claimError } = await supabase.rpc(
      "claim_campaign_recipients",
      { p_job_id: jobId, p_limit: BATCH_SIZE, p_channel: channel }
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

    /*
     * Quiet hours, per recipient, against their own local time.
     *
     * Email is exempt: an email arriving at 3am is not a statutory violation and
     * sits in an inbox until it is read. A text wakes someone up, and the TCPA
     * measures the hour where the recipient is, not where the server is.
     */
    const { sendable, deferred } =
      channel === "sms"
        ? partitionBySendableNow(batch)
        : { sendable: batch, deferred: [] as ClaimedRecipient[] };

    for (const sub of deferred) deferredIds.push(sub.subscriber_id);

    const outcomes = await mapWithConcurrency(sendable, concurrency, async (sub) => {
      const recipient = {
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
      };

      if (channel === "sms") {
        // Built by the one SMS builder, for the same reason the email path uses
        // buildRecipientEmail: nothing that texts a subscriber may skip the
        // opt-out notice or the merge tags. SMS has no List-Unsubscribe header,
        // so if the opt-out is not in the body it does not exist at all.
        const sms = buildRecipientSms({
          body: params.smsBody!,
          subscriber: recipient,
          from: params.smsFrom!,
          baseUrl,
          campaignId,
        });

        const result = await sendSmsWithRetry(
          {
            to: sms.to,
            from: sms.from,
            body: sms.body,
            campaignId: campaignId ?? undefined,
            subscriberId: sub.subscriber_id,
            workspaceId,
          },
          params.smsConfig!,
          supabase
        );

        return { id: sub.subscriber_id, ...result };
      }

      // Shared with the automation sender, so neither can quietly drift from the
      // other on unsubscribe links, merge tags or tracking.
      const email = buildRecipientEmail({
        baseHtml,
        subject,
        message,
        from,
        baseUrl,
        campaignId,
        subscriber: recipient,
      });

      const result = await sendWithRetry(
        {
          ...email,
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

  /*
   * Release the deferred claims before reading progress.
   *
   * Order matters. These rows are already 'pending' so they count as remaining
   * either way, but leaving them claimed would mean waiting out the stale-claim
   * window before anything could pick them up - on a daily cron that is a day
   * lost for no reason.
   */
  if (deferredIds.length > 0) {
    const { error: deferError } = await supabase.rpc("defer_campaign_recipients", {
      p_job_id: jobId,
      p_subscribers: deferredIds,
    });
    if (deferError) {
      // Not fatal: the claims go stale on their own and the rows return to the
      // pool. Worth knowing about, because until then the job looks stalled.
      logError(deferError, { scope: "send-queue.defer", jobId, count: deferredIds.length });
    }
  }

  const { data: progressRows, error: progressError } = await supabase.rpc(
    "campaign_job_progress",
    { p_job_id: jobId }
  );

  if (progressError) {
    logError(progressError, { scope: "send-queue.progress", jobId });
  }

  const progress = (progressRows ?? [])[0] as
    | { pending: number; sent: number; failed: number }
    | undefined;

  /*
   * An unknown progress state must read as "unfinished", not "done".
   *
   * This was `progress?.pending ?? 0`, and the error was not checked. So a
   * failed or empty progress query produced remaining = 0, finished = true, and
   * the job was marked complete with recipients still pending. Recovery only
   * looks for jobs in 'sending', so a job wrongly marked complete is never
   * retried: those people are never mailed and the campaign reports success.
   *
   * Which is exactly what the comment below has always claimed to prevent. The
   * guard was right and its default was backwards - the one direction where
   * being wrong is silent and permanent.
   *
   * `1` rather than a real count because the number is unknown; it only has to
   * be non-zero to keep the job open for the recovery cron, which recomputes
   * from campaign_job_recipients rather than trusting this.
   */
  const remaining = progress ? progress.pending : 1;

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

  return { sentCount, failedCount, deferredCount: deferredIds.length, remaining, interrupted };
}
