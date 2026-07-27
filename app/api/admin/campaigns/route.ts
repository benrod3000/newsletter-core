import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";
import { canEditCampaigns, getAdminContextFromHeaders } from "@/lib/admin-context";
import { parseGeoFilter } from "@/lib/geo-utils";

type CampaignStatus = "draft" | "scheduled" | "sent";
type Audience = "all" | "confirmed" | "pending" | "claimed_offer";

async function resolveGeoCenter(
  clientId: string,
  geoFilter: {
    country: string | null;
    regions: string[];
    cities: string[];
    center_lat: number | null;
    center_lng: number | null;
    radius_km: number | null;
    radius_value: number | null;
    radius_unit: "km" | "mi";
  }
) {
  if (!geoFilter.radius_km) {
    return geoFilter;
  }

  if (geoFilter.center_lat !== null && geoFilter.center_lng !== null) {
    return geoFilter;
  }

  const supabase = getSupabaseClient();
  let query = supabase
    .from("subscribers")
    .select("latitude, longitude")
    .eq("workspace_id", clientId)
    .not("latitude", "is", null)
    .not("longitude", "is", null)
    .limit(200);

  if (geoFilter.country) query = query.eq("country", geoFilter.country);
  if (geoFilter.regions.length > 0) query = query.in("region", geoFilter.regions);
  if (geoFilter.cities.length > 0) query = query.in("city", geoFilter.cities);

  const { data } = await query;
  if (!data || data.length === 0) {
    return { ...geoFilter, center_lat: null, center_lng: null };
  }

  const latSum = data.reduce((sum, row) => sum + Number(row.latitude), 0);
  const lngSum = data.reduce((sum, row) => sum + Number(row.longitude), 0);

  return {
    ...geoFilter,
    center_lat: latSum / data.length,
    center_lng: lngSum / data.length,
  };
}

function parseAudience(value: unknown): Audience {
  if (value === "all" || value === "pending" || value === "claimed_offer") return value;
  return "confirmed";
}

function parseStatus(value: unknown): CampaignStatus {
  if (value === "scheduled" || value === "sent") return value;
  return "draft";
}

async function resolveClientId(inputClientId: unknown, adminClientId: string | null) {
  if (adminClientId) return adminClientId;
  if (typeof inputClientId === "string" && inputClientId.trim()) return inputClientId.trim();

  const supabase = getSupabaseClient();
  const { data } = await supabase
    .from("clients")
    .select("id")
    .eq("slug", "default")
    .maybeSingle();

  return data?.id ?? null;
}

export async function GET(req: NextRequest) {
  const admin = getAdminContextFromHeaders(req.headers);
  if (!admin) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (admin.role !== "owner" && !admin.clientId) {
    return NextResponse.json({ error: "No workspace assigned for this account." }, { status: 403 });
  }

  const supabase = getSupabaseClient();
  let campaignsQuery = supabase
    .from("campaigns")
    .select("id, workspace_id, title, subject, audience, status, editor_html, editor_css, plain_text, scheduled_for, sent_count, last_sent_at, last_test_sent_at, last_test_recipient, geo_filter, updated_at")
    .order("updated_at", { ascending: false });

  if (admin.role !== "owner" && admin.clientId) {
    campaignsQuery = campaignsQuery.eq("workspace_id", admin.clientId);
  }

  const { data: campaigns, error } = await campaignsQuery;
  if (error) {
    return NextResponse.json({ error: `Failed to load campaigns: ${error.message}` }, { status: 500 });
  }

  const campaignsData = campaigns ?? [];

  const campaignIds = campaignsData.map((campaign) => campaign.id);
  const statsByCampaign = new Map<string, { opens: number; clicks: number; openRate: number; clickRate: number }>();

  if (campaignIds.length > 0) {
    const { data: events, error: eventsError } = await supabase
      .from("campaign_events")
      .select("campaign_id, event_type, email")
      .in("campaign_id", campaignIds);

    if (eventsError) {
      return NextResponse.json({ error: `Failed to load campaign stats: ${eventsError.message}` }, { status: 500 });
    }

    const grouped = new Map<string, { opens: Set<string>; clicks: Set<string> }>();
    for (const event of events ?? []) {
      if (!event.campaign_id || !event.email) continue;
      const current = grouped.get(event.campaign_id) ?? { opens: new Set<string>(), clicks: new Set<string>() };
      if (event.event_type === "open") current.opens.add(event.email);
      if (event.event_type === "click") current.clicks.add(event.email);
      grouped.set(event.campaign_id, current);
    }

    for (const [campaignId, values] of grouped.entries()) {
      const campaign = campaignsData.find((item) => item.id === campaignId);
      const sentCount = campaign?.sent_count ?? 0;
      statsByCampaign.set(campaignId, {
        opens: values.opens.size,
        clicks: values.clicks.size,
        openRate: sentCount > 0 ? Math.round((values.opens.size / sentCount) * 100) : 0,
        clickRate: sentCount > 0 ? Math.round((values.clicks.size / sentCount) * 100) : 0,
      });
    }
  }

  const campaignsWithStats = campaignsData.map((campaign) => ({
    ...campaign,
    stats: statsByCampaign.get(campaign.id) ?? { opens: 0, clicks: 0, openRate: 0, clickRate: 0 },
  }));

  const clientsQuery = admin.role === "owner"
    ? supabase.from("clients").select("id, name, slug").order("name", { ascending: true })
    : supabase.from("clients").select("id, name, slug").eq("id", admin.clientId ?? "").limit(1);

  const { data: clients, error: clientsError } = await clientsQuery;
  if (clientsError) {
    return NextResponse.json({ error: `Failed to load clients: ${clientsError.message}` }, { status: 500 });
  }

  return NextResponse.json({
    campaigns: campaignsWithStats,
    clients: clients ?? [],
    admin,
  });
}

export async function POST(req: NextRequest) {
  const admin = getAdminContextFromHeaders(req.headers);
  if (!admin) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (!canEditCampaigns(admin)) return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  if (admin.role !== "owner" && !admin.clientId) {
    return NextResponse.json({ error: "No workspace assigned for this account." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body.subject !== "string" || typeof body.editorHtml !== "string") {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const supabase = getSupabaseClient();
  const id = typeof body.id === "string" ? body.id : null;
  const title = typeof body.title === "string" && body.title.trim() ? body.title.trim() : "Untitled Draft";
  const subject = body.subject.trim();
  const audience = parseAudience(body.audience);
  const status = parseStatus(body.status);
  const editorHtml = body.editorHtml.trim();
  const editorCss = typeof body.editorCss === "string" ? body.editorCss : "";
  const plainText = typeof body.plainText === "string" ? body.plainText : "";
  const scheduledFor = typeof body.scheduledFor === "string" && body.scheduledFor.trim() ? body.scheduledFor : null;
  let geoFilter = parseGeoFilter(body.geoFilter);

  if (!subject || !editorHtml) {
    return NextResponse.json({ error: "Subject and content are required." }, { status: 422 });
  }

  if (status === "scheduled" && !scheduledFor) {
    return NextResponse.json({ error: "Scheduled campaigns require a schedule date/time." }, { status: 422 });
  }

  const clientId = await resolveClientId(body.clientId, admin.clientId);
  if (!clientId) {
    return NextResponse.json({ error: "No workspace selected for this campaign." }, { status: 422 });
  }

  geoFilter = await resolveGeoCenter(clientId, geoFilter);

  if (geoFilter.radius_km && (geoFilter.center_lat === null || geoFilter.center_lng === null)) {
    return NextResponse.json(
      { error: "Could not determine geo center for radius targeting. Select a location with matching subscribers first." },
      { status: 422 }
    );
  }

  const payload = {
    workspace_id: clientId,
    title,
    subject,
    audience,
    status,
    editor_html: editorHtml,
    editor_css: editorCss,
    plain_text: plainText,
    geo_filter: geoFilter,
    scheduled_for: status === "scheduled" ? scheduledFor : null,
    updated_by: admin.username,
    created_by: admin.username,
  };

  if (id) {
    let update = supabase.from("campaigns").update(payload).eq("id", id).select("*").single();
    if (admin.role !== "owner" && admin.clientId) {
      update = supabase
        .from("campaigns")
        .update(payload)
        .eq("id", id)
        .eq("workspace_id", admin.clientId)
        .select("*")
        .single();
    }

    const { data, error } = await update;
    if (error) {
      return NextResponse.json({ error: `Failed to update campaign: ${error.message}` }, { status: 500 });
    }

    return NextResponse.json({ campaign: data });
  }

  const { data, error } = await supabase
    .from("campaigns")
    .insert([{ ...payload, created_by: admin.username }])
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: `Failed to create campaign: ${error.message}` }, { status: 500 });
  }

  return NextResponse.json({ campaign: data }, { status: 201 });
}
