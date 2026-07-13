/**
 * Smart Auto-Tagging Automation
 *
 * Applies tags based on subscriber behavior patterns.
 * Runs every 3 hours via cron.
 *
 * Rules:
 * - engaged: opened 3 of last 5 campaigns
 * - clicker: clicked any link ever
 * - slipping: no opens in 14+ days
 * - weekend-reader: last open was Sat/Sun
 * - mobile: last open user_agent contains "Mobile"
 */

export async function runSmartTags() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) return { error: "Missing env vars" };

  const auth = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, "Content-Type": "application/json" };
  const now = new Date();
  const fiveCampaignsAgo = new Date(now.getTime() - 45 * 86400000).toISOString();
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 86400000).toISOString();

  let tagged = 0;

  try {
    // Get all subscribers for tag evaluation
    const subsRes = await fetch(
      `${supabaseUrl}/rest/v1/subscribers?select=id,client_id,email,user_agent&limit=10000`,
      { headers: auth }
    );
    const subscribers = await subsRes.json();
    if (!Array.isArray(subscribers)) return { error: "Failed to fetch subscribers" };

    // Get recent campaign events for engagement analysis
    const eventsRes = await fetch(
      `${supabaseUrl}/rest/v1/campaign_events?select=subscriber_id,event_type,occurred_at&occurred_at=gt.${encodeURIComponent(fiveCampaignsAgo)}&limit=50000`,
      { headers: auth }
    );
    const events = await eventsRes.json();
    if (!Array.isArray(events)) return { error: "Failed to fetch events" };

    // Build per-subscriber engagement data
    const subData = new Map();
    for (const sub of subscribers) {
      subData.set(sub.id, { opens: 0, clicks: 0, lastOpen: null, lastClick: null, userAgent: sub.user_agent, clientId: sub.client_id });
    }
    for (const e of events) {
      const d = subData.get(e.subscriber_id);
      if (!d) continue;
      if (e.event_type === "open") { d.opens++; if (!d.lastOpen || e.occurred_at > d.lastOpen) d.lastOpen = e.occurred_at; }
      if (e.event_type === "click") { d.clicks++; if (!d.lastClick || e.occurred_at > d.lastClick) d.lastClick = e.occurred_at; }
    }

    for (const [subId, d] of subData) {
      const tags = [];
      if (d.opens >= 3) tags.push("engaged");
      if (d.clicks >= 1) tags.push("clicker");
      if (!d.lastOpen || new Date(d.lastOpen) < new Date(fourteenDaysAgo)) tags.push("slipping");
      if (d.lastOpen) {
        const day = new Date(d.lastOpen).getDay();
        if (day === 0 || day === 6) tags.push("weekend-reader");
      }
      if (d.userAgent?.toLowerCase().includes("mobile")) tags.push("mobile");

      for (const tag of tags) {
        // Upsert tag (ignore if already exists)
        await fetch(`${supabaseUrl}/rest/v1/subscriber_tags`, {
          method: "POST",
          headers: { ...auth, Prefer: "resolution=ignore-duplicates" },
          body: JSON.stringify({ subscriber_id: subId, client_id: d.clientId, tag }),
        });
        tagged++;
      }
    }

    return { tagged, evaluated: subscribers.length };
  } catch (e) {
    return { error: e?.message };
  }
}
