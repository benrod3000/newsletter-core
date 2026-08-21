import { NextRequest } from "next/server";
import { requireCronSecret } from "@/lib/cron-auth";
import { apiSuccess, apiInternalError } from "@/lib/api-response";
import { getSupabaseClient } from "@/lib/supabase";
import { drainCampaignJob } from "@/lib/send-queue";
import { buildDispatcherConfig } from "@/lib/email/dispatcher";
import { logError, logWarn } from "@/lib/logger";
import { PLATFORM_FALLBACK_FROM_EMAIL } from "@/lib/platform-sender";
import { getApiBaseUrl } from "@/lib/geo-utils";

/**
 * GET /api/admin/campaigns/recover
 *
 * Finishes campaign jobs that stopped partway - a function timeout, a crash, or
 * a deploy mid-send. A job is "unfinished" iff it still has pending recipient
 * rows, so recovery is just: drain it again.
 *
 * The previous implementation reconstructed the remaining recipients as
 * `subscribers LIMIT total OFFSET sent_so_far`. That offset indexed into an
 * unordered query and ignored the campaign's audience and geo filters entirely,
 * so recovery could email people who were never part of the campaign. Per-
 * recipient rows (migration 044) remove the guesswork.
 */
export const maxDuration = 120;

/** Leave headroom under maxDuration to record results and respond. */
const DRAIN_BUDGET_MS = 100_000;
/** Only touch jobs that have been quiet for a while, so we never race a live send. */
const STALE_AFTER_MS = 15 * 60 * 1000;
const MAX_JOBS_PER_RUN = 5;

export async function GET(req: NextRequest) {
  const auth = requireCronSecret(req);
  if (auth) return auth;

  const supabase = getSupabaseClient();
  const startedAt = Date.now();

  try {
    const staleTime = new Date(Date.now() - STALE_AFTER_MS).toISOString();

    const { data: jobs, error: jobsError } = await supabase
      .from("campaign_jobs")
      .select("id, campaign_id, total, sent_so_far")
      .eq("status", "sending")
      .lt("started_at", staleTime)
      .order("started_at", { ascending: true })
      .limit(MAX_JOBS_PER_RUN);

    if (jobsError) {
      logError(jobsError, { scope: "recover.listJobs" });
      return apiInternalError("Failed to query campaign jobs");
    }
    if (!jobs?.length) {
      return apiSuccess({ recovered: 0, message: "No unfinished jobs" });
    }

    const results: Array<{ jobId: string; sent: number; remaining: number }> = [];

    for (const job of jobs) {
      // Don't start a job we can't make progress on.
      if (Date.now() - startedAt > DRAIN_BUDGET_MS / 2) {
        logWarn("recover: budget spent, remaining jobs left for next run", {
          processed: results.length,
        });
        break;
      }

      if (!job.campaign_id) {
        // Ad-hoc blast: the message no longer exists anywhere to re-render from.
        await closeJob(supabase, job.id, "failed");
        continue;
      }

      const { data: campaign } = await supabase
        .from("campaigns")
        .select("id, workspace_id, subject, editor_html, editor_css, plain_text")
        .eq("id", job.campaign_id)
        .maybeSingle();

      if (!campaign) {
        await closeJob(supabase, job.id, "failed");
        continue;
      }

      const { data: client, error: clientError } = await supabase
        .from("clients")
        .select("email_provider, fallback_provider, sandbox_mode, sendgrid_api_key, resend_api_key, sender_email, sender_name")
        .eq("id", campaign.workspace_id)
        .maybeSingle();

      // Discarded until migration 055, which is what made this survivable: the
      // select referenced two columns that did not exist, so `client` was always
      // null and recovery re-sent through whatever buildDispatcherConfig({})
      // defaults to. Recovering a campaign onto the wrong provider and the wrong
      // from-address is worse than leaving it for a human.
      if (clientError || !client) {
        logError(clientError ?? new Error("workspace not found"), {
          scope: "recover.loadWorkspace",
          workspaceId: campaign.workspace_id,
          jobId: job.id,
        });
        await closeJob(supabase, job.id, "failed");
        continue;
      }

      const dispatchConfig = {
        ...buildDispatcherConfig(client),
        sandbox: client.sandbox_mode === true,
      };

      const result = await drainCampaignJob({
        jobId: job.id,
        workspaceId: campaign.workspace_id,
        campaignId: campaign.id,
        subject: campaign.subject || "Newsletter update",
        message: campaign.plain_text || "",
        messageHtml: campaign.editor_html || "",
        messageCss: campaign.editor_css || "",
        // Was `process.env.NEXT_PUBLIC_APP_URL || ""`, which is the frontend -
        // so a campaign finished by recovery mailed the remainder of its
        // audience with dead tracking, dead click-throughs and a dead
        // unsubscribe link, and with "" as the fallback, links reading
        // "/api/track/open?..." with no origin at all.
        baseUrl: getApiBaseUrl(req),
        fromEmail: client.sender_email || process.env.SENDGRID_FROM_EMAIL || PLATFORM_FALLBACK_FROM_EMAIL,
        fromName: client.sender_name || "Veloce",
        dispatchConfig,
        timeBudgetMs: Math.max(10_000, DRAIN_BUDGET_MS - (Date.now() - startedAt)),
      });

      results.push({ jobId: job.id, sent: result.sentCount, remaining: result.remaining });
    }

    return apiSuccess({
      recovered: results.length,
      jobs: results,
      message: `Processed ${results.length} unfinished job(s)`,
    });
  } catch (err) {
    logError(err, { scope: "recover" });
    return apiInternalError("Recovery failed");
  }
}

async function closeJob(
  supabase: ReturnType<typeof getSupabaseClient>,
  jobId: string,
  status: "failed" | "complete"
) {
  await supabase
    .from("campaign_jobs")
    .update({ status, completed_at: new Date().toISOString() })
    .eq("id", jobId);
}
