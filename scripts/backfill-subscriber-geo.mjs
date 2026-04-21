import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.");
  process.exit(1);
}

const LIMIT = Number.parseInt(process.env.GEO_BACKFILL_LIMIT ?? "100", 10);
const CLIENT_ID = process.env.GEO_BACKFILL_CLIENT_ID ?? null;
const DRY_RUN = process.env.GEO_BACKFILL_DRY_RUN === "1";
const DELAY_MS = Number.parseInt(process.env.GEO_BACKFILL_DELAY_MS ?? "1200", 10);

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function geocodeLocation(city, region, country) {
  const q = [city, region, country].filter(Boolean).join(", ");
  if (!q) return null;

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", q);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "1");

  const res = await fetch(url.toString(), {
    headers: {
      "User-Agent": "newsletter-geo-backfill/1.0",
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    throw new Error(`Geocoder returned ${res.status}`);
  }

  const payload = await res.json();
  if (!Array.isArray(payload) || payload.length === 0) {
    return null;
  }

  const top = payload[0];
  const latitude = Number.parseFloat(top.lat);
  const longitude = Number.parseFloat(top.lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  return { latitude, longitude };
}

async function run() {
  let query = supabase
    .from("subscribers")
    .select("id, email, city, region, country")
    .is("latitude", null)
    .is("longitude", null)
    .order("created_at", { ascending: true })
    .limit(LIMIT);

  if (CLIENT_ID) query = query.eq("client_id", CLIENT_ID);

  const { data: subscribers, error } = await query;
  if (error) {
    throw new Error(`Failed loading subscribers: ${error.message}`);
  }

  if (!subscribers || subscribers.length === 0) {
    console.log("No subscribers need geo backfill.");
    return;
  }

  console.log(`Processing ${subscribers.length} subscriber(s). Dry run: ${DRY_RUN ? "yes" : "no"}.`);

  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const subscriber of subscribers) {
    try {
      const coords = await geocodeLocation(subscriber.city, subscriber.region, subscriber.country);
      if (!coords) {
        skipped += 1;
        console.log(`No match: ${subscriber.email ?? subscriber.id}`);
        await wait(DELAY_MS);
        continue;
      }

      if (DRY_RUN) {
        updated += 1;
        console.log(
          `Would update ${subscriber.email ?? subscriber.id} -> ${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)}`
        );
        await wait(DELAY_MS);
        continue;
      }

      const { error: updateError } = await supabase
        .from("subscribers")
        .update({ latitude: coords.latitude, longitude: coords.longitude })
        .eq("id", subscriber.id);

      if (updateError) {
        failed += 1;
        console.error(`Update failed for ${subscriber.email ?? subscriber.id}: ${updateError.message}`);
      } else {
        updated += 1;
        console.log(
          `Updated ${subscriber.email ?? subscriber.id} -> ${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)}`
        );
      }
    } catch (err) {
      failed += 1;
      console.error(
        `Geocode failed for ${subscriber.email ?? subscriber.id}: ${err instanceof Error ? err.message : "Unknown error"}`
      );
    }

    await wait(DELAY_MS);
  }

  console.log(`Done. Updated: ${updated}, skipped: ${skipped}, failed: ${failed}`);
}

run().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
