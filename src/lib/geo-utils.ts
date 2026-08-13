/**
 * Shared Geo utility functions.
 * Extracted from send-campaign.ts to eliminate duplication across admin routes.
 */

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

/**
 * The origin that serves *this* API, taken from the request and nothing else.
 *
 * Use for any link that must reach a route in this app: `/api/track/click`,
 * `/api/confirm`, `/unsubscribe`.
 *
 * `getBaseUrl` above is not safe for that. It prefers `NEXT_PUBLIC_APP_URL`, and on
 * this project both that and `APP_URL` resolve to the **frontend** - the React app,
 * which has no `/api/*` routes and answers with its own 404 page. Emailed download
 * links did exactly that: the message arrived looking correct and every link in it
 * was dead. Env values here are write-only in Vercel, so the misconfiguration
 * cannot be read back and confirmed; the request host can, and it is correct by
 * construction because the request reached this handler.
 *
 * The tradeoff is that a request arriving on a preview deployment mints links on
 * that preview. That is the right answer anyway - a preview's links should not point
 * at production - and it is far better than links that always point somewhere with
 * no route to serve them.
 */
export function getApiBaseUrl(req: { headers: Headers }): string {
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
  return `${proto}://${host}`;
}
