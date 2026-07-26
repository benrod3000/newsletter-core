import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";
import { logWarn } from "@/lib/logger";
import crypto from "crypto";

interface SendGridEvent {
  email: string;
  timestamp: number;
  event: string;
  sg_message_id?: string;
  campaign_id?: string;
  subscriber_id?: string;
  reason?: string;
  type?: string;
  url?: string;
}

interface ResolvedSubscriber {
  id: string;
  client_id: string;
}

/**
 * Identify the single subscriber row an event refers to.
 *
 * Suppression must never cross tenants. Since migration 024 the unique key is
 * (client_id, email), so one address can be a subscriber in several workspaces,
 * and a bounce in one says nothing about the others. Matching on the address
 * alone suppressed every workspace's copy at once — one tenant's stale list
 * silently stopped delivery for everyone else's engaged subscribers.
 *
 * Identity normally comes from the custom_args the transport attaches to each
 * send. Events that predate those, or arrive without them, fall back to the
 * address and are only acted on when it resolves to exactly one workspace;
 * ambiguous events are skipped rather than applied everywhere.
 */
async function resolveSubscriber(
  supabase: ReturnType<typeof getSupabaseClient>,
  event: SendGridEvent,
  email: string
): Promise<ResolvedSubscriber | null> {
  if (event.subscriber_id) {
    const { data } = await supabase
      .from("subscribers")
      .select("id, client_id")
      .eq("id", event.subscriber_id)
      .maybeSingle<ResolvedSubscriber>();
    if (data) return data;
  }

  if (event.campaign_id) {
    const { data: campaign } = await supabase
      .from("campaigns")
      .select("client_id")
      .eq("id", event.campaign_id)
      .maybeSingle<{ client_id: string }>();

    if (campaign?.client_id) {
      const { data } = await supabase
        .from("subscribers")
        .select("id, client_id")
        .eq("email", email)
        .eq("client_id", campaign.client_id)
        .maybeSingle<ResolvedSubscriber>();
      if (data) return data;
    }
  }

  // Address only: unambiguous exactly when it belongs to one workspace.
  const { data: matches } = await supabase
    .from("subscribers")
    .select("id, client_id")
    .eq("email", email)
    .limit(2)
    .returns<ResolvedSubscriber[]>();

  if (matches?.length === 1) return matches[0];
  return null;
}

export async function POST(req: NextRequest) {
  // Auth via header (preferred) or query param (legacy).
  // Configure SendGrid webhook to send header: x-webhook-secret: YOUR_SECRET
  const expectedSecret = process.env.SENDGRID_WEBHOOK_SECRET;
  if (!expectedSecret) {
    return NextResponse.json({ error: "Webhook not configured." }, { status: 500 });
  }

  const headerSecret = req.headers.get("x-webhook-secret");
  const { searchParams } = new URL(req.url);
  const querySecret = searchParams.get("secret");
  const providedSecret = headerSecret || querySecret;

  if (!providedSecret ||
      providedSecret.length !== expectedSecret.length ||
      !crypto.timingSafeEqual(Buffer.from(providedSecret), Buffer.from(expectedSecret))) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const supabase = getSupabaseClient();
  const events = body as SendGridEvent[];
  let processed = 0;

  for (const event of events) {
    const email = event.email?.toLowerCase().trim();
    if (!email) continue;

    const campaignId = event.campaign_id ?? null;
    const subscriberId = event.subscriber_id ?? null;
    const occurredAt = event.timestamp
      ? new Date(event.timestamp * 1000).toISOString()
      : new Date().toISOString();

    const subscriber = await resolveSubscriber(supabase, event, email);
    const resolvedSubscriberId = subscriber?.id ?? null;

    if (event.event === "bounce" || event.event === "spamreport") {
      const reason = event.event === "bounce" ? "bounce" : "complaint";

      // Suppress by row id, so this can only ever affect the one workspace the
      // event belongs to. An event we cannot attribute is left alone: sending
      // again to one bouncing address is recoverable, silently suppressing an
      // address across every tenant is not.
      if (subscriber) {
        await supabase
          .from("subscribers")
          .update({
            suppressed: true,
            suppressed_reason: reason,
            suppressed_at: occurredAt,
          })
          .eq("id", subscriber.id)
          .eq("suppressed", false);
      } else {
        logWarn("sendgrid-webhook: unattributable event, suppression skipped", {
          event: event.event,
          campaignId,
          hasSubscriberId: Boolean(subscriberId),
        });
      }

      // Record the event for reporting
      if (campaignId) {
        await supabase.from("campaign_events").insert({
          campaign_id: campaignId,
          subscriber_id: resolvedSubscriberId,
          email,
          event_type: reason === "bounce" ? "bounce" : "complaint",
          metadata: { reason: event.reason ?? null, type: event.type ?? null },
          occurred_at: occurredAt,
        });
      }

      processed++;
    } else if (event.event === "unsubscribe" && campaignId) {
      await supabase.from("campaign_events").insert({
        campaign_id: campaignId,
        subscriber_id: resolvedSubscriberId,
        email,
        event_type: "unsubscribe",
        occurred_at: occurredAt,
      });
      processed++;
    }
  }

  return NextResponse.json({ ok: true, processed });
}
