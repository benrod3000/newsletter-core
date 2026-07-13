import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";

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
 * Public endpoint — accepts an email, adds the subscriber to the widget's
 * target list, records the submission, and fires a subscriber_joined
 * automation so a download email gets sent.
 *
 * Body: { email: string }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const supabase = getSupabaseClient();

  // Parse body
  let body: { email?: string };
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

  // Load widget config
  const { data: widget, error: widgetError } = await supabase
    .from("widgets")
    .select("id, workspace_id, list_id, download_url, is_active")
    .eq("slug", slug)
    .maybeSingle();

  if (widgetError || !widget) {
    console.error("Widget not found for slug:", slug, widgetError);
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
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const userAgent = req.headers.get("user-agent") || null;
  const referrer = req.headers.get("referer") || null;

  // Check if subscriber already exists for this workspace
  const { data: existingSub } = await supabase
    .from("subscribers")
    .select("id, unsubscribed, confirmed")
    .eq("email", email)
    .eq("client_id", workspaceId)
    .maybeSingle();

  let subscriberId: string;

  if (existingSub) {
    subscriberId = existingSub.id;

    // Re-subscribe if previously unsubscribed
    if (existingSub.unsubscribed) {
      await supabase
        .from("subscribers")
        .update({ unsubscribed: false, updated_at: new Date().toISOString() })
        .eq("id", subscriberId);
    }
  } else {
    // Create new subscriber
    const geoCountry = req.headers.get("x-vercel-ip-country") ?? null;
    const geoRegion = req.headers.get("x-vercel-ip-country-region") ?? null;
    const geoCity = req.headers.get("x-vercel-ip-city") ?? null;

    const { data: newSub, error: createError } = await supabase
      .from("subscribers")
      .insert({
        client_id: workspaceId,
        email,
        confirmed: true, // widget signups are single opt-in by default
        consent_email_marketing: true,
        consent_version: "widget-2026",
        consent_copy: "I agree to receive emails from this sender.",
        consent_timestamp: new Date().toISOString(),
        country: geoCountry,
        region: geoRegion,
        city: geoCity,
        source: `widget:${slug}`,
      })
      .select("id")
      .single();

    if (createError || !newSub) {
      console.error("Subscriber create error:", createError);
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
      await supabase
        .from("subscriber_list_memberships")
        .insert({
          subscriber_id: subscriberId,
          list_id: listId,
        });
    }
  }

  // Record the submission
  await supabase.from("widget_submissions").insert({
    widget_id: widget.id,
    subscriber_id: subscriberId,
    email,
    ip_address: ip,
    user_agent: userAgent,
    referrer: referrer,
  });

  // Fire subscriber_joined automation (send download email)
  await triggerSubscriberJoined(supabase, workspaceId, subscriberId, email, downloadUrl, slug);

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
