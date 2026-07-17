/**
 * Seed the demo workspace directly via Supabase REST API.
 * Run: node scripts/seed-demo.mjs
 */
const supabaseUrl = process.env.SUPABASE_URL || 'https://jdmtvkytidxpcvhnhgdso.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseKey) {
  console.error('Set SUPABASE_SERVICE_ROLE_KEY in environment');
  process.exit(1);
}

const auth = {
  apikey: supabaseKey,
  Authorization: `Bearer ${supabaseKey}`,
  'Content-Type': 'application/json',
};

async function sf(path, options = {}) {
  const url = `${supabaseUrl}/rest/v1${path}`;
  const res = await fetch(url, {
    ...options,
    headers: { ...auth, ...options.headers },
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase ${res.status}: ${err.slice(0, 200)}`);
  }
  return options.method === 'DELETE' ? null : res.json();
}

// Find demo user
const users = await sf(`/workspace_users?select=id,workspace_id&email=eq.demo%40veloce.app&limit=1`);
if (!users.length) {
  console.error('Demo user not found. Create demo@veloce.app first.');
  process.exit(1);
}

const workspaceId = users[0].workspace_id;
console.log('Workspace:', workspaceId);

// Delete existing demo data
console.log('Clearing existing demo data...');
await sf(`/subscribers?client_id=eq.${workspaceId}`, { method: 'DELETE' });
await sf(`/campaigns?client_id=eq.${workspaceId}`, { method: 'DELETE' });
console.log('Cleared.');

// Generate subscribers
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
  { city: 'Seattle', region: 'Washington', postal: '98101', lat: 47.6062, lng: -122.3321, tz: 'America/Los_Angeles' },
  { city: 'Denver', region: 'Colorado', postal: '80201', lat: 39.7392, lng: -104.9903, tz: 'America/Denver' },
  { city: 'Nashville', region: 'Tennessee', postal: '37201', lat: 36.1627, lng: -86.7816, tz: 'America/Chicago' },
  { city: 'Portland', region: 'Oregon', postal: '97201', lat: 45.5152, lng: -122.6784, tz: 'America/Los_Angeles' },
  { city: 'Atlanta', region: 'Georgia', postal: '30301', lat: 33.7490, lng: -84.3880, tz: 'America/New_York' },
  { city: 'Miami', region: 'Florida', postal: '33101', lat: 25.7617, lng: -80.1918, tz: 'America/New_York' },
  { city: 'Minneapolis', region: 'Minnesota', postal: '55401', lat: 44.9778, lng: -93.2650, tz: 'America/Chicago' },
  { city: 'New Orleans', region: 'Louisiana', postal: '70112', lat: 29.9511, lng: -90.0715, tz: 'America/Chicago' },
  { city: 'Honolulu', region: 'Hawaii', postal: '96801', lat: 21.3069, lng: -157.8583, tz: 'Pacific/Honolulu' },
  { city: 'Anchorage', region: 'Alaska', postal: '99501', lat: 61.2181, lng: -149.9003, tz: 'America/Anchorage' },
  { city: 'Detroit', region: 'Michigan', postal: '48201', lat: 42.3314, lng: -83.0458, tz: 'America/New_York' },
  { city: 'St. Louis', region: 'Missouri', postal: '63101', lat: 38.6270, lng: -90.1994, tz: 'America/Chicago' },
  { city: 'Pittsburgh', region: 'Pennsylvania', postal: '15201', lat: 40.4406, lng: -79.9959, tz: 'America/New_York' },
  { city: 'Salt Lake City', region: 'Utah', postal: '84101', lat: 40.7608, lng: -111.8910, tz: 'America/Denver' },
  { city: 'Memphis', region: 'Tennessee', postal: '38101', lat: 35.1495, lng: -90.0490, tz: 'America/Chicago' },
  { city: 'Raleigh', region: 'North Carolina', postal: '27601', lat: 35.7796, lng: -78.6382, tz: 'America/New_York' },
  { city: 'Buffalo', region: 'New York', postal: '14201', lat: 42.8864, lng: -78.8784, tz: 'America/New_York' },
  { city: 'Richmond', region: 'Virginia', postal: '23218', lat: 37.5407, lng: -77.4360, tz: 'America/New_York' },
  { city: 'Santa Fe', region: 'New Mexico', postal: '87501', lat: 35.6870, lng: -105.9378, tz: 'America/Denver' },
  { city: 'Charleston', region: 'South Carolina', postal: '29401', lat: 32.7765, lng: -79.9311, tz: 'America/New_York' },
  { city: 'Birmingham', region: 'Alabama', postal: '35201', lat: 33.5186, lng: -86.8104, tz: 'America/Chicago' },
  { city: 'Boise', region: 'Idaho', postal: '83701', lat: 43.6150, lng: -116.2023, tz: 'America/Denver' },
  { city: 'Des Moines', region: 'Iowa', postal: '50301', lat: 41.5868, lng: -93.6250, tz: 'America/Chicago' },
  { city: 'Little Rock', region: 'Arkansas', postal: '72201', lat: 34.7445, lng: -92.2880, tz: 'America/Chicago' },
  { city: 'Portland', region: 'Maine', postal: '04101', lat: 43.6610, lng: -70.2553, tz: 'America/New_York' },
  { city: 'Burlington', region: 'Vermont', postal: '05401', lat: 44.4759, lng: -73.2121, tz: 'America/New_York' },
  { city: 'Manchester', region: 'New Hampshire', postal: '03101', lat: 42.9956, lng: -71.4548, tz: 'America/New_York' },
  { city: 'Providence', region: 'Rhode Island', postal: '02901', lat: 41.8240, lng: -71.4128, tz: 'America/New_York' },
  { city: 'Wilmington', region: 'Delaware', postal: '19801', lat: 39.7447, lng: -75.5484, tz: 'America/New_York' },
  { city: 'Casper', region: 'Wyoming', postal: '82601', lat: 42.8501, lng: -106.3256, tz: 'America/Denver' },
  { city: 'Bismarck', region: 'North Dakota', postal: '58501', lat: 46.8083, lng: -100.7837, tz: 'America/Chicago' },
  { city: 'Pierre', region: 'South Dakota', postal: '57501', lat: 44.3683, lng: -100.3508, tz: 'America/Chicago' },
  { city: 'Helena', region: 'Montana', postal: '59601', lat: 46.5927, lng: -112.0361, tz: 'America/Denver' },
  { city: 'Jackson', region: 'Mississippi', postal: '39201', lat: 32.2988, lng: -90.1848, tz: 'America/Chicago' },
  { city: 'Madison', region: 'Wisconsin', postal: '53701', lat: 43.0731, lng: -89.4012, tz: 'America/Chicago' },
  { city: 'Tulsa', region: 'Oklahoma', postal: '74101', lat: 36.1540, lng: -95.9928, tz: 'America/Chicago' },
  { city: 'Wichita', region: 'Kansas', postal: '67201', lat: 37.6872, lng: -97.3301, tz: 'America/Chicago' },
  { city: 'Columbia', region: 'South Carolina', postal: '29201', lat: 34.0007, lng: -81.0348, tz: 'America/New_York' },
  { city: 'Savannah', region: 'Georgia', postal: '31401', lat: 32.0809, lng: -81.0912, tz: 'America/New_York' },
  { city: 'Asheville', region: 'North Carolina', postal: '28801', lat: 35.5951, lng: -82.5515, tz: 'America/New_York' },
  { city: 'Bend', region: 'Oregon', postal: '97701', lat: 44.0582, lng: -121.3153, tz: 'America/Los_Angeles' },
  { city: 'Boulder', region: 'Colorado', postal: '80301', lat: 40.0150, lng: -105.2705, tz: 'America/Denver' },
  { city: 'Flagstaff', region: 'Arizona', postal: '86001', lat: 35.1983, lng: -111.6513, tz: 'America/Phoenix' },
  { city: 'Santa Cruz', region: 'California', postal: '95060', lat: 36.9741, lng: -122.0308, tz: 'America/Los_Angeles' },
];

const FIRST_NAMES = ['Alex', 'Maria', 'James', 'Sarah', 'David', 'Emma', 'Michael', 'Lisa', 'Tom', 'Rachel', 'Chris', 'Jenny', 'Ryan', 'Olivia', 'Kevin', 'Sophie', 'Brian', 'Amanda', 'Jason', 'Nicole', 'Derek', 'Laura', 'Eric', 'Megan', 'Sean', 'Katie', 'Adam', 'Lauren', 'Nathan', 'Julia', 'Aaron', 'Stephanie', 'Ben', 'Hannah', 'Tyler', 'Emily', 'Zach', 'Alyssa', 'Sam', 'Brooke', 'Jake', 'Morgan', 'Dylan', 'Paige', 'Evan', 'Courtney', 'Blake', 'Haley', 'Cody', 'Samantha'];

const LAST_NAMES = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson', 'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin', 'Lee', 'Perez', 'Thompson', 'White', 'Harris', 'Sanchez', 'Clark', 'Ramirez', 'Lewis', 'Robinson', 'Walker', 'Young', 'Allen', 'King', 'Wright', 'Scott', 'Torres', 'Nguyen', 'Hill', 'Flores', 'Green', 'Adams', 'Nelson', 'Baker', 'Hall', 'Rivera', 'Campbell', 'Mitchell', 'Carter', 'Roberts'];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

let subCount = 0;
let batch = [];

for (const loc of US_CITIES) {
  for (let j = 0; j < 2; j++) {
    const firstName = pick(FIRST_NAMES);
    const lastName = pick(LAST_NAMES);
    batch.push({
      client_id: workspaceId,
      email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}${rand(1, 999)}@example.com`,
      first_name: firstName,
      last_name: lastName,
      phone: `+1${rand(200, 999)}${rand(100, 999)}${rand(1000, 9999)}`,
      country: 'US',
      region: loc.region,
      city: loc.city,
      postal_code: loc.postal,
      lat: loc.lat,
      lng: loc.lng,
      timezone: loc.tz,
      confirmed: true,
      health_score: pick(['active', 'active', 'active', 'at_risk', 'cold']),
      created_at: new Date(Date.now() - rand(1, 90) * 86400000).toISOString(),
    });
  }
}

// Batch insert subscribers
console.log(`Inserting ${batch.length} subscribers...`);
for (let i = 0; i < batch.length; i += 50) {
  const chunk = batch.slice(i, i + 50);
  try {
    const result = await sf('/subscribers', {
      method: 'POST',
      body: JSON.stringify(chunk),
      headers: { Prefer: 'return=representation' },
    });
    subCount += Array.isArray(result) ? result.length : 0;
  } catch (e) {
    // Skip dupes
  }
}
console.log(`Created ${subCount} subscribers`);

// Create campaigns
const CAMPAIGNS = [
  { title: 'Welcome to Veloce', subject: 'Get started with audience ownership', sent: 5432, opened: 2168, clicked: 365, days_ago: 60 },
  { title: 'Weekly Tech Roundup', subject: "This week's best stories", sent: 4800, opened: 1584, clicked: 240, days_ago: 45 },
  { title: 'South Congress Sale', subject: 'Your neighborhood deal is waiting', sent: 1247, opened: 387, clicked: 89, days_ago: 30 },
  { title: 'Product Launch', subject: 'Introducing our newest feature', sent: 8100, opened: 3402, clicked: 612, days_ago: 21 },
  { title: 'East Side Workshop', subject: 'Learn something new this weekend', sent: 312, opened: 134, clicked: 28, days_ago: 14 },
  { title: 'Summer Campaign', subject: 'Hot deals for the season', sent: 2800, opened: 868, clicked: 156, days_ago: 7 },
  { title: 'Holiday Special', subject: 'Limited-time holiday offer (draft)', sent: 0, opened: 0, clicked: 0, days_ago: 0, draft: true },
];

let campCount = 0;
for (const c of CAMPAIGNS) {
  const createdAt = new Date(Date.now() - c.days_ago * 86400000).toISOString();
  try {
    await sf('/campaigns', {
      method: 'POST',
      body: JSON.stringify({
        client_id: workspaceId,
        title: c.title,
        subject: c.subject,
        status: c.draft ? 'draft' : 'sent',
        sent_count: c.sent,
        open_count: c.opened,
        click_count: c.clicked,
        editor_html: `<div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:24px;border:3px solid #0a0a0a"><h1 style="font-size:24px;text-transform:uppercase">${c.title}</h1><p style="font-size:14px;color:#555">${c.subject}</p><hr style="border:none;border-top:2px solid #0a0a0a;margin:16px 0" /><p style="font-size:14px">This is a demo campaign.</p></div>`,
        created_at: createdAt,
      }),
      headers: { Prefer: 'return=representation' },
    });
    campCount++;
  } catch (e) {
    console.error('Campaign failed:', c.title, e.message);
  }
}

console.log(`Created ${campCount} campaigns`);
console.log('\nDone! Log in at https://newsletter.brod3000.com/login with demo@veloce.app / demo123456');
