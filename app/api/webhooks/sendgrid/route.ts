import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";

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

export async function POST(req: NextRequest) {
  // Auth via secret query param — set SENDGRID_WEBHOOK_SECRET in your env vars
  // and configure the webhook URL as: https://yourdomain.com/api/webhooks/sendgrid?secret=YOUR_SECRET
  const { searchParams } = new URL(req.url);
  const secret = searchParams.get("secret");
  const expectedSecret = process.env.SENDGRID_WEBHOOK_SECRET;

  if (!expectedSecret || secret !== expectedSecret) {
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

    // Resolve subscriber
    const { data: subscriber } = subscriberId
      ? await supabase.from("subscribers").select("id").eq("id", subscriberId).single()
      : await supabase.from("subscribers").select("id").eq("email", email).maybeSingle();

    const resolvedSubscriberId = subscriber?.id ?? null;

    if (event.event === "bounce" || event.event === "spamreport") {
      const reason = event.event === "bounce" ? "bounce" : "complaint";

      // Suppress the subscriber so they won't be sent to again
      await supabase
        .from("subscribers")
        .update({
          suppressed: true,
          suppressed_reason: reason,
          suppressed_at: occurredAt,
        })
        .eq("email", email)
        .eq("suppressed", false);

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
