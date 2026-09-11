import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";
import { toE164 } from "@/lib/phone";
import { logError } from "@/lib/logger";
import { logAudit, extractRequestMeta, AUDIT_ACTIONS } from "@/lib/audit-log";
import { verifyTwilioSignature, signedUrlFor } from "@/lib/sms/twilio-signature";
import {
  classifyInboundSms,
  twiml,
  EMPTY_TWIML,
  OPT_OUT_REPLY,
  OPT_IN_REPLY,
  HELP_REPLY,
} from "@/lib/sms/keywords";

/**
 * Inbound SMS: STOP, START and HELP.
 *
 * This endpoint previously had four problems at once, and all of them are the
 * same kind of problem - it trusted the request.
 *
 *   1. No signature verification at all. It is public, it reads a phone number
 *      out of the body, and it opts that person out. A phone number is not a
 *      secret, so anyone who knew the URL could opt out anyone.
 *   2. No workspace scoping. It matched a subscriber across every tenant and
 *      took `data[0]`, so a STOP landed on one arbitrary workspace's row - and
 *      only one, even when the number existed in several.
 *   3. A trailing-wildcard `ilike` match, because nothing guaranteed what format
 *      the stored number was in. A suffix match silences whoever happens to
 *      share those trailing digits.
 *   4. It recognized three keywords out of the carrier-required set, and had no
 *      opt-in keyword at all, so an accidental STOP was irreversible.
 *
 * The opt-out is now also a record rather than only a flag flip, which is the
 * "suppression as a record" item from the architecture direction: a flag says
 * what is true now, a record says when it changed and why, and that difference
 * is what a compliance question needs.
 */

const TWIML_HEADERS = { "Content-Type": "text/xml" };

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    const params = new URLSearchParams(rawBody);

    const body: Record<string, string> = {};
    for (const [k, v] of params.entries()) body[k] = v;

    const from = toE164(body.From);
    const to = toE164(body.To);

    // A malformed From or To is not worth a 500 and not worth a signature check.
    if (!from || !to) {
      return NextResponse.json({ error: "Missing or unreadable From/To" }, { status: 400 });
    }

    const supabase = getSupabaseClient();

    /*
     * The workspace is identified by the number the message was sent TO.
     *
     * This is what makes the whole thing tenant-safe. Each workspace has its own
     * Twilio number, so `To` names the workspace exactly, and the subscriber
     * lookup can then be scoped to it and matched on an exact E.164 equality
     * rather than a suffix.
     *
     * It also gives us the right auth token to verify the signature with, which
     * is why this read happens before verification. It reveals nothing: the
     * response is identical whether or not the number is known.
     */
    const { data: workspace, error: workspaceError } = await supabase
      .from("clients")
      .select("id, twilio_auth_token")
      .eq("twilio_phone_number", to)
      .maybeSingle();

    if (workspaceError) {
      logError(workspaceError, { route: "public.sms.webhook.workspace" });
      return NextResponse.json({ error: "Could not process" }, { status: 500 });
    }

    // Unknown number, or a workspace with no auth token to verify against.
    // Both fail closed, and both answer the same way so this cannot be used to
    // enumerate which numbers the platform owns.
    if (!workspace?.twilio_auth_token) {
      return new NextResponse(EMPTY_TWIML, { status: 200, headers: TWIML_HEADERS });
    }

    const valid = verifyTwilioSignature({
      authToken: workspace.twilio_auth_token,
      url: signedUrlFor(req),
      body,
      signature: req.headers.get("x-twilio-signature"),
    });

    if (!valid) {
      // 403 and nothing else. Anyone reaching this branch is not Twilio.
      return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
    }

    const keyword = classifyInboundSms(body.Body);

    if (keyword === "help") {
      return new NextResponse(twiml(HELP_REPLY), { status: 200, headers: TWIML_HEADERS });
    }

    if (keyword === "none") {
      // An ordinary reply. Acknowledged, not answered.
      return new NextResponse(EMPTY_TWIML, { status: 200, headers: TWIML_HEADERS });
    }

    // Exact match, scoped to the workspace that owns the number.
    const { data: subscriber, error: subscriberError } = await supabase
      .from("subscribers")
      .select("id, email, sms_consent")
      .eq("workspace_id", workspace.id)
      .eq("phone_number", from)
      .maybeSingle();

    if (subscriberError) {
      logError(subscriberError, { route: "public.sms.webhook.subscriber", workspaceId: workspace.id });
      return NextResponse.json({ error: "Could not process" }, { status: 500 });
    }

    // Still confirm the opt-out even when there is no matching row. The person
    // asked to stop hearing from this number; telling them "we have no record of
    // you" would be both unhelpful and, if they were guessing at someone else's
    // number, informative.
    if (!subscriber) {
      const reply = keyword === "opt_out" ? OPT_OUT_REPLY : OPT_IN_REPLY;
      return new NextResponse(twiml(reply), { status: 200, headers: TWIML_HEADERS });
    }

    const optingOut = keyword === "opt_out";

    /*
     * `sms_consent` only. `suppressed` is deliberately untouched.
     *
     * They mean different things: `suppressed` is the global "never contact this
     * person" switch that every channel honours, and `sms_consent` is permission
     * for this one channel. Someone replying STOP to a text has not asked to stop
     * receiving the newsletter they signed up for by email, and treating it as if
     * they had would silently delete a subscription they still want.
     */
    const { error: updateError } = await supabase
      .from("subscribers")
      .update({
        sms_consent: !optingOut,
        sms_consented_at: optingOut ? null : new Date().toISOString(),
      })
      .eq("id", subscriber.id);

    if (updateError) {
      // Checked, because supabase-js resolves errors rather than throwing. An
      // unchecked failure here would reply "you have been unsubscribed" to
      // someone who has not been.
      logError(updateError, { route: "public.sms.webhook.update", workspaceId: workspace.id });
      return NextResponse.json({ error: "Could not process" }, { status: 500 });
    }

    // The record, not just the flag. Two rows on purpose: campaign_events is
    // where engagement analytics reads from, audit_logs is where a compliance
    // question gets answered.
    const { error: eventError } = await supabase.from("campaign_events").insert({
      workspace_id: workspace.id,
      subscriber_id: subscriber.id,
      // Null rather than the phone number: migration 073 made this nullable so a
      // non-email channel would not have to lie about what it is putting here.
      email: null,
      channel: "sms",
      event_type: optingOut ? "unsubscribe" : "resubscribe",
      metadata: { keyword: body.Body?.slice(0, 40) ?? "", source: "sms_inbound" },
    });

    if (eventError) {
      // Logged, not fatal. The consent change is the part that must not be lost,
      // and it has already succeeded.
      logError(eventError, { route: "public.sms.webhook.event", workspaceId: workspace.id });
    }

    const { ip, ua } = extractRequestMeta(req);
    await logAudit({
      workspace_id: workspace.id,
      // No user: the subscriber did this from their phone, not an operator from
      // the dashboard.
      action: optingOut ? AUDIT_ACTIONS.SMS_OPT_OUT : AUDIT_ACTIONS.SMS_OPT_IN,
      details: { subscriber_id: subscriber.id, via: "inbound_sms" },
      ip_address: ip,
      user_agent: ua,
    });

    return new NextResponse(twiml(optingOut ? OPT_OUT_REPLY : OPT_IN_REPLY), {
      status: 200,
      headers: TWIML_HEADERS,
    });
  } catch (err) {
    logError(err, { route: "public.sms.webhook" });
    return NextResponse.json({ error: "Could not process" }, { status: 500 });
  }
}
