import { NextResponse } from "next/server";
import { withWorkspace } from "@/lib/with-workspace";
import { logError } from "@/lib/logger";
import { smsEnabled, smsDisabledResponse } from "@/lib/features";
import { getSupabaseClient } from "@/lib/supabase";
import { sendCampaignBlast } from "@/lib/send-campaign";
import { getApiBaseUrl, parseGeoFilter } from "@/lib/geo-utils";
import { smsSegments, MAX_SMS_SEGMENTS } from "@/lib/sms/segments";
import { SmsBodyTooLongError } from "@/lib/sms/recipient-sms";
import { audit } from "@/lib/audit-log";

export const maxDuration = 120;

/**
 * SMS campaigns, on the same durable queue email uses.
 *
 * What used to be here: a `for` loop inside the request handler that fetched up
 * to 500 subscribers without saying so, called Twilio one at a time, counted
 * successes in a local variable and returned. No job row, no per-recipient
 * state, no events, no idempotency key. A timeout partway through left nothing
 * that knew who had already been texted, so a retry texted them again, and the
 * 501st recipient was never contacted and never reported as missing.
 *
 * It now enqueues and drains exactly as a campaign send does, which brings the
 * per-recipient rows, the SKIP LOCKED claim, the send-time consent recheck, the
 * retry classification and the recovery cron with it.
 */

export const GET = withWorkspace<{ workspaceId: string }>(
  async ({ ctx, params }) => {
    if (!smsEnabled()) return smsDisabledResponse();
    const { workspaceId } = params;

    const supabase = getSupabaseClient();

    // The same predicate the send uses, not a second hand-written filter list.
    //
    // These were two separate PostgREST queries and they had already drifted:
    // the count omitted the "has a phone number" filter the send applied, so an
    // operator was shown a number larger than the set that would actually be
    // texted. Sharing `campaign_audience()` removes the possibility rather than
    // fixing this instance of it.
    const { data: reachable, error } = await supabase.rpc("count_campaign_recipients", {
      p_workspace: workspaceId,
      p_audience: "confirmed",
      p_channel: "sms",
    });

    if (error) {
      logError(error, { route: "clients.campaigns.sms.count", workspaceId: ctx.workspaceId });
      return NextResponse.json({ error: "Could not count recipients" }, { status: 500 });
    }

    return NextResponse.json({
      reachable: reachable ?? 0,
      // No claim about RCS. The previous copy here promised "RCS on Android, SMS
      // fallback on iOS" while the code attached MediaUrl to an ordinary Twilio
      // message, which is MMS. Real RCS needs a Google RBM agent, brand
      // verification and carrier approval.
      message:
        "SMS campaigns reach contacts who gave SMS consent and have a phone number on file.",
    });
  },
  { minRole: "viewer" }
);

export const POST = withWorkspace<{ workspaceId: string }>(
  async ({ req, ctx, params }) => {
    if (!smsEnabled()) return smsDisabledResponse();
    const { workspaceId } = params;

    let body: { message?: string; audience?: string; campaign_id?: string | null };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid body" }, { status: 400 });
    }

    const message = body.message?.trim();
    if (!message) {
      return NextResponse.json({ error: "Message body is required" }, { status: 400 });
    }

    // Cost is settled before anything is queued, not discovered on the invoice.
    //
    // Carriers bill per segment. A body is 160 characters in one segment if every
    // character is GSM-7, and 70 if a single character is not - so one curly
    // apostrophe pasted from a word processor can triple the cost of a send. The
    // old code just truncated at 1600 characters, silently, mid-sentence.
    const segments = smsSegments(message);
    if (segments.segments > MAX_SMS_SEGMENTS) {
      return NextResponse.json(
        {
          error:
            `This message is ${segments.segments} segments per recipient, over the ` +
            `${MAX_SMS_SEGMENTS} segment limit.`,
          encoding: segments.encoding,
          nonGsmCharacters: segments.nonGsmCharacters,
        },
        { status: 400 }
      );
    }

    try {
      const result = await sendCampaignBlast({
        workspaceId,
        channel: "sms",
        smsBody: message,
        campaignId: body.campaign_id ?? null,
        audience: body.audience || "confirmed",
        geoFilter: parseGeoFilter(null),
        baseUrl: getApiBaseUrl(req),
        // Unused by the SMS path, but required by the shared signature. An SMS
        // job never renders an email shell.
        subject: "",
        message: "",
        messageHtml: "",
        messageCss: "",
      });

      await audit(req, ctx, "sms_sent", {
        jobId: result.jobId,
        queued: result.queued,
        sent: result.sentCount,
        segmentsPerRecipient: segments.segments,
      });

      return NextResponse.json({
        job_id: result.jobId,
        queued: result.queued,
        sent: result.sentCount,
        failed: result.failedCount,
        remaining: result.remaining,
        segments_per_recipient: segments.segments,
        // Said plainly rather than reporting a completed send. A Twilio long code
        // takes about a second per message, so a large audience spans more than
        // one invocation by design and the recovery cron finishes it.
        message:
          result.remaining > 0
            ? `Queued ${result.queued}. Sent ${result.sentCount} so far; ${result.remaining} still to go and will continue automatically.`
            : `Sent to ${result.sentCount} recipient${result.sentCount === 1 ? "" : "s"}.`,
      });
    } catch (err) {
      if (err instanceof SmsBodyTooLongError) {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
      logError(err, { route: "clients.campaigns.sms.send", workspaceId: ctx.workspaceId });
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Could not send" },
        { status: 500 }
      );
    }
  },
  { minRole: "editor" }
);
