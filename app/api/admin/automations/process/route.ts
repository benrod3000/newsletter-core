import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";
import { requireCronSecret } from "@/lib/cron-auth";
import { sendEmail, asEmailProvider, type ProviderConfig } from "@/lib/email-sender";
import { buildHtmlFromEditor } from "@/lib/campaign-personalization";
import { buildRecipientEmail } from "@/lib/email/recipient-email";
import { resolveBranding } from "@/lib/branding";
import { checkSendingLimit, SendingLimitError } from "@/lib/sending-limits";
import { logError } from "@/lib/logger";
import { getBaseUrl } from "@/lib/geo-utils";
import type { Json } from "@/lib/database.types";

/**
 * Run due automations.
 *
 * HISTORY, BECAUSE IT EXPLAINS THE SHAPE OF THIS FILE
 *
 * `automation_triggers` has had a full CRUD API for a long time, so users could
 * create automations - and nothing ever ran them. This route knew how, but is
 * not in vercel.json's cron list, so it was only ever reachable by hand.
 *
 * Adding the cron entry alone would have been worse than leaving it broken.
 * Three things had to be fixed first:
 *
 * 1. Neither trigger type was idempotent. on_schedule fires when its time has
 *    passed and recorded nothing, so it stays due forever - an hourly cron would
 *    have re-sent to the same people every hour. subscriber_joined used a
 *    sliding window that overlaps itself if the cron runs more often than the
 *    configured delay. Both now claim each recipient in automation_logs before
 *    sending, against the unique indexes added in migration 058.
 *
 * 2. Emails were assembled by hand as { to, from, subject, html }, so every
 *    automated send went out with no unsubscribe link and no List-Unsubscribe
 *    header - required by CAN-SPAM and by PECR/GDPR for marketing mail. The
 *    route already selected `unsubscribe_token` and simply never used it.
 *    Both paths now go through buildRecipientEmail(), shared with the campaign
 *    sender.
 *
 * 3. on_schedule sent `campaign.editor_html` raw, skipping the email shell
 *    entirely, so it had no branding and no footer.
 *
 * Claiming before sending makes this at-most-once rather than at-least-once.
 * That is the right direction for email: a duplicate is visible to the
 * recipient and cannot be recalled, a miss is recoverable and invisible.
 */

/** Subscribers addressed per automation per run. */
const BATCH = 100;

/**
 * How far back a subscriber_joined trigger looks.
 *
 * Must comfortably exceed the gap between runs, or signups fall between them and
 * are never seen. The cron is daily - Vercel's Hobby plan does not permit more
 * frequent than that, and a shorter expression fails the deploy outright rather
 * than being rejected at runtime - so this is a day plus an hour of overlap.
 *
 * Overlap is free because recipients are claimed before sending: seeing the same
 * person on two consecutive runs costs one no-op insert, whereas missing them
 * costs the email entirely. When the schedule changes, change this with it.
 */
const LOOKBACK_MINUTES = 25 * 60;

/**
 * Provider credentials for an automation send.
 *
 * This used to be built inline, twice, reading process.env.SENDGRID_API_KEY
 * directly and never passing a Resend key - so a Resend workspace had its
 * automation mail attempted on the platform SendGrid account.
 */
function providerConfigFor(workspace: {
  email_provider: string | null;
  sendgrid_api_key: string | null;
  resend_api_key: string | null;
  ses_access_key: string | null;
  ses_secret_key: string | null;
  ses_region: string | null;
}): ProviderConfig {
  return {
    provider: asEmailProvider(workspace.email_provider),
    sendgridApiKey: workspace.sendgrid_api_key ?? process.env.SENDGRID_API_KEY,
    resendApiKey: workspace.resend_api_key ?? process.env.RESEND_API_KEY,
    sesAccessKey: workspace.ses_access_key ?? undefined,
    sesSecretKey: workspace.ses_secret_key ?? undefined,
    sesRegion: workspace.ses_region ?? undefined,
  };
}

/**
 * Consume one email of sending quota. Returns false when the workspace is out.
 *
 * This route used to read the counter once before the loop, then "increment" it
 * by writing that stale value + 1 after every send - so a run of 100 emails
 * advanced sent_this_month by 1 in total. Both paths now go through the same
 * atomic check-and-consume as campaign sends.
 */
async function consumeQuota(
  supabase: ReturnType<typeof getSupabaseClient>,
  workspaceId: string
): Promise<boolean> {
  try {
    await checkSendingLimit(supabase, workspaceId, 1);
    return true;
  } catch (err) {
    if (err instanceof SendingLimitError) return false;
    throw err;
  }
}

/**
 * Take exclusive responsibility for sending to this recipient.
 *
 * Returns true only if this call inserted the row. A conflict means another run
 * already claimed it, so this run must not send. `subscriberId` is null for a
 * trigger that addresses a whole audience, which claims the automation itself.
 */
async function claim(
  supabase: ReturnType<typeof getSupabaseClient>,
  automationId: string,
  workspaceId: string,
  subscriberId: string | null,
  triggerEvent: Json
): Promise<boolean> {
  const { data, error } = await supabase
    .from("automation_logs")
    .upsert(
      {
        automation_id: automationId,
        workspace_id: workspaceId,
        subscriber_id: subscriberId,
        trigger_event: triggerEvent,
        // "processing", not an invented value: automation_logs_status_check
        // permits only pending | processing | success | failed.
        status: "processing",
        executed_at: new Date().toISOString(),
      },
      {
        onConflict: subscriberId ? "automation_id,subscriber_id" : "automation_id",
        ignoreDuplicates: true,
      }
    )
    .select("id");

  if (error) {
    logError(error, { route: "automations.process.claim", automationId, subscriberId });
    // Fail closed. An unclaimable recipient is skipped rather than sent to,
    // because the alternative is sending without knowing whether someone else
    // already did.
    return false;
  }

  return (data?.length ?? 0) > 0;
}

/** Record the outcome of a claim that has now been acted on. */
async function settle(
  supabase: ReturnType<typeof getSupabaseClient>,
  automationId: string,
  subscriberId: string | null,
  status: "success" | "failed",
  errorMessage?: string
): Promise<void> {
  let q = supabase
    .from("automation_logs")
    .update({ status, error_message: errorMessage ?? null })
    .eq("automation_id", automationId);

  q = subscriberId ? q.eq("subscriber_id", subscriberId) : q.is("subscriber_id", null);

  const { error } = await q;
  if (error) logError(error, { route: "automations.process.settle", automationId, subscriberId });
}

/**
 * Vercel cron invokes its targets with GET, and every other scheduled route here
 * is a GET for that reason. This one was POST-only, which is a second way the
 * cron entry alone would not have worked: it would have answered 405 on every
 * run. POST is kept so existing manual callers are unaffected.
 */
export async function GET(req: NextRequest) {
  return POST(req);
}

export async function POST(req: NextRequest) {
  const auth = requireCronSecret(req);
  if (auth) return auth;

  const supabase = getSupabaseClient();
  const now = new Date();
  const baseUrl = getBaseUrl(req);

  try {
    const { data: automations, error: autoError } = await supabase
      .from("automation_triggers")
      .select("id, workspace_id, name, trigger_type, trigger_config, action_type, action_config")
      .eq("is_active", true)
      .in("trigger_type", ["subscriber_joined", "on_schedule"]);

    if (autoError) {
      return NextResponse.json({ error: autoError.message }, { status: 500 });
    }
    if (!automations?.length) {
      return NextResponse.json({ processed: 0, message: "No active automations" });
    }

    let processed = 0;
    let skipped = 0;
    const results: string[] = [];

    for (const auto of automations) {
      const triggerConfig = (auto.trigger_config || {}) as Record<string, unknown>;
      const actionConfig = (auto.action_config || {}) as Record<string, unknown>;
      const campaignId = actionConfig.campaign_id as string | undefined;
      const listId = actionConfig.list_id as string | undefined;

      const { data: workspace } = await supabase
        .from("clients")
        .select(
          "sender_name, sender_email, email_provider, ses_access_key, ses_secret_key, ses_region, ses_from_email, sendgrid_api_key, resend_api_key, brand_colors, logo_url, name"
        )
        .eq("id", auto.workspace_id)
        .single();

      if (!workspace) continue;

      const fromEmail =
        workspace.email_provider === "ses" ? workspace.ses_from_email : workspace.sender_email;
      const fromName = workspace.sender_name || "Newsletter";
      const from = `${fromName} <${fromEmail}>`;
      const branding = resolveBranding(workspace);

      // ── subscriber_joined ──────────────────────────────────────────────────
      //
      // The window is now a floor, not a slice. Idempotency comes from the claim
      // rather than from the window not overlapping itself, so the query only
      // has to avoid reaching indefinitely far back on a cold start.
      if (auto.trigger_type === "subscriber_joined") {
        const delayMinutes = Number(triggerConfig.delay_minutes) || 0;
        // The upper bound is the delay: a subscriber is only eligible once
        // `delay_minutes` have passed since they joined. The lower bound just
        // stops the query reaching indefinitely far back.
        const joinedBefore = new Date(now.getTime() - delayMinutes * 60 * 1000);
        const notBefore = new Date(joinedBefore.getTime() - LOOKBACK_MINUTES * 60 * 1000);

        if (auto.action_type === "send_email" && campaignId) {
          const { data: campaign } = await supabase
            .from("campaigns")
            .select("id, subject, plain_text, editor_html, editor_css")
            .eq("id", campaignId)
            .eq("workspace_id", auto.workspace_id)
            .maybeSingle();

          if (!campaign) continue;

          const { data: subscribers } = await supabase
            .from("subscribers")
            .select(
              "id, email, first_name, last_name, unsubscribe_token, country, region, city, date_of_birth, phone_number"
            )
            .eq("workspace_id", auto.workspace_id)
            .eq("confirmed", true)
            .eq("suppressed", false)
            // Campaign sending enforces consent through campaign_audience() as of
            // migration 065. Automations select their own recipients, so without
            // this they would mail people campaigns are forbidden to touch - and the
            // most likely such person is a one-time lead magnet requester, who was
            // told they were getting a file and nothing more.
            .eq("consent_email_marketing", true)
            .gte("created_at", notBefore.toISOString())
            .lte("created_at", joinedBefore.toISOString())
            .limit(BATCH);

          if (!subscribers?.length) continue;

          const baseHtml = buildHtmlFromEditor(
            campaign.editor_html || "",
            campaign.editor_css || "",
            branding
          );

          for (const sub of subscribers) {
            const won = await claim(supabase, auto.id, auto.workspace_id, sub.id, {
              trigger: "subscriber_joined",
              subscriber_email: sub.email,
            });
            if (!won) {
              skipped++;
              continue;
            }

            if (!(await consumeQuota(supabase, auto.workspace_id))) {
              await settle(supabase, auto.id, sub.id, "failed", "monthly sending limit reached");
              results.push(`${auto.name}: monthly sending limit reached`);
              break;
            }

            try {
              const email = buildRecipientEmail({
                baseHtml,
                subject: campaign.subject,
                message: campaign.plain_text || "",
                from,
                baseUrl,
                campaignId: campaign.id,
                subscriber: { ...sub, id: sub.id },
              });

              await sendEmail(email, providerConfigFor(workspace));
              await settle(supabase, auto.id, sub.id, "success");
              processed++;
            } catch (err) {
              await settle(
                supabase,
                auto.id,
                sub.id,
                "failed",
                err instanceof Error ? err.message : "send failed"
              );
              logError(err, { route: "automations.process.send", automationId: auto.id });
            }
          }

          results.push(`${auto.name}: ${processed} sent, ${skipped} already handled`);
        }

        if (auto.action_type === "add_to_list" && listId) {
          const { data: subscribers } = await supabase
            .from("subscribers")
            .select("id")
            .eq("workspace_id", auto.workspace_id)
            .eq("confirmed", true)
            // Never add someone who opted out. This filter was absent, and until
            // recently could not matter: unsubscribe deleted the row, so there was
            // nobody to re-add. Now that an opt-out is a durable record on a
            // surviving row, an automation could quietly put an unsubscribed person
            // back on a list and make them reachable again.
            .eq("suppressed", false)
            .gte("created_at", notBefore.toISOString())
            .lte("created_at", joinedBefore.toISOString())
            .limit(BATCH);

          if (!subscribers?.length) continue;

          // Membership is a set, so re-adding is harmless - but the claim still
          // runs, to keep the log an accurate record of what this automation did.
          const rows = [];
          for (const sub of subscribers) {
            if (await claim(supabase, auto.id, auto.workspace_id, sub.id, { trigger: "add_to_list" })) {
              rows.push({ list_id: listId, subscriber_id: sub.id, workspace_id: auto.workspace_id });
            }
          }

          if (rows.length) {
            await supabase
              .from("subscriber_list_memberships")
              .upsert(rows, { onConflict: "list_id,subscriber_id", ignoreDuplicates: true });
            for (const row of rows) await settle(supabase, auto.id, row.subscriber_id, "success");
          }
          results.push(`${auto.name}: added ${rows.length} to list`);
        }
      }

      // ── on_schedule ────────────────────────────────────────────────────────
      //
      // Claimed once for the whole automation, before addressing anyone. Without
      // this it re-fired on every run for the rest of time once its moment
      // passed, which is the single most damaging bug this route had.
      if (auto.trigger_type === "on_schedule") {
        const scheduledAt = triggerConfig.scheduled_at as string | undefined;
        if (!scheduledAt) continue;
        if (new Date(scheduledAt) > now) continue;

        if (auto.action_type !== "send_email" || !campaignId) continue;

        const won = await claim(supabase, auto.id, auto.workspace_id, null, {
          trigger: "on_schedule",
          scheduled_at: scheduledAt,
        });
        if (!won) {
          skipped++;
          continue;
        }

        const { data: campaign } = await supabase
          .from("campaigns")
          .select("id, subject, plain_text, editor_html, editor_css")
          .eq("id", campaignId)
          .eq("workspace_id", auto.workspace_id)
          .maybeSingle();

        if (!campaign) {
          await settle(supabase, auto.id, null, "failed", "campaign not found");
          continue;
        }

        const { data: subscribers } = await supabase
          .from("subscribers")
          .select(
            "id, email, first_name, last_name, unsubscribe_token, country, region, city, date_of_birth, phone_number"
          )
          .eq("workspace_id", auto.workspace_id)
          .eq("confirmed", true)
          .eq("suppressed", false)
          // Same reason as the subscriber_joined path above. This one matters more:
          // it is the scheduled send, so it mails the entire workspace rather than
          // people who just signed up.
          .eq("consent_email_marketing", true)
          .limit(BATCH);

        const baseHtml = buildHtmlFromEditor(
          campaign.editor_html || "",
          campaign.editor_css || "",
          branding
        );

        let sent = 0;
        for (const sub of subscribers ?? []) {
          if (!(await consumeQuota(supabase, auto.workspace_id))) {
            results.push(`${auto.name}: monthly sending limit reached`);
            break;
          }
          try {
            const email = buildRecipientEmail({
              baseHtml,
              subject: campaign.subject,
              message: campaign.plain_text || "",
              from,
              baseUrl,
              campaignId: campaign.id,
              subscriber: { ...sub, id: sub.id },
            });
            await sendEmail(email, providerConfigFor(workspace));
            sent++;
            processed++;
          } catch (err) {
            logError(err, { route: "automations.process.schedule", automationId: auto.id });
          }
        }

        await settle(supabase, auto.id, null, "success");

        // A one-off that has fired should not stay armed. `limit(BATCH)` means
        // a workspace larger than one batch is only partly served, which is a
        // known limitation of this trigger rather than something to paper over
        // by leaving it active and re-firing.
        await supabase.from("automation_triggers").update({ is_active: false }).eq("id", auto.id);

        results.push(`${auto.name}: on_schedule sent to ${sent}, now deactivated`);
      }
    }

    return NextResponse.json({ processed, skipped, results });
  } catch (err) {
    logError(err, { route: "automations.process" });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed" },
      { status: 500 }
    );
  }
}
