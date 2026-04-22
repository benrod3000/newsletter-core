import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const campaignId = searchParams.get("c");
  const subscriberId = searchParams.get("s");
  const rawUrl = searchParams.get("u");

  // Validate destination URL — only allow http/https
  let destination = "/";
  if (rawUrl) {
    try {
      const decoded = decodeURIComponent(rawUrl);
      const parsed = new URL(decoded);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        destination = decoded;
      }
    } catch {
      // bad URL — fall through to "/"
    }
  }

  if (campaignId && subscriberId) {
    try {
      const supabase = getSupabaseClient();

      const { data: subscriber } = await supabase
        .from("subscribers")
        .select("email")
        .eq("id", subscriberId)
        .single();

      if (subscriber?.email) {
        await supabase.from("campaign_events").insert({
          campaign_id: campaignId,
          subscriber_id: subscriberId,
          email: subscriber.email,
          event_type: "click",
          url: destination,
        });
      }
    } catch {
      // Tracking must never break the redirect
    }
  }

  return NextResponse.redirect(destination, { status: 302 });
}
