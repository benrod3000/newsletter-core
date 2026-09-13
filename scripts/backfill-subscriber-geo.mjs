import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

/*
 * Backfill subscriber latitude/longitude from the city/region/country an import
 * already carried.
 *
 * GEOCODE ONE PLACE, NOT ONE ROW
 *
 * This script used to geocode per subscriber: 10,300 rows at Nominatim's ~1/sec
 * courtesy limit is about three and a half hours, which is why the backfill was
 * deferred as too expensive and the map has been empty ever since. The rows do
 * not hold 10,300 places though - they hold 28. Contacts share cities, so the
 * work is one call per distinct (city, region, country) and then one UPDATE per
 * place, which is about thirty seconds.
 *
 * Coordinates are the place's centroid. Every contact in Denver gets Denver's
 * coordinates, because that is the truth of what city-level data supports - a
 * city name does not say where in the city somebody is, and scattering rows to
 * make a prettier map would be inventing precision the import never had. Radius
 * filtering is unaffected: a circle either contains the city or it does not.
 *
 * The cache in scripts/place-coords.json is committed, so a re-run costs no API
 * calls and a new import only pays for places it has not seen.
 *
 * Env:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   required
 *   GEO_BACKFILL_WORKSPACE_ID                 limit to one workspace
 *   GEO_BACKFILL_DRY_RUN=1                    geocode and report, write nothing
 *   GEO_BACKFILL_DELAY_MS                     default 1200, Nominatim asks for >=1000
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.");
  process.exit(1);
}

const WORKSPACE_ID = process.env.GEO_BACKFILL_WORKSPACE_ID ?? null;
const DRY_RUN = process.env.GEO_BACKFILL_DRY_RUN === "1";
const DELAY_MS = Number.parseInt(process.env.GEO_BACKFILL_DELAY_MS ?? "1200", 10);
const CACHE_PATH = new URL("./place-coords.json", import.meta.url);

/*
 * PostgREST caps a response at max-rows, 1,000 on this project, and reports no
 * error when it truncates - so reading the places out of 10,300 rows needs
 * keyset paging, not a bigger limit. Same ceiling src/lib/paginate.ts exists for.
 */
const PAGE_SIZE = 1000;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Cache key. Case and spacing vary between imports; the place does not. */
const placeKey = (city, region, country) =>
  [city, region, country].map((p) => (p ?? "").trim().toLowerCase()).join("|");

function loadCache() {
  if (!existsSync(CACHE_PATH)) return {};
  try {
    return JSON.parse(readFileSync(CACHE_PATH, "utf8"));
  } catch (err) {
    console.warn(`Ignoring unreadable cache: ${err.message}`);
    return {};
  }
}

function saveCache(cache) {
  writeFileSync(CACHE_PATH, `${JSON.stringify(cache, null, 2)}\n`);
}

async function geocodePlace(city, region, country) {
  const q = [city, region, country].filter(Boolean).join(", ");
  if (!q) return null;

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", q);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "1");

  const res = await fetch(url, {
    headers: { "User-Agent": "veloce-geo-backfill/2.0", Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Geocoder returned ${res.status}`);

  const payload = await res.json();
  const top = Array.isArray(payload) ? payload[0] : null;
  if (!top) return null;

  const latitude = Number.parseFloat(top.lat);
  const longitude = Number.parseFloat(top.lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  return { latitude, longitude };
}

/** Every distinct (city, region, country) still missing coordinates, with row counts. */
async function collectPlaces() {
  const places = new Map();
  let after = null;
  let scanned = 0;

  for (;;) {
    let query = supabase
      .from("subscribers")
      .select("id, city, region, country")
      .is("latitude", null)
      .not("city", "is", null)
      .order("id", { ascending: true })
      .limit(PAGE_SIZE);

    if (after) query = query.gt("id", after);
    if (WORKSPACE_ID) query = query.eq("workspace_id", WORKSPACE_ID);

    const { data, error } = await query;
    if (error) throw new Error(`Failed loading subscribers: ${error.message}`);
    if (!data?.length) break;

    for (const row of data) {
      const key = placeKey(row.city, row.region, row.country);
      const entry = places.get(key);
      if (entry) entry.rows += 1;
      else places.set(key, { city: row.city, region: row.region, country: row.country, rows: 1 });
    }

    scanned += data.length;
    after = data[data.length - 1].id;
    if (data.length < PAGE_SIZE) break;
  }

  return { places, scanned };
}

async function run() {
  const { places, scanned } = await collectPlaces();

  if (places.size === 0) {
    console.log("No subscribers need geo backfill.");
    return;
  }

  console.log(
    `${scanned} subscriber(s) without coordinates across ${places.size} place(s). Dry run: ${DRY_RUN ? "yes" : "no"}.`
  );

  const cache = loadCache();
  let cacheHits = 0;
  let geocoded = 0;
  let unmatched = 0;
  let rowsUpdated = 0;
  let failed = 0;

  for (const [key, place] of places) {
    const label = [place.city, place.region].filter(Boolean).join(", ");

    let coords = cache[key];
    if (coords) {
      cacheHits += 1;
    } else {
      try {
        coords = await geocodePlace(place.city, place.region, place.country);
      } catch (err) {
        failed += 1;
        console.error(`Geocode failed for ${label}: ${err.message}`);
        await wait(DELAY_MS);
        continue;
      }
      // Only a successful lookup is cached. Caching a miss would make a
      // transient outage permanent for that place.
      if (coords) {
        cache[key] = coords;
        geocoded += 1;
        if (!DRY_RUN) saveCache(cache);
      }
      await wait(DELAY_MS);
    }

    if (!coords) {
      unmatched += 1;
      console.log(`No match: ${label} (${place.rows} row(s) left without coordinates)`);
      continue;
    }

    const at = `${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)}`;
    if (DRY_RUN) {
      console.log(`Would update ${place.rows} row(s) in ${label} -> ${at}`);
      rowsUpdated += place.rows;
      continue;
    }

    /*
     * Matched on the same place fields the rows were grouped by, and still
     * filtered to null coordinates, so a re-run after a partial failure cannot
     * move a row that already has coordinates.
     */
    let update = supabase
      .from("subscribers")
      .update({ latitude: coords.latitude, longitude: coords.longitude })
      .is("latitude", null)
      .eq("city", place.city);

    update = place.region === null ? update.is("region", null) : update.eq("region", place.region);
    update = place.country === null ? update.is("country", null) : update.eq("country", place.country);
    if (WORKSPACE_ID) update = update.eq("workspace_id", WORKSPACE_ID);

    const { error, count } = await update.select("id", { count: "exact", head: true });

    if (error) {
      failed += 1;
      console.error(`Update failed for ${label}: ${error.message}`);
      continue;
    }

    rowsUpdated += count ?? place.rows;
    console.log(`Updated ${count ?? place.rows} row(s) in ${label} -> ${at}`);
  }

  console.log(
    `Done. Places: ${places.size} (${geocoded} geocoded, ${cacheHits} cached, ${unmatched} unmatched, ${failed} failed). Rows ${DRY_RUN ? "to update" : "updated"}: ${rowsUpdated}.`
  );
}

run().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
