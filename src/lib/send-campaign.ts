import { getSupabaseClient } from "@/lib/supabase";
import { checkSendingLimit } from "@/lib/sending-limits";
import {
  enqueueCampaignJob,
  drainCampaignJob,
  DEFAULT_TIME_BUDGET_MS,
} from "@/lib/send-queue";
import type { GeoFilter } from "@/lib/geo-utils";
import type { DispatchConfig } from "@/lib/email/dispatcher";
import { resolveBranding, type Branding } from "@/lib/branding";
import { PLATFORM_FALLBACK_FROM_EMAIL } from "@/lib/platform-sender";

/**
 * Audience selector.
 *
 * The template-literal member is what makes this a real union - the previous
 * `| string` collapsed it back to `string`, so a typo'd audience compiled fine
 * and silently sent to the wrong people.
 */
/**
 * The audiences a campaign may target.
 *
 * `geo` behaves as "all", narrowed by the campaign's `geo_filter` columns rather
 * than by the audience string itself - `campaign_audience()` matches none of its
 * audience branches for it, which leaves every subscriber eligible before the
 * country/region/city/radius parameters are applied.
 */
export type Audience = "all" | "confirmed" | "pending" | "claimed_offer" | "geo" | `list:${string}`;

/** The fixed audiences, as a value - see isValidAudience. */
export const FIXED_AUDIENCES = ["all", "confirmed", "pending", "claimed_offer", "geo"] as const;

const LIST_AUDIENCE = /^list:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * Validate an audience before it reaches the database.
 *
 * There is a CHECK constraint on `campaigns.audience` saying the same thing, and it
 * had drifted from the UI twice: it never learned about lists, which made "Failed to
 * create campaign" the response to picking one, and then it never learned about
 * `geo`, which broke saving a draft the same way a day later. A constraint violation
 * surfaces as a 500 with no indication of which column was at fault, so each time it
 * read as the campaign feature being broken.
 *
 * Checking here makes the rejection a 400 that names the value, and leaves the
 * constraint as a backstop rather than the only gate. If you add an audience, add it
 * to this list, to the type above, and to the constraint - `audience-values.test.ts`
 * asserts the first two agree.
 */
export function isValidAudience(value: unknown): value is Audience {
  if (typeof value !== "string") return false;
  return (FIXED_AUDIENCES as readonly string[]).includes(value) || LIST_AUDIENCE.test(value);
}

/**
 * Look up the workspace's configured sending provider and build dispatch config.
 */
export async function getWorkspaceSender(
  supabase: ReturnType<typeof getSupabaseClient>,
  workspaceId: string
): Promise<{ fromEmail: string; fromName: string; dispatchConfig: DispatchConfig; branding: Branding }> {
  const { data: client, error } = await supabase
    .from("clients")
    .select(
      "email_provider, fallback_provider, sandbox_mode, ses_from_email, sender_email, sender_name, sendgrid_api_key, resend_api_key, brand_colors, logo_url, name"
    )
    .eq("id", workspaceId)
    .maybeSingle();

  // This error was discarded until migration 055. supabase-js resolves failures
  // as { error } rather than throwing, so a rejected select left `client` null and
  // every field below fell through to its default - which silently rewrote the
  // workspace's provider to "sendgrid" and its from-address to the platform fallback.
  // A workspace that picked Resend would have been dispatched through SendGrid.
  // Failing loudly is correct: sending with the wrong provider and the wrong
  // sender is worse than not sending.
  if (error || !client) {
    throw new Error(
      `Could not load sending configuration for workspace ${workspaceId}: ${
        error?.message ?? "workspace not found"
      }`
    );
  }

  return {
    branding: resolveBranding(client),
    fromEmail:
      client.sender_email || client.ses_from_email || process.env.SENDGRID_FROM_EMAIL || PLATFORM_FALLBACK_FROM_EMAIL,
    fromName: client.sender_name || "Veloce",
    dispatchConfig: {
      provider: client.email_provider || "sendgrid",
      fallbackProvider: client.fallback_provider || undefined,
      sandbox: client.sandbox_mode === true,
      credentials: {
        // Workspace key first, platform key as fallback. The fallback is what
        // makes every tenant share one sender reputation, so it is a migration
        // aid rather than the intended steady state.
        sendgrid: client.sendgrid_api_key || process.env.SENDGRID_API_KEY,
        resend: client.resend_api_key || process.env.RESEND_API_KEY,
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
  //
  // A rejection has to close the job. enqueue has already written the recipient
  // rows, and a job sitting in 'sending' with pending rows is precisely what
  // /api/admin/campaigns/recover looks for - left open, the recovery cron would
  // drain the whole campaign 15 minutes later, past the limit that just
  // refused it.
  try {
    await checkSendingLimit(supabase, workspaceId, queued);
  } catch (err) {
    await supabase
      .from("campaign_jobs")
      .update({ status: "failed", completed_at: new Date().toISOString() })
      .eq("id", jobId);
    throw err;
  }

  // Same reasoning as the sending-limit check above, and the same handling: this
  // now throws rather than silently defaulting the provider, and the job is
  // already 'sending' with recipient rows written. Left open, the recovery cron
  // would pick it up and hit the identical failure 15 minutes later, forever.
  let sender: Awaited<ReturnType<typeof getWorkspaceSender>>;
  try {
    sender = await getWorkspaceSender(supabase, workspaceId);
  } catch (err) {
    await supabase
      .from("campaign_jobs")
      .update({ status: "failed", completed_at: new Date().toISOString() })
      .eq("id", jobId);
    throw err;
  }
  const { fromEmail, fromName, dispatchConfig, branding } = sender;

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
    branding,
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
