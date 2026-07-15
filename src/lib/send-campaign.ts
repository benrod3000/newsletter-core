import { getSupabaseClient } from "@/lib/supabase";
import { buildHtmlFromEditor, type MergeRecipient } from "@/lib/campaign-personalization";
import { checkSendingLimit } from "@/lib/sending-limits";
import { processSendQueue, type QueueRecipient } from "@/lib/send-queue";

export type Audience = "all" | "confirmed" | "pending" | "claimed_offer" | string;

export type RecipientRow = MergeRecipient & {
  confirmed: boolean;
  client_id: string | null;
  latitude: number | null;
  longitude: number | null;
};

export type GeoFilter = {
  country: string | null;
  regions: string[];
  cities: string[];
  center_lat: number | null;
  center_lng: number | null;
  radius_km: number | null;
  radius_value: number | null;
  radius_unit: "km" | "mi";
};

export function parseGeoFilter(value: unknown): GeoFilter {
  if (!value || typeof value !== "object") {
    return {
      country: null, regions: [], cities: [],
      center_lat: null, center_lng: null,
      radius_km: null, radius_value: null, radius_unit: "mi",
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
        ? radiusUnit === "mi" ? input.radius_km / 1.60934 : input.radius_km
        : null;
  const radiusKm =
    radiusValue !== null
      ? radiusUnit === "mi" ? radiusValue * 1.60934 : radiusValue
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

export function haversineDistanceKm(
  lat1: number, lon1: number, lat2: number, lon2: number
): number {
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

export function getBaseUrl(req: { headers: Headers }): string {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL;
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
  return `${proto}://${host}`;
}

export function injectTracking(
  html: string,
  campaignId: string,
  subscriberId: string,
  baseUrl: string
): string {
  let result = html.replace(/href="(https?:\/\/[^"]+)"/gi, (_, url: string) => {
    if (url.includes("/api/track/")) return `href="${url}"`;
    return `href="${baseUrl}/api/track/click?c=${encodeURIComponent(campaignId)}&s=${encodeURIComponent(subscriberId)}&u=${encodeURIComponent(url)}"`;
  });

  const pixel = `<img src="${baseUrl}/api/track/open?c=${encodeURIComponent(campaignId)}&s=${encodeURIComponent(subscriberId)}" width="1" height="1" style="display:none" alt="">`;
  if (result.includes("</body>")) {
    result = result.replace("</body>", `${pixel}</body>`);
  } else {
    result += pixel;
  }
  return result;
}

async function fetchClaimedLeadMagnetIds(
  supabase: ReturnType<typeof getSupabaseClient>,
  subscriberIds: string[]
): Promise<Set<string>> {
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

/**
 * Look up the workspace's configured sending provider.
 * Falls back to the platform's shared SendGrid key if the workspace
 * hasn't configured their own SES credentials.
 */
async function getWorkspaceSender(
  supabase: ReturnType<typeof getSupabaseClient>,
  workspaceId: string
): Promise<{ fromEmail: string; fromName: string; sgApiKey: string }> {
  const { data: client } = await supabase
    .from("clients")
    .select("email_provider, ses_access_key, ses_secret_key, ses_region, ses_from_email, sender_email, sender_name")
    .eq("id", workspaceId)
    .maybeSingle();

  const provider = client?.email_provider || "sendgrid";
  const fromEmail = client?.sender_email || client?.ses_from_email || process.env.SENDGRID_FROM_EMAIL || "noreply@veloce.app";
  const fromName = client?.sender_name || "Veloce";

  // Use SES key if workspace configured it, otherwise platform SendGrid
  const sgApiKey = provider === "ses" && client?.ses_access_key
    ? process.env.SENDGRID_API_KEY || "" // Still need SG for now; SES support is routed through email-sender.ts
    : process.env.SENDGRID_API_KEY || "";

  return { fromEmail, fromName, sgApiKey };
}

export interface SendCampaignBlastParams {
  workspaceId: string;
  subject: string;
  message: string;
  messageHtml: string;
  messageCss: string;
  audience: Audience;
  geoFilter: GeoFilter;
  campaignId: string | null;
  baseUrl: string;
}

export interface SendCampaignBlastResult {
  sentCount: number;
}

/**
 * Consolidated campaign send function.
 * Used by both the cron (campaigns/process) and the admin blast tool (admin/send).
 */
export async function sendCampaignBlast(
  params: SendCampaignBlastParams
): Promise<SendCampaignBlastResult> {
  const supabase = getSupabaseClient();
  const { sgApiKey, fromEmail, fromName } = await getWorkspaceSender(supabase, params.workspaceId);

  if (!sgApiKey) {
    throw new Error("Missing SENDGRID_API_KEY.");
  }

  const { workspaceId, subject, message, messageHtml, messageCss, audience, geoFilter, campaignId, baseUrl } = params;

  // Build recipient query
  let query = supabase
    .from("subscribers")
    .select("id, email, confirmed, client_id, country, region, city, latitude, longitude, unsubscribe_token, first_name, last_name, date_of_birth, phone_number")
    .eq("suppressed", false)
    .eq("client_id", workspaceId);

  if (audience === "confirmed") query = query.eq("confirmed", true);
  if (audience === "pending") query = query.eq("confirmed", false);
  if (geoFilter.country) query = query.eq("country", geoFilter.country);
  if (geoFilter.regions.length > 0) query = query.in("region", geoFilter.regions);
  if (geoFilter.cities.length > 0) query = query.in("city", geoFilter.cities);

  const { data, error } = await query;
  if (error) {
    throw new Error(`Failed to load subscribers: ${error.message}`);
  }

  let rows = ((data ?? []) as RecipientRow[]).filter(
    (row) => typeof row.email === "string" && row.email.length > 0
  );

  // List-based audience filter
  if (audience.startsWith("list:")) {
    const listId = audience.slice(5);
    const { data: listMembers, error: listError } = await supabase
      .from("subscriber_list_memberships")
      .select("subscriber_id")
      .eq("list_id", listId);

    if (listError) {
      throw new Error(`Failed to load list members: ${listError.message}`);
    }

    const listMemberIds = new Set((listMembers ?? []).map((m) => m.subscriber_id));
    rows = rows.filter((row) => listMemberIds.has(row.id));
  }

  // Audience filter
  const audienceRows =
    audience === "claimed_offer"
      ? rows.filter((row) => row.confirmed)
      : rows;

  const claimedLeadMagnetIds =
    audience === "claimed_offer"
      ? await fetchClaimedLeadMagnetIds(supabase, audienceRows.map((row) => row.id))
      : null;

  const filteredAudienceRows =
    audience === "claimed_offer"
      ? audienceRows.filter((row) => claimedLeadMagnetIds?.has(row.id))
      : audienceRows;

  // Radius filter
  const hasRadiusFilter =
    geoFilter.radius_km !== null && geoFilter.center_lat !== null && geoFilter.center_lng !== null;
  const centerLat = geoFilter.center_lat;
  const centerLng = geoFilter.center_lng;
  const radiusKm = geoFilter.radius_km;

  const geoRecipients =
    hasRadiusFilter && centerLat !== null && centerLng !== null && radiusKm !== null
      ? filteredAudienceRows.filter((row) => {
          if (typeof row.latitude !== "number" || typeof row.longitude !== "number") return false;
          return haversineDistanceKm(centerLat, centerLng, row.latitude, row.longitude) <= radiusKm;
        })
      : filteredAudienceRows;

  if (geoRecipients.length === 0) {
    return { sentCount: 0 };
  }

  const baseHtml = messageHtml
    ? buildHtmlFromEditor(messageHtml, messageCss)
    : buildHtmlFromEditor(message.replace(/\n/g, "<br>"));

  // Check sending limits before proceeding
  await checkSendingLimit(supabase, workspaceId, geoRecipients.length);

  // Send via the queue system for reliability + audit trail
  const recipients: QueueRecipient[] = geoRecipients.map((r) => ({
    id: r.id,
    email: r.email,
    unsubscribe_token: r.unsubscribe_token,
    country: r.country,
    region: r.region,
    city: r.city,
    first_name: r.first_name,
    last_name: r.last_name,
    date_of_birth: r.date_of_birth,
    phone_number: r.phone_number,
  }));

  const { sentCount } = await processSendQueue({
    workspaceId,
    campaignId: campaignId || "",
    subject,
    message,
    messageHtml,
    messageCss,
    baseUrl,
    fromEmail,
    fromName,
    sgApiKey,
    recipients,
  });

  return { sentCount };
}
