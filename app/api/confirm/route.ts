import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";

type ConfirmSubscriber = {
  id: string;
  confirmed: boolean;
  city: string | null;
  region: string | null;
  country: string | null;
  timezone: string | null;
  locale: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  landing_path: string | null;
  referrer: string | null;
};

function appendTrackingParams(leadUrl: string | null, subscriber: ConfirmSubscriber | null): string | null {
  if (!leadUrl || !subscriber) return leadUrl;

  try {
    const trackedUrl = new URL(leadUrl);

    const trackingEntries: Array<[string, string | null]> = [
      ["newsletter_source", "confirmed_download"],
      ["subscriber_city", subscriber.city],
      ["subscriber_region", subscriber.region],
      ["subscriber_country", subscriber.country],
      ["subscriber_timezone", subscriber.timezone],
      ["subscriber_locale", subscriber.locale],
      ["signup_utm_source", subscriber.utm_source],
      ["signup_utm_medium", subscriber.utm_medium],
      ["signup_utm_campaign", subscriber.utm_campaign],
      ["signup_landing_path", subscriber.landing_path],
      ["signup_referrer", subscriber.referrer],
    ];

    for (const [key, value] of trackingEntries) {
      if (!value) continue;
      trackedUrl.searchParams.set(key, value);
    }

    return trackedUrl.toString();
  } catch {
    return leadUrl;
  }
}

function buildTrackedLeadUrl(req: NextRequest, leadUrl: string | null, leadTitle: string | null, subscriber: ConfirmSubscriber | null): string | null {
  if (!leadUrl || !subscriber) return leadUrl;

  const destinationUrl = appendTrackingParams(leadUrl, subscriber);
  if (!destinationUrl) return null;

  const trackedUrl = new URL("/api/track/click", req.url);
  trackedUrl.searchParams.set("s", subscriber.id);
  trackedUrl.searchParams.set("u", encodeURIComponent(destinationUrl));
  trackedUrl.searchParams.set("kind", "lead_magnet");
  if (leadTitle) trackedUrl.searchParams.set("title", leadTitle);
  return trackedUrl.toString();
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  const leadTitle = req.nextUrl.searchParams.get("lead_title")?.trim() || null;
  const leadUrlRaw = req.nextUrl.searchParams.get("lead_url")?.trim() || null;

  let leadUrl: string | null = null;
  if (leadUrlRaw) {
    try {
      const parsed = new URL(leadUrlRaw);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        leadUrl = parsed.toString();
      }
    } catch {
      leadUrl = null;
    }
  }

  const buildRedirect = (status: string, subscriber: ConfirmSubscriber | null = null) => {
    const url = new URL(`/confirmed?status=${status}`, req.url);
    if (leadTitle) url.searchParams.set("lead_title", leadTitle);
    const trackedLeadUrl = buildTrackedLeadUrl(req, leadUrl, leadTitle, subscriber);
    if (trackedLeadUrl) url.searchParams.set("lead_url", trackedLeadUrl);
    return url;
  };

  if (!token || !/^[0-9a-f-]{36}$/.test(token)) {
    return NextResponse.redirect(buildRedirect("invalid"));
  }

  const supabase = getSupabaseClient();
  const { data: existing, error: lookupError } = await supabase
    .from("subscribers")
    .select("id, confirmed, city, region, country, timezone, locale, utm_source, utm_medium, utm_campaign, landing_path, referrer")
    .eq("confirmation_token", token)
    .maybeSingle<ConfirmSubscriber>();

  if (lookupError) {
    console.error("[confirm] Supabase lookup error:", lookupError.message);
    return NextResponse.redirect(buildRedirect("error"));
  }

  if (!existing) {
    return NextResponse.redirect(buildRedirect("invalid"));
  }

  if (existing.confirmed) {
    return NextResponse.redirect(buildRedirect("already", existing));
  }

  const { error } = await supabase
    .from("subscribers")
    .update({ confirmed: true })
    .eq("id", existing.id);

  if (error) {
    console.error("[confirm] Supabase error:", error.message);
    return NextResponse.redirect(buildRedirect("error"));
  }

  return NextResponse.redirect(buildRedirect("ok", existing));
}
