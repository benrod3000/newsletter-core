import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";
import { getAdminContextFromHeaders } from "@/lib/admin-context";

type Audience = "all" | "confirmed" | "pending";

function parseAudience(value: unknown): Audience {
  if (value === "all" || value === "pending") return value;
  return "confirmed";
}

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
      radius_unit: "km" as "km" | "mi",
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
  const radiusUnit: "km" | "mi" = input.radius_unit === "mi" ? "mi" : "km";
  const radiusValue =
    typeof input.radius_value === "number" && Number.isFinite(input.radius_value) && input.radius_value > 0
      ? input.radius_value
      : typeof input.radius_km === "number" && Number.isFinite(input.radius_km) && input.radius_km > 0
        ? radiusUnit === "mi"
          ? input.radius_km / 1.60934
          : input.radius_km
        : null;
  const radiusKm = radiusValue !== null ? (radiusUnit === "mi" ? radiusValue * 1.60934 : radiusValue) : null;

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

function haversineDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number) {
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

async function resolveClientId(inputClientId: unknown, adminClientId: string | null) {
  if (adminClientId) return adminClientId;
  if (typeof inputClientId === "string" && inputClientId.trim()) return inputClientId.trim();

  const supabase = getSupabaseClient();
  const { data } = await supabase.from("clients").select("id").eq("slug", "default").maybeSingle();

  return data?.id ?? null;
}

export async function POST(req: NextRequest) {
  const admin = getAdminContextFromHeaders(req.headers);
  if (!admin) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (admin.role !== "owner" && !admin.clientId) {
    return NextResponse.json({ error: "No workspace assigned for this account." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const audience = parseAudience(body.audience);
  const campaignId = typeof body.campaignId === "string" ? body.campaignId : null;
  let geoFilter = parseGeoFilter(body.geoFilter);

  const supabase = getSupabaseClient();
  let workspaceClientId = await resolveClientId(body.clientId, admin.clientId);
  if (!workspaceClientId) {
    return NextResponse.json({ error: "No workspace selected." }, { status: 422 });
  }

  if (campaignId) {
    let campaignQuery = supabase.from("campaigns").select("id, client_id, geo_filter").eq("id", campaignId).single();
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
      geoFilter = { ...campaignGeo, ...geoFilter };
    }
  }

  let query = supabase.from("subscribers").select("email, latitude, longitude").eq("client_id", workspaceClientId);

  if (audience === "confirmed") query = query.eq("confirmed", true);
  if (audience === "pending") query = query.eq("confirmed", false);
  if (geoFilter.country) query = query.eq("country", geoFilter.country);
  if (geoFilter.regions.length > 0) query = query.in("region", geoFilter.regions);
  if (geoFilter.cities.length > 0) query = query.in("city", geoFilter.cities);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: `Failed to load subscribers: ${error.message}` }, { status: 500 });
  }

  const rows = (data ?? []).filter((row) => typeof row.email === "string" && row.email.length > 0);

  const rowsWithCoords = rows.filter(
    (row) => typeof row.latitude === "number" && typeof row.longitude === "number"
  );

  const centerLat =
    geoFilter.center_lat ??
    (geoFilter.radius_km && rowsWithCoords.length
      ? rowsWithCoords.reduce((sum, row) => sum + Number(row.latitude), 0) / rowsWithCoords.length
      : null);
  const centerLng =
    geoFilter.center_lng ??
    (geoFilter.radius_km && rowsWithCoords.length
      ? rowsWithCoords.reduce((sum, row) => sum + Number(row.longitude), 0) / rowsWithCoords.length
      : null);

  const recipients =
    geoFilter.radius_km !== null && centerLat !== null && centerLng !== null
      ? rows.filter((row) => {
          if (typeof row.latitude !== "number" || typeof row.longitude !== "number") return false;
          return haversineDistanceKm(centerLat, centerLng, row.latitude, row.longitude) <= geoFilter.radius_km!;
        })
      : rows;

  return NextResponse.json({
    ok: true,
    count: recipients.length,
    baseCount: rows.length,
    excludedForMissingCoordinates:
      geoFilter.radius_km !== null ? rows.length - rowsWithCoords.length : 0,
  });
}
