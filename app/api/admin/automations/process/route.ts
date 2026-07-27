import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";
import { requireCronSecret } from "@/lib/cron-auth";
import { sendEmail } from "@/lib/email-sender";
import { buildHtmlFromEditor } from "@/lib/campaign-personalization";
import { checkSendingLimit, SendingLimitError } from "@/lib/sending-limits";

/**
 * Consume one email of sending quota. Returns false when the workspace is out,
 * so the caller stops this automation instead of sending past the cap.
 *
 * This route used to read the counter once, before the loop, then "increment"
 * it by writing that same stale value + 1 after every send - so a run of 100
 * emails advanced sent_this_month by 1 in total, and the on_schedule loop below
 * never counted at all. Both paths now go through the same atomic
 * check-and-consume as campaign sends.
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
 * POST /api/admin/automations/process
 * Process pending automation triggers (designed to be called by a cron job).
 */
export async function POST(req: NextRequest) {
  const auth = requireCronSecret(req);
  if (auth) return auth;

  const supabase = getSupabaseClient();
  const now = new Date();

  try {
    // 1. Fetch active automations with subscriber_joined or on_schedule triggers
    const { data: automations, error: autoError } = await supabase
      .from("automation_triggers")
      .select("id, workspace_id, name, trigger_type, trigger_config, action_type, action_config")
      .eq("is_active", true)
      .in("trigger_type", ["subscriber_joined", "on_schedule"]);

    if (autoError) {
      return NextResponse.json({ error: autoError.message }, { status: 500 });
    }

    if (!automations || automations.length === 0) {
      return NextResponse.json({ processed: 0, message: "No active automations" });
    }

    let processed = 0;
    const results: string[] = [];

    for (const auto of automations) {
      const config = (auto.trigger_config || {}) as Record<string, unknown>;
      const delayMinutes = (config.delay_minutes as number) || 0;
      const actionConfig = (auto.action_config || {}) as Record<string, unknown>;
      const campaignId = actionConfig.campaign_id as string | undefined;
      const listId = actionConfig.list_id as string | undefined;

      // Get workspace email config
      const { data: workspace } = await supabase
        .from("clients")
        .select("sender_name, sender_email, email_provider, ses_access_key, ses_secret_key, ses_region, ses_from_email")
        .eq("id", auto.workspace_id)
        .single();

      if (!workspace) continue;

      const fromEmail = workspace.email_provider === "ses"
        ? workspace.ses_from_email
        : workspace.sender_email;
      const fromName = workspace.sender_name || "Newsletter";

      if (auto.trigger_type === "subscriber_joined") {
        // Find subscribers who joined after (now - delay) but before now
        const cutoff = new Date(now.getTime() - delayMinutes * 60 * 1000);

        const { data: subscribers } = await supabase
          .from("subscribers")
          .select("id, email, first_name, last_name, workspace_id, confirmed, unsubscribe_token, country, region, city, date_of_birth, phone_number")
          .eq("workspace_id", auto.workspace_id)
          .eq("confirmed", true)
          .eq("suppressed", false)
          .gte("created_at", cutoff.toISOString())
          .lt("created_at", now.toISOString())
          .limit(100);

        if (!subscribers || subscribers.length === 0) continue;

        if (auto.action_type === "send_email" && campaignId) {
          const { data: campaign } = await supabase
            .from("campaigns")
            .select("id, title, subject, editor_html, editor_css")
            .eq("id", campaignId)
            .single();

          if (!campaign) continue;

          for (const sub of subscribers) {
            if (!(await consumeQuota(supabase, auto.workspace_id))) {
              results.push(`${auto.name}: monthly sending limit reached`);
              break;
            }
            try {
              const html = campaign.editor_html
                ? buildHtmlFromEditor(campaign.editor_html, campaign.editor_css || "")
                : "";

              await sendEmail(
                {
                  to: sub.email,
                  from: `${fromName} <${fromEmail}>`,
                  subject: campaign.subject,
                  html,
                },
                {
                  provider: workspace.email_provider || "sendgrid",
                  sendgridApiKey: process.env.SENDGRID_API_KEY,
                  sesAccessKey: workspace.ses_access_key,
                  sesSecretKey: workspace.ses_secret_key,
                  sesRegion: workspace.ses_region,
                }
              );

              processed++;
            } catch (err) {
              console.error(`Automation ${auto.name} send failed for ${sub.email}:`, err);
            }
          }

          // Log
          await supabase.from("automation_logs").insert(
            subscribers.map((s) => ({
              automation_id: auto.id,
              subscriber_id: s.id,
              trigger_event: { trigger: "subscriber_joined", subscriber_email: s.email },
              status: "success",
              executed_at: now.toISOString(),
            }))
          );
          results.push(`${auto.name}: sent to ${subscribers.length} subscriber(s)`);
        }

        if (auto.action_type === "add_to_list" && listId) {
          const memberRows = subscribers.map((s) => ({
            list_id: listId,
            subscriber_id: s.id,
          }));
          await supabase.from("subscriber_list_memberships").insert(memberRows);
          results.push(`${auto.name}: added ${subscribers.length} to list`);
        }
      }

      if (auto.trigger_type === "on_schedule") {
        const scheduledAt = config.scheduled_at as string | undefined;
        if (!scheduledAt) continue;

        const scheduleDate = new Date(scheduledAt);
        if (scheduleDate > now) continue; // Not yet due

        // For on_schedule, send to the configured audience
        if (auto.action_type === "send_email" && campaignId) {
          const { data: campaign } = await supabase
            .from("campaigns")
            .select("id, subject, editor_html, editor_css")
            .eq("id", campaignId)
            .single();

          if (!campaign) continue;

          const { data: subscribers } = await supabase
            .from("subscribers")
            .select("id, email, first_name, last_name")
            .eq("workspace_id", auto.workspace_id)
            .eq("confirmed", true)
            .eq("suppressed", false)
            .limit(100);

          if (!subscribers) continue;

          for (const sub of subscribers) {
            if (!(await consumeQuota(supabase, auto.workspace_id))) {
              results.push(`${auto.name}: monthly sending limit reached`);
              break;
            }
            try {
              await sendEmail(
                {
                  to: sub.email,
                  from: `${fromName} <${fromEmail}>`,
                  subject: campaign.subject,
                  html: campaign.editor_html || "",
                },
                {
                  provider: workspace.email_provider || "sendgrid",
                  sendgridApiKey: process.env.SENDGRID_API_KEY,
                  sesAccessKey: workspace.ses_access_key,
                  sesSecretKey: workspace.ses_secret_key,
                  sesRegion: workspace.ses_region,
                }
              );
              processed++;
            } catch { /* skip failures */ }
          }
          results.push(`${auto.name}: on_schedule sent to ${subscribers.length} subscriber(s)`);
        }
      }
    }

    // Refresh analytics materialized views
    try {
      const { error: refreshErr } = await supabase.rpc("refresh_analytics_views");
      if (refreshErr) console.error("[automations] Analytics refresh failed:", refreshErr.message);
    } catch { /* views may not exist yet */ }

    return NextResponse.json({
      processed,
      results,
      message: `Processed ${processed} automation sends`,
    });
  } catch (error) {
    console.error("Automation process error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
