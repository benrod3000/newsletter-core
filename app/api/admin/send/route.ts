import { NextRequest, NextResponse } from "next/server";
import sgMail from "@sendgrid/mail";
import { getSupabaseClient } from "@/lib/supabase";
import { canSendCampaigns, getAdminContextFromHeaders } from "@/lib/admin-context";

type Audience = "all" | "confirmed" | "pending" | "claimed_offer";

type RecipientRow = {
  id: string;
  email: string;
  confirmed: boolean;
  client_id: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  unsubscribe_token: string;
  first_name: string | null;
  last_name: string | null;
  date_of_birth: string | null;
  phone_number: string | null;
};

function parseGeoFilter(value: unknown) {
  if (!value || typeof value !== "object") {
    return {
      country: null,
      regions: [] as string[],
      cities: [] as string[],
      center_lat: null,
      center_lng: null,
      radius_km: null,
      radius_value: null,
      radius_unit: "mi" as "km" | "mi",
    };
  }

  const input = value as Record<string, unknown>;
  const clean = (v: unknown) => {
    if (typeof v !== "string") return null;
    const trimmed = v.trim();
    return trimmed ? trimmed : null;
  };

  const cleanList = (v: unknown) => {
    if (!Array.isArray(v)) return [] as string[];
    const cleaned = v
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean);
    return Array.from(new Set(cleaned));
  };

  const legacyRegion = clean(input.region);
  const legacyCity = clean(input.city);
  const regions = cleanList(input.regions);
  const cities = cleanList(input.cities);
  const radiusUnit: "km" | "mi" = input.radius_unit === "km" ? "km" : "mi";
  const radiusValue =
    typeof input.radius_value === "number" && Number.isFinite(input.radius_value) && input.radius_value > 0
      ? input.radius_value
      : typeof input.radius_km === "number" && Number.isFinite(input.radius_km) && input.radius_km > 0
        ? radiusUnit === "mi"
          ? input.radius_km / 1.60934
          : input.radius_km
        : null;
  const radiusKm =
    radiusValue !== null
      ? radiusUnit === "mi"
        ? radiusValue * 1.60934
        : radiusValue
      : null;

  return {
    country: clean(input.country),
    regions: regions.length ? regions : legacyRegion ? [legacyRegion] : [],
    cities: cities.length ? cities : legacyCity ? [legacyCity] : [],
    center_lat: typeof input.center_lat === "number" ? input.center_lat : null,
    center_lng: typeof input.center_lng === "number" ? input.center_lng : null,
    radius_km: radiusKm,
    radius_value: radiusValue,
    radius_unit: radiusUnit,
  };
}

function haversineDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
) {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function buildHtml(message: string) {
  const escaped = message
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="background:#0d0d0d;font-family:sans-serif;margin:0;padding:40px 24px;">
  <table style="max-width:640px;margin:0 auto;width:100%;">
    <tr><td>
      <p style="color:#fbbf24;font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;margin:0 0 16px;">
        Newsletter Services
      </p>
      <div style="color:#e4e4e7;font-size:15px;line-height:1.7;white-space:normal;">
        ${escaped}
      </div>
      <hr style="border:none;border-top:1px solid #27272a;margin:32px 0;">
      <p style="color:#71717a;font-size:12px;line-height:1.5;margin:0;">
        You are receiving this email because you subscribed to the newsletter.
      </p>
    </td></tr>
  </table>
</body>
</html>`;
}

function getBaseUrl(req: NextRequest): string {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL;
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
  return `${proto}://${host}`;
}

function injectTracking(
  html: string,
  campaignId: string,
  subscriberId: string,
  baseUrl: string
): string {
  // Rewrite external links for click tracking
  let result = html.replace(/href="(https?:\/\/[^"]+)"/gi, (_, url: string) => {
    if (url.includes("/api/track/")) return `href="${url}"`;
    return `href="${baseUrl}/api/track/click?c=${encodeURIComponent(campaignId)}&s=${encodeURIComponent(subscriberId)}&u=${encodeURIComponent(url)}"`;
  });

  // Inject open-tracking pixel
  const pixel = `<img src="${baseUrl}/api/track/open?c=${encodeURIComponent(campaignId)}&s=${encodeURIComponent(subscriberId)}" width="1" height="1" style="display:none" alt="">`;
  if (result.includes("</body>")) {
    result = result.replace("</body>", `${pixel}</body>`);
  } else {
    result += pixel;
  }
  return result;
}

function buildHtmlFromEditor(editorHtml: string, editorCss = "") {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  ${editorCss ? `<style>${editorCss}</style>` : ""}
</head>
<body style="background:#0d0d0d;font-family:sans-serif;margin:0;padding:40px 24px;">
  <table style="max-width:640px;margin:0 auto;width:100%;">
    <tr><td>
      <p style="color:#fbbf24;font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;margin:0 0 16px;">
        Newsletter Services
      </p>
      <div style="color:#e4e4e7;font-size:15px;line-height:1.7;white-space:normal;">
        ${editorHtml}
      </div>
      <hr style="border:none;border-top:1px solid #27272a;margin:32px 0;">
      <p style="color:#71717a;font-size:12px;line-height:1.5;margin:0;">
        You are receiving this email because you subscribed to the newsletter.
      </p>
    </td></tr>
  </table>
</body>
</html>`;
}

function parseAudience(value: unknown): Audience {
  if (value === "all" || value === "pending" || value === "claimed_offer") return value;
  return "confirmed";
}

async function fetchClaimedLeadMagnetIds(
  supabase: ReturnType<typeof getSupabaseClient>,
  subscriberIds: string[]
) {
  if (subscriberIds.length === 0) return new Set<string>();

  const { data, error } = await supabase
    .from("campaign_events")
    .select("subscriber_id, metadata")
    .eq("event_type", "click")
    .in("subscriber_id", subscriberIds);

  if (error) {
    throw new Error(`Failed to load claimed-offer events: ${error.message}`);
  }

  return new Set(
    (data ?? [])
      .filter((event) => event.subscriber_id && event.metadata?.tracking_kind === "lead_magnet")
      .map((event) => event.subscriber_id as string)
  );
}

function formatBirthdayPretty(value: string | null): string {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function renderTemplate(template: string, data: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-z0-9_]+)(?:\s*\|\s*([^}]+))?\s*\}\}/gi, (full, key: string, fallbackRaw?: string) => {
    const value = data[key.toLowerCase()];
    if (typeof value === "string" && value.length > 0) return value;

    const fallback = typeof fallbackRaw === "string" ? fallbackRaw.trim() : "";
    if (fallback.length > 0) return fallback;

    return "";
  });
}

function mergeDataForRecipient(sub: RecipientRow, unsubUrl: string): Record<string, string> {
  const firstName = (sub.first_name ?? "").trim();
  const lastName = (sub.last_name ?? "").trim();
  const fullName = [firstName, lastName].filter(Boolean).join(" ");
  const dateOfBirth = sub.date_of_birth ?? "";
  const location = [sub.city, sub.region, sub.country].filter(Boolean).join(", ");

  return {
    first_name: firstName,
    last_name: lastName,
    full_name: fullName,
    date_of_birth: dateOfBirth,
    birthday_pretty: formatBirthdayPretty(dateOfBirth),
    phone_number: (sub.phone_number ?? "").trim(),
    city: (sub.city ?? "").trim(),
    region: (sub.region ?? "").trim(),
    country: (sub.country ?? "").trim(),
    location: location,
    email: sub.email,
    unsubscribe_url: unsubUrl,
  };
}

export async function POST(req: NextRequest) {
  const admin = getAdminContextFromHeaders(req.headers);
  if (!admin) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (!canSendCampaigns(admin)) return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  if (admin.role !== "owner" && !admin.clientId) {
    return NextResponse.json({ error: "No workspace assigned for this account." }, { status: 403 });
  }

  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body.subject !== "string" || typeof body.message !== "string") {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }

    const subject = body.subject.trim();
    const message = body.message.trim();
    const messageHtml = typeof body.html === "string" ? body.html.trim() : "";
    const messageCss = typeof body.css === "string" ? body.css.trim() : "";
    const audience = parseAudience(body.audience);
    const geoFilter = parseGeoFilter(body.geoFilter);
    const testEmail = typeof body.testEmail === "string" ? body.testEmail.trim().toLowerCase() : "";
    const campaignId = typeof body.campaignId === "string" ? body.campaignId : null;

    if (!subject || !message) {
      return NextResponse.json({ error: "Subject and message are required." }, { status: 422 });
    }

    const sgApiKey = process.env.SENDGRID_API_KEY;
    const fromEmail = process.env.SENDGRID_FROM_EMAIL;
    if (!sgApiKey || !fromEmail) {
      return NextResponse.json(
        { error: "Missing SENDGRID_API_KEY or SENDGRID_FROM_EMAIL." },
        { status: 500 }
      );
    }

    const supabase = getSupabaseClient();
    let workspaceClientId = admin.clientId;

    if (campaignId) {
      let campaignQuery = supabase
        .from("campaigns")
        .select("id, client_id, geo_filter")
        .eq("id", campaignId)
        .single();

      if (admin.role !== "owner" && admin.clientId) {
        campaignQuery = supabase
          .from("campaigns")
          .select("id, client_id, geo_filter")
          .eq("id", campaignId)
          .eq("client_id", admin.clientId)
          .single();
      }

      const { data: campaignScope, error: campaignScopeError } = await campaignQuery;
      if (campaignScopeError || !campaignScope) {
        return NextResponse.json({ error: "Campaign not found or not accessible." }, { status: 404 });
      }

      workspaceClientId = campaignScope.client_id;
      if (campaignScope.geo_filter && typeof campaignScope.geo_filter === "object") {
        const campaignGeo = parseGeoFilter(campaignScope.geo_filter);
        geoFilter.country = campaignGeo.country;
        geoFilter.regions = campaignGeo.regions;
        geoFilter.cities = campaignGeo.cities;
        geoFilter.center_lat = campaignGeo.center_lat;
        geoFilter.center_lng = campaignGeo.center_lng;
        geoFilter.radius_km = campaignGeo.radius_km;
        geoFilter.radius_value = campaignGeo.radius_value;
        geoFilter.radius_unit = campaignGeo.radius_unit;
      }
    }

    let query = supabase
      .from("subscribers")
      .select("id, email, confirmed, client_id, country, region, city, latitude, longitude, unsubscribe_token, first_name, last_name, date_of_birth, phone_number")
      .eq("suppressed", false);

    if (audience === "confirmed") query = query.eq("confirmed", true);
    if (audience === "pending") query = query.eq("confirmed", false);
    if (workspaceClientId) query = query.eq("client_id", workspaceClientId);
    if (geoFilter.country) query = query.eq("country", geoFilter.country);
    if (geoFilter.regions.length > 0) query = query.in("region", geoFilter.regions);
    if (geoFilter.cities.length > 0) query = query.in("city", geoFilter.cities);

    sgMail.setApiKey(sgApiKey);
    const baseUrl = getBaseUrl(req);
    const baseHtml = messageHtml ? buildHtmlFromEditor(messageHtml, messageCss) : buildHtml(message);

    if (testEmail) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(testEmail)) {
        return NextResponse.json({ error: "Invalid test email address." }, { status: 422 });
      }

      const sampleUnsubUrl = `${baseUrl}/unsubscribe?token=test-token`;
      const sampleData = {
        first_name: "Friend",
        last_name: "",
        full_name: "Friend",
        date_of_birth: "1990-06-10",
        birthday_pretty: "June 10",
        phone_number: "",
        email: testEmail,
        unsubscribe_url: sampleUnsubUrl,
      };

      const testSubject = renderTemplate(subject, sampleData);
      const testText = renderTemplate(message, sampleData);
      const testHtml = renderTemplate(baseHtml, sampleData);

      await sgMail.send({
        to: testEmail,
        from: fromEmail,
        subject: `[TEST] ${testSubject}`,
        text: testText,
        html: testHtml,
      });

      if (campaignId) {
        let campaignUpdate = supabase
          .from("campaigns")
          .update({
            last_test_sent_at: new Date().toISOString(),
            last_test_recipient: testEmail,
            updated_by: admin.username,
          })
          .eq("id", campaignId);

        if (admin.role !== "owner" && admin.clientId) {
          campaignUpdate = campaignUpdate.eq("client_id", admin.clientId);
        }

        await campaignUpdate;
      }

      return NextResponse.json({ ok: true, testSent: true, sentCount: 1 });
    }

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ error: `Failed to load subscribers: ${error.message}` }, { status: 500 });
    }

    const rows = ((data ?? []) as RecipientRow[]).filter(
      (row) => typeof row.email === "string" && row.email.length > 0
    );

    const audienceRows =
      audience === "claimed_offer"
        ? rows.filter((row) => row.confirmed)
        : rows;

    const claimedLeadMagnetIds =
      audience === "claimed_offer"
        ? await fetchClaimedLeadMagnetIds(
            supabase,
            audienceRows.map((row) => row.id)
          )
        : null;

    const filteredAudienceRows =
      audience === "claimed_offer"
        ? audienceRows.filter((row) => claimedLeadMagnetIds?.has(row.id))
        : audienceRows;

    const hasRadiusFilter =
      geoFilter.radius_km !== null && geoFilter.center_lat !== null && geoFilter.center_lng !== null;
    const centerLat = geoFilter.center_lat;
    const centerLng = geoFilter.center_lng;
    const radiusKm = geoFilter.radius_km;

    const geoRecipients =
      hasRadiusFilter && centerLat !== null && centerLng !== null && radiusKm !== null
        ? filteredAudienceRows.filter((row) => {
            if (typeof row.latitude !== "number" || typeof row.longitude !== "number") {
              return false;
            }
            return (
              haversineDistanceKm(
                centerLat,
                centerLng,
                row.latitude,
                row.longitude
              ) <= radiusKm
            );
          })
        : filteredAudienceRows;

    if (geoRecipients.length === 0) {
      return NextResponse.json({ error: "No matching subscribers to send to." }, { status: 422 });
    }

    // Send individually per subscriber for per-recipient personalization (tracking + unsubscribe link)
    const BATCH = 20;
    for (let i = 0; i < geoRecipients.length; i += BATCH) {
      const batch = geoRecipients.slice(i, i + BATCH);
      await Promise.all(
        batch.map(async (sub) => {
          const unsubUrl = `${baseUrl}/unsubscribe?token=${sub.unsubscribe_token}`;
          const unsubApiUrl = `${baseUrl}/api/unsubscribe?token=${sub.unsubscribe_token}`;
          const mergeData = mergeDataForRecipient(sub, unsubUrl);
          const personalSubject = renderTemplate(subject, mergeData);
          const personalText = renderTemplate(message, mergeData);
          let personalHtml = renderTemplate(baseHtml, mergeData);
          if (campaignId) {
            personalHtml = injectTracking(personalHtml, campaignId, sub.id, baseUrl);
          }
          await sgMail.send({
            to: sub.email,
            from: fromEmail,
            subject: personalSubject,
            text: personalText,
            html: personalHtml,
            headers: {
              "List-Unsubscribe": `<${unsubApiUrl}>, <mailto:${fromEmail}?subject=unsubscribe>`,
              "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
            },
            ...(campaignId && {
              customArgs: { campaign_id: campaignId, subscriber_id: sub.id },
            }),
          });
        })
      );
    }

    if (campaignId) {
      const nowIso = new Date().toISOString();

      let campaignUpdate = supabase
        .from("campaigns")
        .update({
          status: "sent",
          sent_count: geoRecipients.length,
          last_sent_at: nowIso,
          last_error: null,
          updated_by: admin.username,
        })
        .eq("id", campaignId);

      if (admin.role !== "owner" && admin.clientId) {
        campaignUpdate = campaignUpdate.eq("client_id", admin.clientId);
      }

      await campaignUpdate;
    }

    return NextResponse.json({ ok: true, sentCount: geoRecipients.length });
  } catch (err) {
    console.error("[admin/send] Unexpected error:", err);
    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }
}
