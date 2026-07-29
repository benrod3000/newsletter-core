import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";
import { geolocateIP } from "@/lib/geo";
import { rateLimit } from "@/lib/rate-limit";
import { isDisposableEmail } from "@/lib/disposable-emails";
import { verifyTurnstileToken } from "@/lib/turnstile";
import { logError } from "@/lib/logger";
import { getClientIp } from "@/lib/client-ip";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * POST /api/public/forms/[slug]/submit
 * Public endpoint - accepts an email, adds the subscriber to the widget's
 * target list, records the submission, and fires a subscriber_joined
 * automation so a download email gets sent.
 *
 * Body: {
 *   email: string,
 *   first_name?: string,
 *   browser_latitude?: number,
 *   browser_longitude?: number,
 * }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const supabase = getSupabaseClient();

  // Rate limit: 10 submissions per minute per IP
  const ip = getClientIp(req);
  const { allowed, retryAfter } = await rateLimit(`widget-submit:${ip}`, 10, 10 / 60);
  if (!allowed) {
    return NextResponse.json(
      { error: "Too many submissions. Please try again later." },
      { status: 429, headers: { "Retry-After": String(retryAfter), "Access-Control-Allow-Origin": "*" } }
    );
  }

  // Parse body
  let body: { email?: string; first_name?: string; last_name?: string; phone?: string; sms_consent?: boolean; postal_code?: string; browser_latitude?: number; browser_longitude?: number; turnstile_token?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  const email = body.email?.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json(
      { error: "Please enter a valid email address." },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  // Bot protection: verify Turnstile token if provided (widget forms may embed it)
  if (body.turnstile_token && !(await verifyTurnstileToken(body.turnstile_token))) {
    return NextResponse.json(
      { error: "Security check failed. Please try again." },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  // Block disposable email addresses
  if (isDisposableEmail(email)) {
    return NextResponse.json(
      { error: "Disposable email addresses are not allowed." },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  // Load widget config
  const { data: widget, error: widgetError } = await supabase
    .from("widgets")
    .select("id, workspace_id, list_id, download_url, is_active")
    .eq("slug", slug)
    .maybeSingle();

  if (widgetError || !widget) {
    logError(new Error("Widget not found"), { slug, detail: widgetError });
    return NextResponse.json(
      { error: "Form not found" },
      { status: 404, headers: CORS_HEADERS }
    );
  }

  if (!widget.is_active) {
    return NextResponse.json(
      { error: "This form is no longer accepting submissions." },
      { status: 410, headers: CORS_HEADERS }
    );
  }

  const { workspace_id: workspaceId, list_id: listId, download_url: downloadUrl } = widget;

  // Collect metadata
  const userAgent = req.headers.get("user-agent") || null;
  const referrer = req.headers.get("referer") || null;

  // Resolve location - browser GPS overrides IP lookup
  const ipGeo = await geolocateIP(ip);
  const finalLatitude = body.browser_latitude ?? ipGeo?.latitude ?? null;
  const finalLongitude = body.browser_longitude ?? ipGeo?.longitude ?? null;
  const finalPostalCode = ipGeo?.postal_code ?? null;
  const finalFirstName = body.first_name?.trim().slice(0, 80) || null;
  const finalLastName = body.last_name?.trim().slice(0, 80) || null;
  const finalPhone = body.phone?.trim().slice(0, 20) || null;
  const finalUserPostal = body.postal_code?.trim().slice(0, 20) || null;

  // Check if subscriber already exists for this workspace
  const { data: existingSub } = await supabase
    .from("subscribers")
    .select("id, confirmed")
    .eq("email", email)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  let subscriberId: string;

  if (existingSub) {
    subscriberId = existingSub.id;

    // Update geo data if we have new coordinates
    if (finalLatitude != null && finalLongitude != null) {
      await supabase
        .from("subscribers")
        .update({ latitude: finalLatitude, longitude: finalLongitude, postal_code: finalPostalCode })
        .eq("id", subscriberId)
        .is("latitude", null);
    }
  } else {
    // Create new subscriber
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
        sms_consent: body.sms_consent === true,
        sms_consented_at: body.sms_consent ? new Date().toISOString() : null,
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
      .select("id")
      .single();

    if (createError || !newSub) {
      logError(new Error("Subscriber create error"), { detail: createError });
      return NextResponse.json(
        { error: "Failed to register. Please try again." },
        { status: 500, headers: CORS_HEADERS }
      );
    }

    subscriberId = newSub.id;
  }

  // Add to target list
  if (listId) {
    const { data: existingMembership } = await supabase
      .from("subscriber_list_memberships")
      .select("id")
      .eq("subscriber_id", subscriberId)
      .eq("list_id", listId)
      .maybeSingle();

    if (!existingMembership) {
      const { error } = await supabase
        .from("subscriber_list_memberships")
        .insert({
          subscriber_id: subscriberId,
          list_id: listId,
          // NOT NULL since migration 048.
          workspace_id: workspaceId,
        });

      if (error) {
        console.error("[forms/submit] Failed to add list membership:", error.message);
      }
    }
  }

  // Record the submission
  const { error: submissionError } = await supabase.from("widget_submissions").insert({
    widget_id: widget.id,
    subscriber_id: subscriberId,
    // NOT NULL since migration 048.
    workspace_id: workspaceId,
    email,
    ip_address: ip,
    user_agent: userAgent,
    referrer: referrer,
    latitude: finalLatitude,
    longitude: finalLongitude,
    postal_code: finalPostalCode,
  });

  if (submissionError) {
    console.error("[forms/submit] Failed to record submission:", submissionError.message);
  }

  // Fire subscriber_joined automation (send download email)
  await triggerSubscriberJoined(supabase, workspaceId, subscriberId, email, downloadUrl, slug);

  // Track submission event
  fetch(`${process.env.SUPABASE_URL}/rest/v1/widget_events`, {
    method: 'POST',
    headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ widget_id: widget.id, workspace_id: workspaceId, event_type: 'submission', subscriber_id: subscriberId, occurred_at: new Date().toISOString() }),
  }).catch(() => {});

  return NextResponse.json(
    { ok: true },
    { status: 200, headers: CORS_HEADERS }
  );
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
    // Find active subscriber_joined automations for this workspace
    const { data: automations } = await supabase
      .from("automation_triggers")
      .select("id, action_config")
      .eq("workspace_id", workspaceId)
      .eq("trigger_type", "subscriber_joined")
      .eq("is_active", true);

    if (!automations || automations.length === 0) return;

    for (const automation of automations) {
      // Inject the download URL into the automation event payload
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
    // Don't fail the submission if automation trigger fails
    console.error("Automation trigger error (non-fatal):", error);
  }
}
