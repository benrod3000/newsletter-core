import { NextRequest, NextResponse } from "next/server";
import sgMail from "@sendgrid/mail";
import { getSupabaseClient } from "@/lib/supabase";
import { canSendCampaigns, getAdminContextFromHeaders } from "@/lib/admin-context";

type Audience = "all" | "confirmed" | "pending";

function parseGeoFilter(value: unknown) {
  if (!value || typeof value !== "object") {
    return {
      country: null,
      region: null,
      city: null,
      center_lat: null,
      center_lng: null,
      radius_km: null,
    };
  }

  const input = value as Record<string, unknown>;
  const clean = (v: unknown) => {
    if (typeof v !== "string") return null;
    const trimmed = v.trim();
    return trimmed ? trimmed : null;
  };

  return {
    country: clean(input.country),
    region: clean(input.region),
    city: clean(input.city),
    center_lat: typeof input.center_lat === "number" ? input.center_lat : null,
    center_lng: typeof input.center_lng === "number" ? input.center_lng : null,
    radius_km:
      typeof input.radius_km === "number" && Number.isFinite(input.radius_km) && input.radius_km > 0
        ? input.radius_km
        : null,
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

export async function POST(req: NextRequest) {
  const admin = getAdminContextFromHeaders(req.headers);
  if (!admin) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (!canSendCampaigns(admin)) return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  if (admin.role !== "owner" && !admin.clientId) {
    return NextResponse.json({ error: "No workspace assigned for this account." }, { status: 403 });
  }

  const sgApiKey = process.env.SENDGRID_API_KEY;
  const fromEmail = process.env.SENDGRID_FROM_EMAIL;
  if (!sgApiKey || !fromEmail) {
    return NextResponse.json({ error: "Missing SENDGRID_API_KEY or SENDGRID_FROM_EMAIL." }, { status: 500 });
  }

  const supabase = getSupabaseClient();
  const nowIso = new Date().toISOString();

  let dueQuery = supabase
    .from("campaigns")
    .select("id, client_id, subject, audience, geo_filter, editor_html, editor_css, plain_text")
    .eq("status", "scheduled")
    .lte("scheduled_for", nowIso);

  if (admin.role !== "owner" && admin.clientId) {
    dueQuery = dueQuery.eq("client_id", admin.clientId);
  }

  const { data: dueCampaigns, error: dueError } = await dueQuery;
  if (dueError) {
    return NextResponse.json({ error: `Failed to load scheduled campaigns: ${dueError.message}` }, { status: 500 });
  }

  if (!dueCampaigns || dueCampaigns.length === 0) {
    return NextResponse.json({ ok: true, processed: 0, sent: 0 });
  }

  sgMail.setApiKey(sgApiKey);

  let sent = 0;

  for (const campaign of dueCampaigns) {
    const audience = (campaign.audience as Audience) ?? "confirmed";
    const geoFilter = parseGeoFilter(campaign.geo_filter);
    let recipientQuery = supabase
      .from("subscribers")
      .select("email, latitude, longitude")
      .eq("client_id", campaign.client_id);
    if (audience === "confirmed") recipientQuery = recipientQuery.eq("confirmed", true);
    if (audience === "pending") recipientQuery = recipientQuery.eq("confirmed", false);
    if (geoFilter.country) recipientQuery = recipientQuery.eq("country", geoFilter.country);
    if (geoFilter.region) recipientQuery = recipientQuery.eq("region", geoFilter.region);
    if (geoFilter.city) recipientQuery = recipientQuery.eq("city", geoFilter.city);

    const { data: recipientsData, error: recipientsError } = await recipientQuery;
    if (recipientsError) {
      await supabase
        .from("campaigns")
        .update({ last_error: recipientsError.message, updated_by: admin.username })
        .eq("id", campaign.id);
      continue;
    }

    const rows = (recipientsData ?? []).filter(
      (r) => typeof r.email === "string" && r.email.length > 0
    );

    const hasRadiusFilter =
      geoFilter.radius_km !== null && geoFilter.center_lat !== null && geoFilter.center_lng !== null;
    const centerLat = geoFilter.center_lat;
    const centerLng = geoFilter.center_lng;
    const radiusKm = geoFilter.radius_km;

    const recipients =
      hasRadiusFilter && centerLat !== null && centerLng !== null && radiusKm !== null
        ? rows
            .filter((r) => {
              if (typeof r.latitude !== "number" || typeof r.longitude !== "number") return false;
              return (
                haversineDistanceKm(
                  centerLat,
                  centerLng,
                  r.latitude,
                  r.longitude
                ) <= radiusKm
              );
            })
            .map((r) => r.email)
        : rows.map((r) => r.email);

    if (recipients.length === 0) {
      await supabase
        .from("campaigns")
        .update({
          status: "sent",
          sent_count: 0,
          last_sent_at: nowIso,
          last_error: null,
          updated_by: admin.username,
        })
        .eq("id", campaign.id);
      continue;
    }

    const html = buildHtmlFromEditor(campaign.editor_html ?? "", campaign.editor_css ?? "");
    const text = campaign.plain_text || "Newsletter update.";

    try {
      for (const to of recipients) {
        await sgMail.send({
          to,
          from: fromEmail,
          subject: campaign.subject,
          text,
          html,
        });
      }

      sent += recipients.length;

      await supabase
        .from("campaigns")
        .update({
          status: "sent",
          sent_count: recipients.length,
          last_sent_at: nowIso,
          last_error: null,
          updated_by: admin.username,
        })
        .eq("id", campaign.id);
    } catch (err) {
      await supabase
        .from("campaigns")
        .update({
          last_error: err instanceof Error ? err.message : "Send failed",
          updated_by: admin.username,
        })
        .eq("id", campaign.id);
    }
  }

  return NextResponse.json({ ok: true, processed: dueCampaigns.length, sent });
}
