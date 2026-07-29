import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";
import { rateLimit } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/client-ip";

// Minimal 1×1 transparent GIF
const TRANSPARENT_GIF = Buffer.from(
  "R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==",
  "base64"
);

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const campaignId = searchParams.get("c");
  const subscriberId = searchParams.get("s");

  // Rate limit: 100 tracking pixels per IP per second (high volume, bursty)
  const ip = getClientIp(req);
  const rl = await rateLimit(`track-open:${ip}`, 100, 100);
  if (!rl.allowed) {
    return new NextResponse(TRANSPARENT_GIF, { status: 200, headers: { "Content-Type": "image/gif" } });
  }

  if (campaignId && subscriberId) {
    try {
      const supabase = getSupabaseClient();

      // workspace_id comes off the subscriber row: this endpoint is public and
      // has no session to derive a workspace from, and campaign_events.workspace_id
      // is NOT NULL as of migration 048.
      const { data: subscriber } = await supabase
        .from("subscribers")
        .select("email, workspace_id")
        .eq("id", subscriberId)
        .single();

      if (subscriber?.email && subscriber.workspace_id) {
        // Only record the first open per subscriber per campaign
        const { count } = await supabase
          .from("campaign_events")
          .select("id", { count: "exact", head: true })
          .eq("campaign_id", campaignId)
          .eq("subscriber_id", subscriberId)
          .eq("event_type", "open");

        if (!count || count === 0) {
          const { error } = await supabase.from("campaign_events").insert({
            campaign_id: campaignId,
            subscriber_id: subscriberId,
            workspace_id: subscriber.workspace_id,
            email: subscriber.email,
            event_type: "open",
          });

          // supabase-js resolves errors rather than throwing, so the catch below
          // never sees them. Without this check a failed insert leaves opens
          // silently unrecorded and analytics reading zero.
          if (error) {
            console.error("[track/open] Failed to record open:", error.message);
          }
        }
      }
    } catch (err) {
      console.error('[track/open] Failed to record open:', err instanceof Error ? err.message : err);
    }
  }

  return new NextResponse(TRANSPARENT_GIF, {
    status: 200,
    headers: {
      "Content-Type": "image/gif",
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      Pragma: "no-cache",
    },
  });
}
