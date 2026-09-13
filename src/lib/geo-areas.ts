import { getSupabaseClient } from "./supabase";
import { fetchAllRows } from "./paginate";
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
    /*
     * Paged, because an RPC answer is a PostgREST response like any other and
     * the project's `max-rows` ceiling of 1,000 applies to it too - silently,
     * with no error and no indication the set was cut. `nearby_subscribers`
     * returns SETOF subscribers, so a circle containing more than 1,000
     * contacts returned exactly 1,000 and the route reported that as the total.
     *
     * Measured on the current data: a 200-mile radius on New York covers New
     * York, Philadelphia (80mi) and Boston (190mi), which is 1,500 contacts, and
     * 500 of them were being dropped. Worth noting the 100-mile case too, which
     * catches New York and Philadelphia for exactly 1,000 - the truncated answer
     * and the true one are the same number there, so the bug was invisible at
     * precisely the radius most likely to be tried first.
     *
     * `fetchAllRows` clamps the page size to that ceiling so a short page stays
     * a truthful end-of-set signal; the cursor is `id`, ordered by PostgREST on
     * top of the function's own ORDER BY.
     *
     * One failing area must not be reported as "nobody is nearby" - fetchAllRows
     * throws, and the route answers 500, rather than handing back a partial
     * union that looks like a complete one.
     */
    const rows = await fetchAllRows<Tables<"subscribers">>((afterId, pageSize) => {
      let query = supabase
        .rpc("nearby_subscribers", {
          p_workspace_id: workspaceId,
          center_lat: area.lat,
          center_lng: area.lng,
          radius_km: area.radiusKm,
        })
        .order("id", { ascending: true })
        .limit(pageSize);

      if (afterId !== null) query = query.gt("id", afterId);

      return query as unknown as PromiseLike<{
        data: Tables<"subscribers">[] | null;
        error: { message: string } | null;
      }>;
    });

    for (const row of rows) {
      if (!byId.has(row.id)) byId.set(row.id, row);
    }
  }

  return [...byId.values()];
}

/**
 * A plottable cluster of contacts: one distinct coordinate and its health split.
 *
 * The map used to plot the contacts table's current page, so a workspace of
 * 10,312 was drawn from whichever fifty rows sorted to the top - and 500 people
 * sharing a city centroid stacked into one pixel regardless. Aggregating in SQL
 * sends about as many rows as there are places, and sizing a circle by `total`
 * is the only way the difference between 4 contacts and 500 is visible.
 */
export interface GeoCluster {
  lat: number;
  lng: number;
  total: number;
  active: number;
  at_risk: number;
  cold: number;
}

/** Exact count of distinct subscribers inside any area. Zero areas counts nobody. */
export async function countSubscribersInAreas(
  workspaceId: string,
  areas: GeoArea[]
): Promise<number> {
  if (areas.length === 0) return 0;

  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("count_subscribers_in_areas", {
    p_workspace_id: workspaceId,
    p_areas: areas.map((a) => ({ lat: a.lat, lng: a.lng, radius_km: a.radiusKm })),
  });

  if (error) throw new Error(error.message);

  // A scalar-returning function answers with the number itself. Guarded rather
  // than trusted, because a null here would render as "NaN in range".
  const n = typeof data === "number" ? data : Number(data);
  return Number.isFinite(n) ? n : 0;
}

/** Where a workspace's contacts are, grouped for plotting. */
export async function fetchGeoClusters(
  workspaceId: string,
  opts: { precision?: number; limit?: number } = {}
): Promise<GeoCluster[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("subscriber_geo_clusters", {
    p_workspace_id: workspaceId,
    p_precision: opts.precision ?? 2,
    p_limit: opts.limit ?? 2000,
  });

  if (error) throw new Error(error.message);

  return (data ?? []).filter((c) => Number.isFinite(c.lat) && Number.isFinite(c.lng));
}
