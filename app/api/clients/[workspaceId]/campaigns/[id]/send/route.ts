import { NextResponse } from "next/server";
import { isUuid } from "@/lib/route-params";
import { withWorkspace } from "@/lib/with-workspace";
import { getSupabaseClient } from "@/lib/supabase";
import { sendCampaignBlast } from "@/lib/send-campaign";
import { getBaseUrl, parseGeoFilter } from "@/lib/geo-utils";
import { audit, AUDIT_ACTIONS } from "@/lib/audit-log";
import { logError } from "@/lib/logger";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export const maxDuration = 120;

/**
 * POST /api/clients/[workspaceId]/campaigns/[id]/send
 * Send a campaign to its audience now.
 *
 * This route did not exist, and its absence is why "Send" did not send. The
 * dashboard's only send path was PATCH { schedule_now: true }, which sets
 * `status = 'scheduled'` and `scheduled_for = now()` and then relies on the
 * /api/admin/campaigns/process cron to do the actual work. That cron runs once
 * a day, so pressing a button labelled "Send to 10,310" parked the campaign for
 * up to 24 hours with no indication that it had.
 *
 * The admin equivalent (/api/admin/send) exists but sits behind admin Basic
 * Auth, so the dashboard's bearer token could never have reached it - the same
 * mismatch that previously broke the deliverability pages.
 *
 * Sending is delegated to sendCampaignBlast, the one pipeline every send goes
 * through, so this route decides *when*, never *how*.
 */
export const POST = withWorkspace<{ workspaceId: string; id: string }>(
  async ({ req, ctx, params }) => {
    const { id } = params;

    if (!isUuid(id)) {
      return NextResponse.json({ error: "Invalid campaign ID" }, { status: 422, headers: CORS });
    }

    // System-scoped client: sendCampaignBlast writes campaign_jobs and
    // campaign_job_recipients through getSupabaseClient() internally, and the
    // recipient-selection RPC runs across the workspace's subscribers. Reading
    // the campaign through the same client keeps one credential in play for the
    // whole operation. Tenant isolation is enforced by withWorkspace above and
    // by the explicit workspace_id filter below.
    const supabase = getSupabaseClient();

    const { data: campaign, error: loadError } = await supabase
      .from("campaigns")
      .select("id, workspace_id, subject, audience, geo_filter, editor_html, editor_css, plain_text, status")
      .eq("id", id)
      .eq("workspace_id", ctx.workspaceId)
      .maybeSingle();

    if (loadError) {
      logError(loadError, { route: "clients.campaigns.send", workspaceId: ctx.workspaceId, id });
      return NextResponse.json({ error: "Could not load the campaign." }, { status: 500, headers: CORS });
    }
    if (!campaign) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404, headers: CORS });
    }

    // Sending is irreversible, so a campaign that has already gone out must not
    // be re-sent by a double-click or a stale tab. "sending" is excluded too:
    // that state means a drain is mid-flight or awaiting recovery, and starting
    // a second job would queue the same audience twice.
    if (campaign.status === "sent" || campaign.status === "sending") {
      return NextResponse.json(
        { error: `This campaign is already ${campaign.status}. Duplicate sends are blocked.` },
        { status: 409, headers: CORS }
      );
    }

    // Claim the campaign before any mail moves. Two concurrent requests race
    // here, and the loser's update matches no row because the status is no
    // longer draft/scheduled - so exactly one send proceeds.
    const { data: claimed, error: claimError } = await supabase
      .from("campaigns")
      .update({ status: "sending", updated_by: ctx.email })
      .eq("id", id)
      .eq("workspace_id", ctx.workspaceId)
      .in("status", ["draft", "scheduled"])
      .select("id")
      .maybeSingle();

    if (claimError) {
      logError(claimError, { route: "clients.campaigns.send", workspaceId: ctx.workspaceId, id });
      return NextResponse.json({ error: "Could not start the send." }, { status: 500, headers: CORS });
    }
    if (!claimed) {
      return NextResponse.json(
        { error: "This campaign was already picked up by another send." },
        { status: 409, headers: CORS }
      );
    }

    const startedAt = new Date().toISOString();

    try {
      const result = await sendCampaignBlast({
        workspaceId: campaign.workspace_id,
        subject: campaign.subject,
        message: campaign.plain_text || "Newsletter update.",
        messageHtml: campaign.editor_html ?? "",
        messageCss: campaign.editor_css ?? "",
        audience: campaign.audience ?? "confirmed",
        geoFilter: parseGeoFilter(campaign.geo_filter),
        campaignId: campaign.id,
        baseUrl: getBaseUrl(req),
      });

      // A drain that ran out of time leaves recipients pending and the recovery
      // cron finishes it. Reporting that as "sent" would call a partial send
      // complete, which is the same mistake the scheduled path was careful to
      // avoid.
      const finished = result.remaining === 0;

      await supabase
        .from("campaigns")
        .update({
          status: finished ? "sent" : "sending",
          sent_count: result.sentCount,
          last_sent_at: startedAt,
          scheduled_for: null,
          last_error: finished
            ? null
            : `Partial send: ${result.remaining} recipient(s) pending recovery`,
          updated_by: ctx.email,
        })
        .eq("id", id)
        .eq("workspace_id", ctx.workspaceId);

      await audit(req, ctx, AUDIT_ACTIONS.CAMPAIGN_SENT, {
        campaign_id: id,
        subject: campaign.subject,
        audience: campaign.audience,
        queued: result.queued,
        sent_count: result.sentCount,
        failed_count: result.failedCount,
        remaining: result.remaining,
      });

      return NextResponse.json(
        {
          ok: true,
          jobId: result.jobId,
          queued: result.queued,
          sentCount: result.sentCount,
          failedCount: result.failedCount,
          remaining: result.remaining,
          status: finished ? "sent" : "sending",
        },
        { status: 200, headers: CORS }
      );
    } catch (err) {
      logError(err, { route: "clients.campaigns.send", workspaceId: ctx.workspaceId, id });
      const message = err instanceof Error ? err.message : "Send failed";

      // Release the claim. Leaving it on "sending" would permanently block
      // retries through the guard above for a send that never started - the
      // sending-limit and missing-provider rejections both land here and both
      // are conditions the operator can fix and try again.
      await supabase
        .from("campaigns")
        .update({ status: "draft", last_error: message, updated_by: ctx.email })
        .eq("id", id)
        .eq("workspace_id", ctx.workspaceId);

      return NextResponse.json({ error: message }, { status: 500, headers: CORS });
    }
  },
  { minRole: "editor" }
);

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}
