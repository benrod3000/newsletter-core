import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";
import { geolocateIP } from "@/lib/geo";
import { applyRateLimit, rateLimitedResponse } from "@/lib/rate-limit-middleware";
import { getClientIp } from "@/lib/client-ip";
import { getBaseUrl } from "@/lib/geo-utils";
import { sendConfirmationEmail } from "@/lib/email/confirmation-email";
import type { SignupSnapshot } from "@/lib/email/confirmation-email";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const CONSENT_VERSION = "2026-04-22";
const CONSENT_COPY = "I agree to receive marketing emails, email performance tracking, and location-based audience analytics as described in the privacy notice.";

// Handle preflight requests
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

// Durable rate limit: max 3 attempts per IP per hour (stored in DB)
async function isRateLimited(ip: string): Promise<boolean> {
  if (!ip || ip === "unknown") return false;

  const supabase = getSupabaseClient();
  const windowStart = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const maxAttempts = 3;

  const { count, error } = await supabase
    .from("subscribe_attempts")
    .select("id", { count: "exact", head: true })
    .eq("ip", ip)
    .gte("created_at", windowStart);

  if (error) {
    console.error("[subscribe] Rate-limit check error:", error.message);
    return false;
  }

  return (count ?? 0) >= maxAttempts;
}

async function logSubscribeAttempt(ip: string, email: string) {
  if (!ip || ip === "unknown") return;

  const supabase = getSupabaseClient();
  const { error } = await supabase.from("subscribe_attempts").insert([{ ip, email }]);

  if (error) {
    console.error("[subscribe] Rate-limit log error:", error.message);
  }
}

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

function cleanText(value: unknown, maxLength = 200): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

function cleanDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  const date = new Date(`${trimmed}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  return trimmed;
}

function cleanPhone(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace(/[^0-9+().\-\s]/g, "").slice(0, 32).trim();
  return normalized || null;
}

function cleanUrl(value: unknown, maxLength = 500): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > maxLength) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

async function resolveWorkspaceForSignup(supabase: ReturnType<typeof getSupabaseClient>, clientSlug: string | null) {
  // Require an explicit workspace slug - no default fallback
  if (!clientSlug) return null;

  // `name` is read so the confirmation email can say what was signed up to.
  const { data } = await supabase
    .from("clients")
    .select("id, name")
    .eq("slug", clientSlug)
    .maybeSingle();

  return data ?? null;
}

export async function POST(req: NextRequest) {
  // Public, unauthenticated, and writes rows - cap it before doing any work.
  // 5/min per IP is well above human signup rate and far below scripted abuse.
  const rl = await applyRateLimit(req, { max: 5, windowSec: 60, keyPrefix: "subscribe" });
  if (!rl.allowed) return rateLimitedResponse(rl);

  try {
    // 1. Parse body
    const body = await req.json().catch(() => null);
    if (!body || typeof body.email !== "string") {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400, headers: CORS_HEADERS });
    }

    // Honeypot: if this hidden field is filled, silently accept and drop.
    if (typeof body.company === "string" && body.company.trim().length > 0) {
      return NextResponse.json({ ok: true }, { status: 200, headers: CORS_HEADERS });
    }

    const email = body.email.trim().toLowerCase();
    const timezone = cleanText(body.timezone, 100);
    const locale = cleanText(body.locale, 50);
    const utm_source = cleanText(body.utm_source, 120);
    const utm_medium = cleanText(body.utm_medium, 120);
    const utm_campaign = cleanText(body.utm_campaign, 160);
    const referrer = cleanText(body.referrer, 500);
    const landing_path = cleanText(body.landing_path, 300);
    const client_slug = cleanText(body.client_slug, 80);
    const first_name = cleanText(body.first_name, 80);
    const last_name = cleanText(body.last_name, 80);
    const date_of_birth = cleanDate(body.date_of_birth);
    const phone_number = cleanPhone(body.phone_number);
    const lead_title = cleanText(body.lead_title, 120);
    const lead_url = cleanUrl(body.lead_url, 500);
    const consent_email_marketing = body.consent_email_marketing === true;
    const consent_analytics_tracking = body.consent_analytics_tracking === true;
    // Browser geolocation (optional, client-provided)
    const browser_latitude = parseCoordinate(body.browser_latitude);
    const browser_longitude = parseCoordinate(body.browser_longitude);

    if (!consent_email_marketing || !consent_analytics_tracking) {
      return NextResponse.json(
        { error: "Marketing and analytics consent are required before signup." },
        { status: 422, headers: CORS_HEADERS }
      );
    }
    // 2. Validate email
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "Invalid email address." }, { status: 422, headers: CORS_HEADERS });
    }

    // 3. Get IP
    const ip = getClientIp(req);

    // 4. Rate limit
    if (await isRateLimited(ip)) {
      return NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429, headers: CORS_HEADERS });
    }

    await logSubscribeAttempt(ip, email);

    // 5. User-Agent (raw)
    const user_agent = req.headers.get("user-agent") ?? null;

    // 6. Geo lookup (ip-api.com + Vercel headers + browser geolocation override)
    const ipGeo = await geolocateIP(ip);
    const geo = getGeoData(req);
    // Priority: browser GPS > ip-api.com postal/lat/lng > Vercel headers region/city
    const finalLatitude = browser_latitude ?? ipGeo?.latitude ?? geo.latitude;
    const finalLongitude = browser_longitude ?? ipGeo?.longitude ?? geo.longitude;
    const finalPostalCode = ipGeo?.postal_code ?? null;
    const geoCountry = ipGeo?.country ?? geo.country;
    const geoRegion = ipGeo?.region ?? geo.region;
    const geoCity = ipGeo?.city ?? geo.city;

    const snapshot: SignupSnapshot = {
      firstName: first_name,
      lastName: last_name,
      dateOfBirth: date_of_birth,
      phoneNumber: phone_number,
      country: geo.country,
      region: geo.region,
      city: geo.city,
      timezone,
      locale,
      utmSource: utm_source,
      utmMedium: utm_medium,
      utmCampaign: utm_campaign,
      referrer,
      landingPath: landing_path,
    };

    // 7. Insert into Supabase, returning tokens for the email
    const supabase = getSupabaseClient();
    const workspace = await resolveWorkspaceForSignup(supabase, client_slug);

    if (!workspace) {
      return NextResponse.json(
        { error: "Invalid or missing workspace identifier." },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    const workspace_id = workspace.id;

    const { data: subscriber, error: dbError } = await supabase
      .from("subscribers")
      .insert([
        {
          workspace_id,
          email,
          ip,
          country: geoCountry,
          region: geoRegion,
          city: geoCity,
          latitude: finalLatitude,
          longitude: finalLongitude,
          postal_code: finalPostalCode,
          user_agent,
          timezone,
          locale,
          utm_source,
          utm_medium,
          utm_campaign,
          referrer,
          landing_path,
          first_name,
          last_name,
          date_of_birth,
          phone_number,
          consent_email_marketing,
          consent_analytics_tracking,
          consented_at: new Date().toISOString(),
          consent_version: CONSENT_VERSION,
          consent_text: CONSENT_COPY,
          consent_source: landing_path,
          created_at: new Date().toISOString(),
        },
      ])
      .select("confirmation_token, unsubscribe_token")
      .single();

    if (dbError) {
      if (dbError.code === "23505") {
        // Scoped to this workspace. The unique key is (workspace_id, email) since
        // migration 024, so the same address legitimately exists in several
        // workspaces - an unscoped lookup here returned another workspace's
        // confirmation and unsubscribe tokens and mailed them to the subscriber.
        const { data: existing, error: existingError } = await supabase
          .from("subscribers")
          .select("confirmed, confirmation_token, unsubscribe_token")
          .eq("email", email)
          .eq("workspace_id", workspace_id)
          .maybeSingle();

        if (existingError || !existing) {
          console.error("[subscribe] Duplicate lookup error:", existingError?.message);
          return NextResponse.json({ ok: true }, { status: 200, headers: CORS_HEADERS });
        }

        if (existing.confirmed) {
          return NextResponse.json({ ok: true, alreadyConfirmed: true }, { status: 200, headers: CORS_HEADERS });
        }

        await supabase
          .from("subscribers")
          .update({
            consent_email_marketing,
            consent_analytics_tracking,
            consented_at: new Date().toISOString(),
            consent_version: CONSENT_VERSION,
            consent_text: CONSENT_COPY,
            consent_source: landing_path,
          })
          .eq("email", email)
          .eq("workspace_id", workspace_id);

        const resendResult = await sendConfirmationEmail({
          email,
          confirmationToken: existing.confirmation_token,
          unsubscribeToken: existing.unsubscribe_token,
          baseUrl: getBaseUrl(req),
          leadTitle: lead_title,
          leadUrl: lead_url,
          snapshot,
          audienceName: workspace.name,
        });

        if (!resendResult.sent) {
          return NextResponse.json(
            {
              ok: true,
              emailSent: false,
              warning: "We saved your signup, but could not send the confirmation email right now.",
              reason: resendResult.reason,
            },
            { status: 202, headers: CORS_HEADERS }
          );
        }

        return NextResponse.json({ ok: true, emailSent: true, resent: true }, { status: 200, headers: CORS_HEADERS });
      }
      console.error("[subscribe] Supabase error:", dbError.message);
      return NextResponse.json({ error: "Could not save subscription. Please try again." }, { status: 500, headers: CORS_HEADERS });
    }

    if (!subscriber) {
      return NextResponse.json({ error: "Could not save subscription. Please try again." }, { status: 500, headers: CORS_HEADERS });
    }

    const emailResult = await sendConfirmationEmail({
      email,
      confirmationToken: subscriber.confirmation_token,
      unsubscribeToken: subscriber.unsubscribe_token,
      baseUrl: getBaseUrl(req),
      leadTitle: lead_title,
      leadUrl: lead_url,
      snapshot,
      audienceName: workspace.name,
    });

    if (!emailResult.sent) {
      return NextResponse.json(
        {
          ok: true,
          emailSent: false,
          warning: "We saved your signup, but could not send the confirmation email right now.",
          reason: emailResult.reason,
        },
        { status: 202, headers: CORS_HEADERS }
      );
    }

    return NextResponse.json({ ok: true, emailSent: true }, { status: 201, headers: CORS_HEADERS });
  } catch (err) {
    console.error("[subscribe] Unexpected error:", err);
    return NextResponse.json({ error: "Internal server error." }, { status: 500, headers: CORS_HEADERS });
  }
}
