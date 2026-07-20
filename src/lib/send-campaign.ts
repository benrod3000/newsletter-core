import { getSupabaseClient } from "@/lib/supabase";
import { buildHtmlFromEditor, type MergeRecipient } from "@/lib/campaign-personalization";
import { checkSendingLimit } from "@/lib/sending-limits";
import { processSendQueue, type QueueRecipient } from "@/lib/send-queue";
import { parseGeoFilter, haversineDistanceKm, getBaseUrl, type GeoFilter } from "@/lib/geo-utils";

export type Audience = "all" | "confirmed" | "pending" | "claimed_offer" | string;

export type RecipientRow = MergeRecipient & {
  confirmed: boolean;
  client_id: string | null;
  latitude: number | null;
  longitude: number | null;
};

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
 * Look up the workspace's configured sending provider and build dispatch config.
 */
async function getWorkspaceSender(
  supabase: ReturnType<typeof getSupabaseClient>,
  workspaceId: string
): Promise<{ fromEmail: string; fromName: string; dispatchConfig: ReturnType<typeof import("./email/dispatcher").DispatchConfig> }> {
  const { data: client } = await supabase
    .from("clients")
    .select("email_provider, fallback_provider, sandbox_mode, ses_access_key, ses_secret_key, ses_region, ses_from_email, sender_email, sender_name, sendgrid_api_key, resend_api_key")
    .eq("id", workspaceId)
    .maybeSingle();

  const fromEmail = client?.sender_email || client?.ses_from_email || process.env.SENDGRID_FROM_EMAIL || "noreply@veloce.app";
  const fromName = client?.sender_name || "Veloce";

  const dispatchConfig = {
    provider: client?.email_provider || "sendgrid",
    fallbackProvider: client?.fallback_provider || undefined,
    sandbox: client?.sandbox_mode === true,
    credentials: {
      sendgrid: client?.sendgrid_api_key || process.env.SENDGRID_API_KEY,
      resend: client?.resend_api_key || process.env.RESEND_API_KEY,
    },
  };

  return { fromEmail, fromName, dispatchConfig };
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
  const { fromEmail, fromName, dispatchConfig } = await getWorkspaceSender(supabase, workspaceId);

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
    dispatchConfig,
    recipients,
  });

  return { sentCount };
}
