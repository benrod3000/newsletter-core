import { getSupabaseClient } from "./supabase";
import type { Tables } from "./database.types";

/**
 * Radius targeting across more than one area.
 *
 * The picker has always allowed several areas - it draws a chip and a circle per
 * area and says "Targeting 2 areas" - while every consumer read `locations[0]`
 * and discarded the rest. That is not a missing feature so much as a wrong
 * answer: selecting Oceanside at 10mi and Encinitas at 100mi queried Oceanside
 * alone, which contains nobody, so the contacts page reported 0 of 10,310 and
 * offered to help import some. The area holding the eight matches was on screen,
 * in a chip, ignored.
 *
 * Areas are a union, which is what drawing two circles means. `nearby_subscribers`
 * takes one centre, so it is called per area and the results are merged by id.
 * First occurrence wins, so ordering follows the order the areas were added and
 * is stable across pages.
 */

export interface GeoArea {
  lat: number;
  lng: number;
  /** Kilometres, because that is what nearby_subscribers takes. */
  radiusKm: number;
}

const MILES_TO_KM = 1.609344;

/** Areas are capped so a pathological URL cannot fan out into unbounded RPC calls. */
const MAX_AREAS = 25;

/**
 * Read areas from a query string, accepting both shapes.
 *
 * `areas=lat,lng,radiusMiles;lat,lng,radiusMiles` is the multi-area form.
 * `near_lat` / `near_lng` / `radius` is the original single-area form, still
 * used by saved filters and by campaign geo_filter, so it keeps working.
 *
 * Returns an empty array when neither is present, which callers read as "no geo
 * filter" rather than "an area matching nothing".
 */
export function parseGeoAreas(params: URLSearchParams): GeoArea[] {
  const raw = params.get("areas");

  if (raw) {
    const areas: GeoArea[] = [];
    for (const chunk of raw.split(";")) {
      if (!chunk.trim()) continue;
      const [lat, lng, miles] = chunk.split(",").map((v) => parseFloat(v));
      // A malformed area is skipped rather than defaulted. Silently querying
      // (0, 0) or a 10-mile fallback would return a confidently wrong set.
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      if (Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
      const radiusMiles = Number.isFinite(miles) && miles > 0 ? miles : 10;
      areas.push({ lat, lng, radiusKm: radiusMiles * MILES_TO_KM });
      if (areas.length >= MAX_AREAS) break;
    }
    return areas;
  }

  const nearLat = params.get("near_lat");
  const nearLng = params.get("near_lng");
  if (!nearLat || !nearLng) return [];

  const lat = parseFloat(nearLat);
  const lng = parseFloat(nearLng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];

  const miles = parseFloat(params.get("radius") || "10");
  return [{ lat, lng, radiusKm: (Number.isFinite(miles) && miles > 0 ? miles : 10) * MILES_TO_KM }];
}

/**
 * Every subscriber inside any of the areas, deduplicated.
 *
 * Runs as service-role because nearby_subscribers is a SECURITY DEFINER function
 * taking the workspace as an argument; the caller has already been authorised by
 * withWorkspace and passes its own ctx.workspaceId, never a client-supplied one.
 */
export async function fetchSubscribersInAreas(
  workspaceId: string,
  areas: GeoArea[]
): Promise<Tables<"subscribers">[]> {
  const supabase = getSupabaseClient();
  const byId = new Map<string, Tables<"subscribers">>();

  for (const area of areas) {
    const { data, error } = await supabase.rpc("nearby_subscribers", {
      p_workspace_id: workspaceId,
      center_lat: area.lat,
      center_lng: area.lng,
      radius_km: area.radiusKm,
    });

    // One failing area must not be reported as "nobody is nearby". Throw and let
    // the route answer 500, rather than returning a partial union that looks
    // like a complete one.
    if (error) throw error;

    for (const row of (data ?? []) as Tables<"subscribers">[]) {
      if (!byId.has(row.id)) byId.set(row.id, row);
    }
  }

  return [...byId.values()];
}
