import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";
import { rateLimit } from "@/lib/rate-limit";

function parseCoordinate(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getGeoData(req: NextRequest): {
  country: string | null;
  region: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
} {
  return {
    country: req.headers.get("x-vercel-ip-country") ?? null,
    region: req.headers.get("x-vercel-ip-country-region") ?? null,
    city: req.headers.get("x-vercel-ip-city") ?? null,
    latitude: parseCoordinate(req.headers.get("x-vercel-ip-latitude")),
    longitude: parseCoordinate(req.headers.get("x-vercel-ip-longitude")),
  };
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const campaignId = searchParams.get("c");
  const subscriberId = searchParams.get("s");
  const rawUrl = searchParams.get("u");

  // Rate limit: 50 clicks per IP per second
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const rl = await rateLimit(`track-click:${ip}`, 50, 50);
  let destination = "/";
  if (!rl.allowed) {
    // Still redirect — just don't record the event
    if (rawUrl) {
      try { destination = decodeURIComponent(rawUrl); new URL(destination); } catch { destination = "/"; }
    }
    return NextResponse.redirect(destination, { status: 302 });
  }

  const trackingKind = searchParams.get("kind") || null;
  const leadTitle = searchParams.get("title") || null;
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

  if (subscriberId) {
    try {
      const supabase = getSupabaseClient();
      const geo = getGeoData(req);

      const { data: subscriber } = await supabase
        .from("subscribers")
        .select("email")
        .eq("id", subscriberId)
        .single();

      if (subscriber?.email) {
        if (geo.country || geo.region || geo.city || geo.latitude !== null || geo.longitude !== null) {
          await supabase
            .from("subscribers")
            .update({
              country: geo.country,
              region: geo.region,
              city: geo.city,
              latitude: geo.latitude,
              longitude: geo.longitude,
            })
            .eq("id", subscriberId);
        }

        await supabase.from("campaign_events").insert({
          campaign_id: campaignId,
          subscriber_id: subscriberId,
          email: subscriber.email,
          event_type: "click",
          url: destination,
          metadata: {
            tracking_kind: trackingKind,
            lead_title: leadTitle,
            country: geo.country,
            region: geo.region,
            city: geo.city,
            latitude: geo.latitude,
            longitude: geo.longitude,
          },
        });
      }
    } catch (err) {
      console.error('[track/click] Failed to record click:', err instanceof Error ? err.message : err);
    }
  }

  return NextResponse.redirect(destination, { status: 302 });
}
