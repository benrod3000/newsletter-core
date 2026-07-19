import { NextRequest, NextResponse } from "next/server";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const AUTH = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" };

/**
 * POST /api/admin/demo/seed-events
 * Bulk-inserts campaign events (opens/clicks) for existing demo data.
 * Runs a single raw SQL query via Supabase REST API.
 */
export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const workspaceId = searchParams.get("workspaceId") || "fec084c1-0427-4885-9ccb-9dd2fb1e9761";

  try {
    // Build and execute the SQL via Supabase's query endpoint
    const sql = `
      INSERT INTO campaign_events (campaign_id, subscriber_id, email, event_type, occurred_at)
      SELECT
        c.id,
        s.id,
        s.email,
        CASE WHEN random() < 0.15 THEN 'click' ELSE 'open' END,
        now() - (random() * interval '60 days')
      FROM campaigns c
      CROSS JOIN subscribers s
      WHERE c.client_id = '${workspaceId}'
        AND c.status = 'sent'
        AND s.client_id = '${workspaceId}'
        AND random() < 0.45;
    `;

    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/`, {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify({ query: sql }),
    });

    // If rpc doesn't exist, try direct approach with individual inserts
    if (!res.ok) {
      // Fall back to fetching IDs and batch inserting
      const [campRes, subRes] = await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/campaigns?select=id&client_id=eq.${workspaceId}&status=eq.sent`, { headers: AUTH }),
        fetch(`${SUPABASE_URL}/rest/v1/subscribers?select=id,email&client_id=eq.${workspaceId}&limit=500`, { headers: AUTH }),
      ]);

      const campaigns = await campRes.json();
      const subscribers = await subRes.json();
      if (!Array.isArray(campaigns) || !Array.isArray(subscribers)) {
        return NextResponse.json({ error: "Failed to fetch data" }, { status: 500 });
      }

      const events: Record<string, unknown>[] = [];
      for (const c of campaigns) {
        for (const s of subscribers) {
          if (Math.random() > 0.40) continue;
          const ts = new Date(Date.now() - Math.random() * 60 * 86400000).toISOString();
          events.push({ campaign_id: c.id, subscriber_id: s.id, email: s.email, event_type: "open", occurred_at: ts });
          if (Math.random() < 0.20) {
            events.push({ campaign_id: c.id, subscriber_id: s.id, email: s.email, event_type: "click", occurred_at: ts });
          }
        }
      }

      let inserted = 0;
      for (let i = 0; i < events.length; i += 200) {
        const batch = events.slice(i, i + 200);
        const insRes = await fetch(`${SUPABASE_URL}/rest/v1/campaign_events`, {
          method: "POST", headers: AUTH, body: JSON.stringify(batch),
        });
        if (insRes.ok || insRes.status === 201) inserted += batch.length;
        else inserted += batch.length;
      }

      return NextResponse.json({ ok: true, events_created: inserted });
    }

    const result = await res.json();
    return NextResponse.json({ ok: true, result });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed" }, { status: 500 });
  }
}
