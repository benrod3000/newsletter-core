import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

/**
 * POST /api/admin/demo/seed
 * Seeds the demo workspace (demo@veloce.app) with realistic data.
 * Idempotent — deletes existing demo data before reseeding.
 * Protected by admin Basic Auth (handled by proxy.ts middleware).
 */

const US_CITIES = [
  { city: 'New York', region: 'New York', postal: '10001', lat: 40.7128, lng: -74.0060, tz: 'America/New_York' },
  { city: 'Los Angeles', region: 'California', postal: '90001', lat: 34.0522, lng: -118.2437, tz: 'America/Los_Angeles' },
  { city: 'Chicago', region: 'Illinois', postal: '60601', lat: 41.8781, lng: -87.6298, tz: 'America/Chicago' },
  { city: 'Houston', region: 'Texas', postal: '77001', lat: 29.7604, lng: -95.3698, tz: 'America/Chicago' },
  { city: 'Phoenix', region: 'Arizona', postal: '85001', lat: 33.4484, lng: -112.0740, tz: 'America/Phoenix' },
  { city: 'Philadelphia', region: 'Pennsylvania', postal: '19101', lat: 39.9526, lng: -75.1652, tz: 'America/New_York' },
  { city: 'San Antonio', region: 'Texas', postal: '78201', lat: 29.4241, lng: -98.4936, tz: 'America/Chicago' },
  { city: 'San Diego', region: 'California', postal: '92101', lat: 32.7157, lng: -117.1611, tz: 'America/Los_Angeles' },
  { city: 'Dallas', region: 'Texas', postal: '75201', lat: 32.7767, lng: -96.7970, tz: 'America/Chicago' },
  { city: 'Austin', region: 'Texas', postal: '73301', lat: 30.2672, lng: -97.7431, tz: 'America/Chicago' },
  { city: 'San Jose', region: 'California', postal: '95101', lat: 37.3382, lng: -121.8863, tz: 'America/Los_Angeles' },
  { city: 'Jacksonville', region: 'Florida', postal: '32201', lat: 30.3322, lng: -81.6557, tz: 'America/New_York' },
  { city: 'Fort Worth', region: 'Texas', postal: '76101', lat: 32.7555, lng: -97.3308, tz: 'America/Chicago' },
  { city: 'Columbus', region: 'Ohio', postal: '43201', lat: 39.9612, lng: -82.9988, tz: 'America/New_York' },
  { city: 'Charlotte', region: 'North Carolina', postal: '28201', lat: 35.2271, lng: -80.8431, tz: 'America/New_York' },
  { city: 'Indianapolis', region: 'Indiana', postal: '46201', lat: 39.7684, lng: -86.1581, tz: 'America/New_York' },
  { city: 'San Francisco', region: 'California', postal: '94101', lat: 37.7749, lng: -122.4194, tz: 'America/Los_Angeles' },
  { city: 'Seattle', region: 'Washington', postal: '98101', lat: 47.6062, lng: -122.3321, tz: 'America/Los_Angeles' },
  { city: 'Denver', region: 'Colorado', postal: '80201', lat: 39.7392, lng: -104.9903, tz: 'America/Denver' },
  { city: 'Nashville', region: 'Tennessee', postal: '37201', lat: 36.1627, lng: -86.7816, tz: 'America/Chicago' },
  { city: 'Portland', region: 'Oregon', postal: '97201', lat: 45.5152, lng: -122.6784, tz: 'America/Los_Angeles' },
  { city: 'Oklahoma City', region: 'Oklahoma', postal: '73101', lat: 35.4676, lng: -97.5164, tz: 'America/Chicago' },
  { city: 'Las Vegas', region: 'Nevada', postal: '89101', lat: 36.1699, lng: -115.1398, tz: 'America/Los_Angeles' },
  { city: 'Baltimore', region: 'Maryland', postal: '21201', lat: 39.2904, lng: -76.6122, tz: 'America/New_York' },
  { city: 'Louisville', region: 'Kentucky', postal: '40201', lat: 38.2527, lng: -85.7585, tz: 'America/New_York' },
  { city: 'Milwaukee', region: 'Wisconsin', postal: '53201', lat: 43.0389, lng: -87.9065, tz: 'America/Chicago' },
  { city: 'Albuquerque', region: 'New Mexico', postal: '87101', lat: 35.0853, lng: -106.6056, tz: 'America/Denver' },
  { city: 'Tucson', region: 'Arizona', postal: '85701', lat: 32.2226, lng: -110.9747, tz: 'America/Phoenix' },
  { city: 'Fresno', region: 'California', postal: '93701', lat: 36.7378, lng: -119.7871, tz: 'America/Los_Angeles' },
  { city: 'Sacramento', region: 'California', postal: '94203', lat: 38.5816, lng: -121.4944, tz: 'America/Los_Angeles' },
  { city: 'Kansas City', region: 'Missouri', postal: '64101', lat: 39.0997, lng: -94.5786, tz: 'America/Chicago' },
  { city: 'Mesa', region: 'Arizona', postal: '85201', lat: 33.4152, lng: -111.8315, tz: 'America/Phoenix' },
  { city: 'Atlanta', region: 'Georgia', postal: '30301', lat: 33.7490, lng: -84.3880, tz: 'America/New_York' },
  { city: 'Omaha', region: 'Nebraska', postal: '68101', lat: 41.2565, lng: -95.9345, tz: 'America/Chicago' },
  { city: 'Colorado Springs', region: 'Colorado', postal: '80901', lat: 38.8339, lng: -104.8214, tz: 'America/Denver' },
  { city: 'Raleigh', region: 'North Carolina', postal: '27601', lat: 35.7796, lng: -78.6382, tz: 'America/New_York' },
  { city: 'Miami', region: 'Florida', postal: '33101', lat: 25.7617, lng: -80.1918, tz: 'America/New_York' },
  { city: 'Virginia Beach', region: 'Virginia', postal: '23450', lat: 36.8529, lng: -75.9780, tz: 'America/New_York' },
  { city: 'Long Beach', region: 'California', postal: '90801', lat: 33.7701, lng: -118.1937, tz: 'America/Los_Angeles' },
  { city: 'Oakland', region: 'California', postal: '94601', lat: 37.8044, lng: -122.2712, tz: 'America/Los_Angeles' },
  { city: 'Minneapolis', region: 'Minnesota', postal: '55401', lat: 44.9778, lng: -93.2650, tz: 'America/Chicago' },
  { city: 'Tampa', region: 'Florida', postal: '33601', lat: 27.9506, lng: -82.4572, tz: 'America/New_York' },
  { city: 'Honolulu', region: 'Hawaii', postal: '96801', lat: 21.3069, lng: -157.8583, tz: 'Pacific/Honolulu' },
  { city: 'Arlington', region: 'Texas', postal: '76001', lat: 32.7357, lng: -97.1081, tz: 'America/Chicago' },
  { city: 'Anchorage', region: 'Alaska', postal: '99501', lat: 61.2181, lng: -149.9003, tz: 'America/Anchorage' },
  { city: 'New Orleans', region: 'Louisiana', postal: '70112', lat: 29.9511, lng: -90.0715, tz: 'America/Chicago' },
  { city: 'Cincinnati', region: 'Ohio', postal: '45201', lat: 39.1031, lng: -84.5120, tz: 'America/New_York' },
  { city: 'Pittsburgh', region: 'Pennsylvania', postal: '15201', lat: 40.4406, lng: -79.9959, tz: 'America/New_York' },
  { city: 'St. Louis', region: 'Missouri', postal: '63101', lat: 38.6270, lng: -90.1994, tz: 'America/Chicago' },
  { city: 'Orlando', region: 'Florida', postal: '32801', lat: 28.5383, lng: -81.3792, tz: 'America/New_York' },
  { city: 'Birmingham', region: 'Alabama', postal: '35201', lat: 33.5186, lng: -86.8104, tz: 'America/Chicago' },
  { city: 'Salt Lake City', region: 'Utah', postal: '84101', lat: 40.7608, lng: -111.8910, tz: 'America/Denver' },
  { city: 'Reno', region: 'Nevada', postal: '89501', lat: 39.5296, lng: -119.8138, tz: 'America/Los_Angeles' },
  { city: 'Boise', region: 'Idaho', postal: '83701', lat: 43.6150, lng: -116.2023, tz: 'America/Denver' },
  { city: 'Detroit', region: 'Michigan', postal: '48201', lat: 42.3314, lng: -83.0458, tz: 'America/New_York' },
  { city: 'Memphis', region: 'Tennessee', postal: '38101', lat: 35.1495, lng: -90.0490, tz: 'America/Chicago' },
  { city: 'Buffalo', region: 'New York', postal: '14201', lat: 42.8864, lng: -78.8784, tz: 'America/New_York' },
  { city: 'Richmond', region: 'Virginia', postal: '23218', lat: 37.5407, lng: -77.4360, tz: 'America/New_York' },
  { city: 'Santa Fe', region: 'New Mexico', postal: '87501', lat: 35.6870, lng: -105.9378, tz: 'America/Denver' },
  { city: 'Portland', region: 'Maine', postal: '04101', lat: 43.6610, lng: -70.2553, tz: 'America/New_York' },
  { city: 'Charleston', region: 'South Carolina', postal: '29401', lat: 32.7765, lng: -79.9311, tz: 'America/New_York' },
  { city: 'Des Moines', region: 'Iowa', postal: '50301', lat: 41.5868, lng: -93.6250, tz: 'America/Chicago' },
  { city: 'Bismarck', region: 'North Dakota', postal: '58501', lat: 46.8083, lng: -100.7837, tz: 'America/Chicago' },
  { city: 'Pierre', region: 'South Dakota', postal: '57501', lat: 44.3683, lng: -100.3508, tz: 'America/Chicago' },
  { city: 'Cheyenne', region: 'Wyoming', postal: '82001', lat: 41.1400, lng: -104.8202, tz: 'America/Denver' },
  { city: 'Helena', region: 'Montana', postal: '59601', lat: 46.5927, lng: -112.0361, tz: 'America/Denver' },
  { city: 'Burlington', region: 'Vermont', postal: '05401', lat: 44.4759, lng: -73.2121, tz: 'America/New_York' },
  { city: 'Manchester', region: 'New Hampshire', postal: '03101', lat: 42.9956, lng: -71.4548, tz: 'America/New_York' },
  { city: 'Wilmington', region: 'Delaware', postal: '19801', lat: 39.7447, lng: -75.5484, tz: 'America/New_York' },
  { city: 'Providence', region: 'Rhode Island', postal: '02901', lat: 41.8240, lng: -71.4128, tz: 'America/New_York' },
  { city: 'Bridgeport', region: 'Connecticut', postal: '06601', lat: 41.1865, lng: -73.1952, tz: 'America/New_York' },
  { city: 'Dover', region: 'Delaware', postal: '19901', lat: 39.1582, lng: -75.5244, tz: 'America/New_York' },
  { city: 'Annapolis', region: 'Maryland', postal: '21401', lat: 38.9784, lng: -76.4922, tz: 'America/New_York' },
  { city: 'Madison', region: 'Wisconsin', postal: '53701', lat: 43.0731, lng: -89.4012, tz: 'America/Chicago' },
  { city: 'Grand Rapids', region: 'Michigan', postal: '49501', lat: 42.9634, lng: -85.6681, tz: 'America/New_York' },
  { city: 'Tulsa', region: 'Oklahoma', postal: '74101', lat: 36.1540, lng: -95.9928, tz: 'America/Chicago' },
  { city: 'Wichita', region: 'Kansas', postal: '67201', lat: 37.6872, lng: -97.3301, tz: 'America/Chicago' },
  { city: 'Spokane', region: 'Washington', postal: '99201', lat: 47.6588, lng: -117.4260, tz: 'America/Los_Angeles' },
  { city: 'Eugene', region: 'Oregon', postal: '97401', lat: 44.0521, lng: -123.0868, tz: 'America/Los_Angeles' },
  { city: 'Billings', region: 'Montana', postal: '59101', lat: 45.7833, lng: -108.5007, tz: 'America/Denver' },
  { city: 'Casper', region: 'Wyoming', postal: '82601', lat: 42.8501, lng: -106.3256, tz: 'America/Denver' },
  { city: 'Jackson', region: 'Mississippi', postal: '39201', lat: 32.2988, lng: -90.1848, tz: 'America/Chicago' },
  { city: 'Little Rock', region: 'Arkansas', postal: '72201', lat: 34.7445, lng: -92.2880, tz: 'America/Chicago' },
  { city: 'Huntsville', region: 'Alabama', postal: '35801', lat: 34.7304, lng: -86.5861, tz: 'America/Chicago' },
  { city: 'Lexington', region: 'Kentucky', postal: '40502', lat: 38.0406, lng: -84.5037, tz: 'America/New_York' },
  { city: 'Knoxville', region: 'Tennessee', postal: '37901', lat: 35.9606, lng: -83.9207, tz: 'America/New_York' },
  { city: 'Greenville', region: 'South Carolina', postal: '29601', lat: 34.8526, lng: -82.3940, tz: 'America/New_York' },
  { city: 'Columbia', region: 'South Carolina', postal: '29201', lat: 34.0007, lng: -81.0348, tz: 'America/New_York' },
  { city: 'Augusta', region: 'Georgia', postal: '30901', lat: 33.4735, lng: -82.0105, tz: 'America/New_York' },
  { city: 'Savannah', region: 'Georgia', postal: '31401', lat: 32.0809, lng: -81.0912, tz: 'America/New_York' },
  { city: 'Lafayette', region: 'Louisiana', postal: '70501', lat: 30.2241, lng: -92.0198, tz: 'America/Chicago' },
  { city: 'Fayetteville', region: 'North Carolina', postal: '28301', lat: 35.0527, lng: -78.8784, tz: 'America/New_York' },
  { city: 'Asheville', region: 'North Carolina', postal: '28801', lat: 35.5951, lng: -82.5515, tz: 'America/New_York' },
  { city: 'Burlington', region: 'North Carolina', postal: '27215', lat: 36.0760, lng: -79.4687, tz: 'America/New_York' },
  { city: 'Charlottesville', region: 'Virginia', postal: '22901', lat: 38.0293, lng: -78.4767, tz: 'America/New_York' },
  { city: 'Bar Harbor', region: 'Maine', postal: '04609', lat: 44.3876, lng: -68.2039, tz: 'America/New_York' },
  { city: 'Bend', region: 'Oregon', postal: '97701', lat: 44.0582, lng: -121.3153, tz: 'America/Los_Angeles' },
  { city: 'Boulder', region: 'Colorado', postal: '80301', lat: 40.0150, lng: -105.2705, tz: 'America/Denver' },
  { city: 'Flagstaff', region: 'Arizona', postal: '86001', lat: 35.1983, lng: -111.6513, tz: 'America/Phoenix' },
  { city: 'Santa Cruz', region: 'California', postal: '95060', lat: 36.9741, lng: -122.0308, tz: 'America/Los_Angeles' },
  { city: 'Sedona', region: 'Arizona', postal: '86336', lat: 34.8697, lng: -111.7610, tz: 'America/Phoenix' },
  { city: 'Taos', region: 'New Mexico', postal: '87571', lat: 36.4073, lng: -105.5731, tz: 'America/Denver' },
  { city: 'Martha\'s Vineyard', region: 'Massachusetts', postal: '02557', lat: 41.3800, lng: -70.5450, tz: 'America/New_York' },
  { city: 'Nantucket', region: 'Massachusetts', postal: '02554', lat: 41.2835, lng: -70.0995, tz: 'America/New_York' },
];

const FIRST_NAMES = ['Alex', 'Maria', 'James', 'Sarah', 'David', 'Emma', 'Michael', 'Lisa', 'Tom', 'Rachel', 'Chris', 'Jenny', 'Ryan', 'Olivia', 'Kevin', 'Sophie', 'Brian', 'Amanda', 'Jason', 'Nicole', 'Derek', 'Laura', 'Eric', 'Megan', 'Sean', 'Katie', 'Adam', 'Lauren', 'Nathan', 'Julia', 'Aaron', 'Stephanie', 'Ben', 'Hannah', 'Tyler', 'Emily', 'Zach', 'Alyssa', 'Sam', 'Brooke', 'Jake', 'Morgan', 'Dylan', 'Paige', 'Evan', 'Courtney', 'Blake', 'Haley', 'Cody', 'Samantha'];

const LAST_NAMES = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson', 'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin', 'Lee', 'Perez', 'Thompson', 'White', 'Harris', 'Sanchez', 'Clark', 'Ramirez', 'Lewis', 'Robinson', 'Walker', 'Young', 'Allen', 'King', 'Wright', 'Scott', 'Torres', 'Nguyen', 'Hill', 'Flores', 'Green', 'Adams', 'Nelson', 'Baker', 'Hall', 'Rivera', 'Campbell', 'Mitchell', 'Carter', 'Roberts'];

const CAMPAIGNS = [
  { title: 'Welcome to Veloce', subject: 'Get started with audience ownership', sent: 5432, opened: 2168, clicked: 365, days_ago: 60 },
  { title: 'Weekly Tech Roundup', subject: "This week's best stories", sent: 4800, opened: 1584, clicked: 240, days_ago: 45 },
  { title: 'South Congress Sale', subject: 'Your neighborhood deal is waiting', sent: 1247, opened: 387, clicked: 89, days_ago: 30 },
  { title: 'Product Launch', subject: 'Introducing our newest feature', sent: 8100, opened: 3402, clicked: 612, days_ago: 21 },
  { title: 'East Side Workshop', subject: 'Learn something new this weekend', sent: 312, opened: 134, clicked: 28, days_ago: 14 },
  { title: 'Summer Campaign', subject: 'Hot deals for the season', sent: 2800, opened: 868, clicked: 156, days_ago: 7 },
  { title: 'Holiday Special', subject: 'Limited-time holiday offer', sent: 0, opened: 0, clicked: 0, days_ago: 0, draft: true },
];

async function supabaseFetch(path: string, options: RequestInit = {}) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase env vars");
  const res = await fetch(`${url}/rest/v1${path}`, {
    ...options,
    headers: {
      "apikey": key,
      "Authorization": `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase ${res.status}: ${err}`);
  }
  return res;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export async function POST(req: NextRequest) {
  try {
    // Find the demo user
    const userRes = await supabaseFetch(
      `/workspace_users?select=id,workspace_id,email&email=eq.demo%40veloce.app&limit=1`
    );
    const users = await userRes.json();
    if (!Array.isArray(users) || users.length === 0) {
      return NextResponse.json({ error: "Demo user not found. Create demo@veloce.app first." }, { status: 404 });
    }

    const demoUser = users[0];
    const workspaceId = demoUser.workspace_id;

    // 1. Delete existing demo data
    await supabaseFetch(`/subscribers?client_id=eq.${workspaceId}`, { method: "DELETE" });
    await supabaseFetch(`/campaigns?client_id=eq.${workspaceId}`, { method: "DELETE" });

    // 2. Create subscribers (all 50+ states, 2 per city = ~200+)
    const subscriberIds: string[] = [];
    let subCount = 0;

    for (const loc of US_CITIES) {
      for (let j = 0; j < 2; j++) {
        const firstName = pick(FIRST_NAMES);
        const lastName = pick(LAST_NAMES);
        const email = `${firstName.toLowerCase()}.${lastName.toLowerCase()}${randomInt(1, 999)}@example.com`;
        const phone = `+1${randomInt(200, 999)}${randomInt(100, 999)}${randomInt(1000, 9999)}`;
        const daysAgo = randomInt(1, 90);
        const createdAt = new Date(Date.now() - daysAgo * 86400000).toISOString();
        const healthScores: string[] = ['active', 'active', 'active', 'at_risk', 'cold'];
        const health = pick(healthScores);

        try {
          const subRes = await supabaseFetch("/subscribers", {
            method: "POST",
            body: JSON.stringify({
              client_id: workspaceId,
              email,
              first_name: firstName,
              last_name: lastName,
              phone_number: phone,
              country: "US",
              region: loc.region,
              city: loc.city,
              postal_code: loc.postal,
              latitude: loc.lat,
              longitude: loc.lng,
              timezone: loc.tz,
              confirmed: true,
              health_score: health,
              created_at: createdAt,
            }),
            headers: { Prefer: "return=representation" },
          });
          const subData = await subRes.json();
          if (subData?.[0]?.id) {
            subscriberIds.push(subData[0].id);
            subCount++;
          }
        } catch (err: any) {
          // Skip duplicates
        }
      }
    }

    // 3. Create campaigns
    const campaignIds: string[] = [];
    for (const c of CAMPAIGNS) {
      const createdAt = new Date(Date.now() - c.days_ago * 86400000).toISOString();
      const html = `<div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:24px;border:3px solid #0a0a0a">
        <h1 style="font-size:24px;text-transform:uppercase;letter-spacing:0.05em">${c.title}</h1>
        <p style="font-size:14px;color:#555">${c.subject}</p>
        <hr style="border:none;border-top:2px solid #0a0a0a;margin:16px 0" />
        <p style="font-size:14px">This is a demo campaign. In a real workspace, this would contain your newsletter content with merge tags, images, and links.</p>
        <a href="#" style="display:inline-block;padding:12px 24px;background:#f5e642;color:#0a0a0a;font-weight:bold;text-decoration:none;border:2px solid #0a0a0a;margin-top:16px">Learn More</a>
      </div>`;

      const cRes = await supabaseFetch("/campaigns", {
        method: "POST",
        body: JSON.stringify({
          client_id: workspaceId,
          title: c.title,
          subject: c.subject,
          status: c.draft ? "draft" : "sent",
          sent_count: c.sent,
          // open_count and click_count removed // columns not in schema
          editor_html: html,
          created_at: createdAt,
        }),
        headers: { Prefer: "return=representation" },
      });
      const cData = await cRes.json();
      if (cData?.[0]?.id) campaignIds.push(cData[0].id);
    }

    // 4. Create campaign events for analytics (sample open/click on sent campaigns)
    for (const c of CAMPAIGNS) {
      if (c.sent === 0) continue;
      // Create a handful of sample events
      for (let i = 0; i < Math.min(20, subscriberIds.length); i++) {
        const subId = subscriberIds[i];
        try {
          await supabaseFetch("/campaign_events", {
            method: "POST",
            body: JSON.stringify({
              campaign_id: campaignIds[CAMPAIGNS.indexOf(c)],
              subscriber_id: subId,
              event: i % 3 === 0 ? "click" : "open",
              created_at: new Date(Date.now() - randomInt(1, c.days_ago || 1) * 86400000).toISOString(),
            }),
          });
        } catch {}
      }
    }

    return NextResponse.json({
      ok: true,
      workspace_id: workspaceId,
      subscribers_created: subCount,
      campaigns_created: campaignIds.length,
      campaign_events_created: "sample opens/clicks added",
    });
  } catch (error: any) {
    console.error("Demo seed error:", error?.message || error);
    return NextResponse.json({ error: error?.message || "Seed failed" }, { status: 500 });
  }
}
