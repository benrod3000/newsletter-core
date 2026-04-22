import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";

// Minimal 1×1 transparent GIF
const TRANSPARENT_GIF = Buffer.from(
  "R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==",
  "base64"
);

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const campaignId = searchParams.get("c");
  const subscriberId = searchParams.get("s");

  if (campaignId && subscriberId) {
    try {
      const supabase = getSupabaseClient();

      const { data: subscriber } = await supabase
        .from("subscribers")
        .select("email")
        .eq("id", subscriberId)
        .single();

      if (subscriber?.email) {
        // Only record the first open per subscriber per campaign
        const { count } = await supabase
          .from("campaign_events")
          .select("id", { count: "exact", head: true })
          .eq("campaign_id", campaignId)
          .eq("subscriber_id", subscriberId)
          .eq("event_type", "open");

        if (!count || count === 0) {
          await supabase.from("campaign_events").insert({
            campaign_id: campaignId,
            subscriber_id: subscriberId,
            email: subscriber.email,
            event_type: "open",
          });
        }
      }
    } catch {
      // Tracking must never break the email client
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
