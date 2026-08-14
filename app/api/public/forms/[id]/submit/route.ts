import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";
import { geolocateIP } from "@/lib/geo";
import { rateLimit } from "@/lib/rate-limit";
import { isDisposableEmail } from "@/lib/disposable-emails";
import { verifyTurnstileToken } from "@/lib/turnstile";
import { logError } from "@/lib/logger";
import { getClientIp } from "@/lib/client-ip";
import { getApiBaseUrl } from "@/lib/geo-utils";
import { resolveBranding, BRANDING_COLUMNS } from "@/lib/branding";
import { sendLeadMagnetEmail } from "@/lib/email/lead-magnet";
import type { TablesUpdate } from "@/lib/database.types";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * POST /api/public/forms/[id]/submit
 * Public endpoint - accepts an email, adds the subscriber to the widget's
 * target list, records the submission, emails the lead magnet, and fires any
 * subscriber_joined automation.
 *
 * The email is sent here, inline. It previously relied entirely on a
 * subscriber_joined automation, which sent nothing: production has no
 * automation_triggers, so the lookup returned empty and the helper returned
 * without doing anything, while the widget told the visitor to check their inbox.
 *
 * Keyed by widget id for the same reason as the GET alongside it: slug is only
 * unique per workspace, so matching on it alone could resolve to another
 * tenant's widget and file the submission under the wrong workspace.
 *
 * Body: {
 *   email: string,
 *   first_name?: string,
 *   last_name?: string,
 *   phone?: string,
 *   sms_consent?: boolean,
 *   postal_code?: string,
 *   message?: string,
 *   browser_latitude?: number,
 *   browser_longitude?: number,
 *   turnstile_token?: string,
 * }
 *
 * Returns { ok: true, download_url } - the download link or coupon code is
 * returned here rather than by the config endpoint, so it cannot be read
 * without actually submitting.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = getSupabaseClient();

  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "Form not found" }, { status: 404, headers: CORS_HEADERS });
  }

  // Rate limit: 10 submissions per minute per IP.
  const ip = getClientIp(req);
  const { allowed, retryAfter } = await rateLimit(`widget-submit:${ip}`, 10, 10 / 60);
  if (!allowed) {
    return NextResponse.json(
      { error: "Too many submissions. Please try again later." },
      {
        status: 429,
        headers: { "Retry-After": String(retryAfter), "Access-Control-Allow-Origin": "*" },
      }
    );
  }

  let body: {
    email?: string;
    first_name?: string;
    last_name?: string;
    phone?: string;
    sms_consent?: boolean;
    postal_code?: string;
    message?: string;
    browser_latitude?: number;
    browser_longitude?: number;
    turnstile_token?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400, headers: CORS_HEADERS });
  }

  const email = body.email?.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json(
      { error: "Please enter a valid email address." },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  // Verified when supplied. Note this is not enforcement: a caller that omits
  // the token skips the check entirely, so this cannot be relied on as bot
  // protection while the form does not render a Turnstile. Per-IP rate limiting
  // above is the control that actually applies today.
  if (body.turnstile_token && !(await verifyTurnstileToken(body.turnstile_token))) {
    return NextResponse.json(
      { error: "Security check failed. Please try again." },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  if (isDisposableEmail(email)) {
    return NextResponse.json(
      { error: "Disposable email addresses are not allowed." },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  // `name` and `headline` are read so the delivery email can say what it is
  // delivering rather than "your download".
  const { data: widget, error: widgetError } = await supabase
    .from("widgets")
    .select("id, workspace_id, slug, list_id, download_url, is_active, type, name, headline, email_subject, email_body, email_heading, subscribe_to_list")
    .eq("id", id)
    .maybeSingle();

  if (widgetError) {
    logError(widgetError, { route: "public.forms.submit", widgetId: id });
    return NextResponse.json({ error: "Failed to load form" }, { status: 500, headers: CORS_HEADERS });
  }

  if (!widget) {
    return NextResponse.json({ error: "Form not found" }, { status: 404, headers: CORS_HEADERS });
  }

  if (!widget.is_active) {
    return NextResponse.json(
      { error: "This form is no longer accepting submissions." },
      { status: 410, headers: CORS_HEADERS }
    );
  }

  const { workspace_id: workspaceId, list_id: listId, download_url: downloadUrl, slug } = widget;
  const leadTitle = widget.headline?.trim() || widget.name?.trim() || null;

  const userAgent = req.headers.get("user-agent") || null;
  const referrer = req.headers.get("referer") || null;

  // Browser GPS overrides the IP lookup.
  const ipGeo = await geolocateIP(ip);
  const finalLatitude = body.browser_latitude ?? ipGeo?.latitude ?? null;
  const finalLongitude = body.browser_longitude ?? ipGeo?.longitude ?? null;
  const finalPostalCode = ipGeo?.postal_code ?? null;
  const finalFirstName = body.first_name?.trim().slice(0, 80) || null;
  const finalLastName = body.last_name?.trim().slice(0, 80) || null;
  const finalPhone = body.phone?.trim().slice(0, 20) || null;
  const finalUserPostal = body.postal_code?.trim().slice(0, 20) || null;
  const finalMessage = body.message?.trim().slice(0, 2000) || null;
  const smsConsentGiven = body.sms_consent === true;

  const { subscriberId, suppressed, unsubscribeToken, error: subscriberError } = await resolveSubscriber({
    supabase,
    workspaceId,
    email,
    slug,
    finalFirstName,
    finalLastName,
    finalPhone,
    finalUserPostal,
    finalPostalCode,
    finalLatitude,
    finalLongitude,
    smsConsentGiven,
    ipGeo,
    req,
  });

  if (subscriberError || !subscriberId) {
    logError(subscriberError ?? new Error("Subscriber resolve failed"), {
      route: "public.forms.submit.subscriber",
      widgetId: id,
    });
    return NextResponse.json(
      { error: "Failed to register. Please try again." },
      { status: 500, headers: CORS_HEADERS }
    );
  }

  // A widget only joins someone to its list when it says it does. Delivering a
  // file someone asked for and signing them up for future mail are different
  // relationships, and the second is not implied by the first - see migration 064.
  // A suppressed person is never re-added regardless: they opted out, and a form
  // submission is not a fresh opt-in.
  if (listId && widget.subscribe_to_list && !suppressed) {
    const { data: existingMembership } = await supabase
      .from("subscriber_list_memberships")
      .select("id")
      .eq("subscriber_id", subscriberId)
      .eq("list_id", listId)
      .maybeSingle();

    if (!existingMembership) {
      const { error } = await supabase.from("subscriber_list_memberships").insert({
        subscriber_id: subscriberId,
        list_id: listId,
        // NOT NULL since migration 048.
        workspace_id: workspaceId,
      });

      if (error) {
        logError(error, { route: "public.forms.submit.membership", widgetId: id });
      }
    }
  }

  const { error: submissionError } = await supabase.from("widget_submissions").insert({
    widget_id: widget.id,
    subscriber_id: subscriberId,
    // NOT NULL since migration 048.
    workspace_id: workspaceId,
    email,
    message: finalMessage,
    ip_address: ip,
    user_agent: userAgent,
    referrer: referrer,
    latitude: finalLatitude,
    longitude: finalLongitude,
    postal_code: finalPostalCode,
  });

  if (submissionError) {
    logError(submissionError, { route: "public.forms.submit.record", widgetId: id });
  }

  // Someone who has unsubscribed or bounced must not be mailed again just
  // because they hit a form, so both the delivery email and the automation are
  // skipped for them. The submission is still recorded above - it happened, and
  // hiding it would make the widget's conversion numbers wrong.
  //
  // The email is sent inline rather than handed to the subscriber_joined
  // automation. That automation was the only thing this ever did with
  // download_url, and it could not deliver: there are no automation_triggers, and
  // the processor runs on a daily cron, so "the link is on its way" meant up to
  // 24 hours even in the case where one existed.
  let leadMagnetSent = false;
  let leadMagnetReason: string | undefined;

  if (!suppressed) {
    // Only lead magnets. A coupon widget stores its code in this same column and
    // shows it on screen, and a feedback widget has nothing to deliver.
    if (downloadUrl && widget.type === "lead_magnet") {
      // The workspace's logo and colours, so the first email a subscriber ever
      // gets looks like the site they signed up on. A failed read is not worth
      // blocking delivery over - resolveBranding falls back to the defaults.
      const { data: brandRow } = await supabase
        .from("clients")
        .select(BRANDING_COLUMNS)
        .eq("id", workspaceId)
        .maybeSingle();

      const result = await sendLeadMagnetEmail({
        email,
        subscriberId,
        leadUrl: downloadUrl,
        leadTitle,
        branding: resolveBranding(brandRow),
        unsubscribeToken,
        baseUrl: getApiBaseUrl(req),
        audienceName: widget.name,
        emailSubject: widget.email_subject,
        emailBody: widget.email_body,
        emailHeading: widget.email_heading,
      });
      leadMagnetSent = result.sent;
      if (!result.sent) {
        leadMagnetReason = result.reason;
        logError(new Error("Lead magnet email not sent"), {
          route: "public.forms.submit.lead-magnet",
          widgetId: id,
          reason: result.reason,
        });
      }
    }

    await triggerSubscriberJoined(supabase, workspaceId, subscriberId, email, downloadUrl, slug);
  }

  const { error: eventError } = await supabase.from("widget_events").insert({
    widget_id: widget.id,
    workspace_id: workspaceId,
    event_type: "submission",
    subscriber_id: subscriberId,
    occurred_at: new Date().toISOString(),
  });

  if (eventError) {
    logError(eventError, { route: "public.forms.submit.event", widgetId: id });
  }

  // The client renders the coupon code or download link from this. It is
  // deliberately absent from the config endpoint, so it cannot be read without
  // actually submitting.
  //
  // `email_sent` is reported so the success screen can tell the truth. It used to
  // say "check your inbox" unconditionally while no email existed at all.
  return NextResponse.json(
    {
      ok: true,
      download_url: downloadUrl ?? null,
      email_sent: leadMagnetSent,
      ...(leadMagnetReason ? { email_reason: leadMagnetReason } : {}),
    },
    { status: 200, headers: CORS_HEADERS }
  );
}

/**
 * Find or create the subscriber for this submission.
 *
 * Two things this handles that the previous inline version did not.
 *
 * The insert can lose a race. Checking for an existing row and then inserting
 * is not atomic, so two submissions of the same address arriving together both
 * saw nothing and both inserted, and the loser came back as a 23505 unique
 * violation reported to the visitor as "Failed to register". A conflict now
 * means the other request won, which is a success, so it re-reads and carries on.
 *
 * An existing subscriber used to have everything except coordinates thrown
 * away. Someone already on the list who filled in the form and ticked "text me
 * about events and offers" had that consent silently dropped. Values are now
 * filled in where the record has none - never overwritten, because a blank box
 * on a widget form is not a request to erase a name already on file, and never
 * revoked, because withdrawing consent belongs in an explicit flow rather than
 * as a side effect of an unticked box.
 */
async function resolveSubscriber({
  supabase,
  workspaceId,
  email,
  slug,
  finalFirstName,
  finalLastName,
  finalPhone,
  finalUserPostal,
  finalPostalCode,
  finalLatitude,
  finalLongitude,
  smsConsentGiven,
  ipGeo,
  req,
}: {
  supabase: ReturnType<typeof getSupabaseClient>;
  workspaceId: string;
  email: string;
  slug: string;
  finalFirstName: string | null;
  finalLastName: string | null;
  finalPhone: string | null;
  finalUserPostal: string | null;
  finalPostalCode: string | null;
  finalLatitude: number | null;
  finalLongitude: number | null;
  smsConsentGiven: boolean;
  ipGeo: Awaited<ReturnType<typeof geolocateIP>>;
  req: NextRequest;
}): Promise<{
  subscriberId: string | null;
  suppressed: boolean;
  unsubscribeToken: string | null;
  error: unknown;
}> {
  // `unsubscribe_token` is read so the lead magnet email can carry a working
  // opt-out link. CAN-SPAM wants the mechanism in the message, not just a header.
  const EXISTING_COLUMNS =
    "id, confirmed, suppressed, unsubscribe_token, first_name, last_name, phone, sms_consent, postal_code, latitude";

  const { data: existing } = await supabase
    .from("subscribers")
    .select(EXISTING_COLUMNS)
    .eq("email", email)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  let current = existing;

  if (!current) {
    const geoCountry = ipGeo?.country ?? req.headers.get("x-vercel-ip-country") ?? null;
    const geoRegion = ipGeo?.region ?? req.headers.get("x-vercel-ip-country-region") ?? null;
    const geoCity = ipGeo?.city ?? req.headers.get("x-vercel-ip-city") ?? null;

    const { data: newSub, error: createError } = await supabase
      .from("subscribers")
      .insert({
        workspace_id: workspaceId,
        email,
        first_name: finalFirstName,
        last_name: finalLastName,
        phone: finalPhone,
        sms_consent: smsConsentGiven,
        sms_consented_at: smsConsentGiven ? new Date().toISOString() : null,
        postal_code: finalPostalCode || finalUserPostal,
        confirmed: true, // widget signups are single opt-in by default
        consent_email_marketing: true,
        consent_version: "widget-2026",
        consent_text: "I agree to receive emails from this sender.",
        consented_at: new Date().toISOString(),
        country: geoCountry,
        region: geoRegion,
        city: geoCity,
        latitude: finalLatitude,
        longitude: finalLongitude,
        consent_source: `widget:${slug}`,
      })
      .select("id, unsubscribe_token")
      .single();

    if (!createError && newSub) {
      return {
        subscriberId: newSub.id,
        suppressed: false,
        unsubscribeToken: newSub.unsubscribe_token,
        error: null,
      };
    }

    // 23505 means a concurrent submission created it first. That is the same
    // outcome this request wanted, so read the winner's row and continue.
    if (createError && createError.code !== "23505") {
      return { subscriberId: null, suppressed: false, unsubscribeToken: null, error: createError };
    }

    const { data: raced, error: reReadError } = await supabase
      .from("subscribers")
      .select(EXISTING_COLUMNS)
      .eq("email", email)
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    if (reReadError || !raced) {
      return {
        subscriberId: null,
        suppressed: false,
        unsubscribeToken: null,
        error: reReadError ?? createError,
      };
    }

    current = raced;
  }

  const updates: Record<string, unknown> = {};

  if (finalFirstName && !current.first_name) updates.first_name = finalFirstName;
  if (finalLastName && !current.last_name) updates.last_name = finalLastName;
  if (finalPhone && !current.phone) updates.phone = finalPhone;
  if ((finalPostalCode || finalUserPostal) && !current.postal_code) {
    updates.postal_code = finalPostalCode || finalUserPostal;
  }

  // Granting consent is recorded; the absence of a tick is not treated as
  // withdrawal.
  if (smsConsentGiven && !current.sms_consent) {
    updates.sms_consent = true;
    updates.sms_consented_at = new Date().toISOString();
  }

  // Coordinates only when there are none, matching the previous behaviour: a
  // stored location is likely more deliberate than an IP guess.
  if (finalLatitude != null && finalLongitude != null && current.latitude == null) {
    updates.latitude = finalLatitude;
    updates.longitude = finalLongitude;
  }

  if (Object.keys(updates).length > 0) {
    const { error: updateError } = await supabase
      .from("subscribers")
      .update(updates as TablesUpdate<"subscribers">)
      .eq("id", current.id);

    if (updateError) {
      // The signup itself succeeded; enriching it is best effort.
      logError(updateError, { route: "public.forms.submit.enrich", subscriberId: current.id });
    }
  }

  return {
    subscriberId: current.id,
    suppressed: current.suppressed === true,
    unsubscribeToken: current.unsubscribe_token,
    error: null,
  };
}

/**
 * Trigger subscriber_joined automations for this workspace.
 * Creates a log entry so the automation processor picks it up.
 */
async function triggerSubscriberJoined(
  supabase: ReturnType<typeof getSupabaseClient>,
  workspaceId: string,
  subscriberId: string,
  email: string,
  downloadUrl: string,
  widgetSlug: string
) {
  try {
    const { data: automations } = await supabase
      .from("automation_triggers")
      .select("id, action_config")
      .eq("workspace_id", workspaceId)
      .eq("trigger_type", "subscriber_joined")
      .eq("is_active", true);

    if (!automations || automations.length === 0) return;

    for (const automation of automations) {
      await supabase.from("automation_logs").insert({
        automation_id: automation.id,
        subscriber_id: subscriberId,
        // NOT NULL since migration 048.
        workspace_id: workspaceId,
        trigger_event: {
          email,
          subscriber_id: subscriberId,
          download_url: downloadUrl,
          widget_slug: widgetSlug,
          event: "subscriber_joined",
          timestamp: new Date().toISOString(),
        },
        status: "pending",
      });
    }
  } catch (error) {
    // Don't fail the submission if the automation trigger fails.
    logError(error, { route: "public.forms.submit.automation", workspaceId });
  }
}
