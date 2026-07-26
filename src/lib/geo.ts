/**
 * IP geolocation and distance utilities.
 *
 * Uses ip-api.com (free tier: 45 req/min, no API key).
 * Falls back to null on failure - callers must handle missing geo data gracefully.
 */

export interface GeoResult {
  latitude: number;
  longitude: number;
  postal_code: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
}

export interface ZipResult {
  lat: number;
  lng: number;
  city: string;
  state: string;
}

/**
 * Resolve an IP address to geographic coordinates.
 * Returns null if the IP is private, unknown, or the lookup fails.
 */
export async function geolocateIP(ip: string): Promise<GeoResult | null> {
  if (!ip || ip === 'unknown' || ip === '127.0.0.1' || ip.startsWith('192.168.') || ip.startsWith('10.')) {
    return null;
  }

  try {
    const res = await fetch(
      `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,lat,lon,zip,country,regionName,city`,
      { signal: AbortSignal.timeout(3000) }
    );
    const data = await res.json();
    if (data.status !== 'success') return null;

    return {
      latitude: data.lat,
      longitude: data.lon,
      postal_code: data.zip || null,
      country: data.country || null,
      region: data.regionName || null,
      city: data.city || null,
    };
  } catch {
    return null;
  }
}

/**
 * Resolve a US ZIP code to lat/lng + city/state.
 */
export async function resolveZip(zip: string): Promise<ZipResult | null> {
  const clean = zip.trim();
  if (!/^\d{5}(-\d{4})?$/.test(clean)) return null;

  try {
    const res = await fetch(
      `http://ip-api.com/json/${encodeURIComponent(clean)}?fields=status,lat,lon,city,regionName`,
      { signal: AbortSignal.timeout(3000) }
    );
    const data = await res.json();
    if (data.status !== 'success') return null;

    return {
      lat: data.lat,
      lng: data.lon,
      city: data.city || '',
      state: data.regionName || '',
    };
  } catch {
    return null;
  }
}

/**
 * Haversine distance between two points in miles.
 */
export function haversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 3959; // Earth's radius in miles
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 100) / 100;
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}
