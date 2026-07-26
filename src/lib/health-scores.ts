/**
 * Health score recalculation for subscribers.
 * Run daily via cron to classify subscribers as active, at_risk, or cold.
 *
 * Rules:
 * - Active: opened or clicked any campaign in the last 30 days
 * - At risk: no engagement in 30-60 days, but has some history before that
 * - Cold: no engagement in 60+ days, or never engaged and subscribed 60+ days ago
 */

export async function recalculateHealthScores() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    console.error("Missing Supabase env vars for health scores");
    return { error: "Missing env vars" };
  }

  const auth = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` };
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000).toISOString();
  const sixtyDaysAgo = new Date(now.getTime() - 60 * 86400000).toISOString();

  let updated = 0;

  try {
    // Paginate through all subscribers (1000 at a time)
    let offset = 0;
    const pageSize = 1000;
    let subscribers: any[] = [];

    while (true) {
      const subsRes = await fetch(
        `${supabaseUrl}/rest/v1/subscribers?select=id,created_at&limit=${pageSize}&offset=${offset}`,
        { headers: auth }
      );
      const page = await subsRes.json();
      if (!Array.isArray(page) || page.length === 0) break;
      subscribers = subscribers.concat(page);
      offset += pageSize;
      if (page.length < pageSize) break;
    }

    if (subscribers.length === 0) return { error: "No subscribers found" };

    // Get all campaign events (opens + clicks) for engagement lookup
    // Fetch in pages as well to avoid truncation
    const allEvents: any[] = [];
    let eventOffset = 0;
    const eventPageSize = 5000;

    while (true) {
      const eventsRes = await fetch(
        `${supabaseUrl}/rest/v1/campaign_events?select=subscriber_id,event_type,occurred_at&event_type=in.(open,click)&order=occurred_at.desc&limit=${eventPageSize}&offset=${eventOffset}`,
        { headers: auth }
      );
      const page = await eventsRes.json();
      if (!Array.isArray(page) || page.length === 0) break;
      allEvents.push(...page);
      eventOffset += eventPageSize;
      if (page.length < eventPageSize) break;
    }

    // Build engagement map: subscriber_id -> latest event date
    const engagement = new Map<string, string>();
    for (const e of allEvents) {
      if (!engagement.has(e.subscriber_id)) {
        engagement.set(e.subscriber_id, e.occurred_at);
      }
    }

    for (const sub of subscribers) {
      const lastEngaged = engagement.get(sub.id);
      let score = "cold";

      if (lastEngaged) {
        const engagedDate = new Date(lastEngaged);
        if (engagedDate >= new Date(thirtyDaysAgo)) {
          score = "active";
        } else if (engagedDate >= new Date(sixtyDaysAgo)) {
          score = "at_risk";
        }
      } else {
        // Never engaged - check if they subscribed recently
        const subDate = new Date(sub.created_at);
        if (subDate >= new Date(thirtyDaysAgo)) {
          score = "active"; // new subscriber, give them active status
        }
      }

      // PATCH the subscriber
      await fetch(`${supabaseUrl}/rest/v1/subscribers?id=eq.${sub.id}`, {
        method: "PATCH",
        headers: { ...auth, "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify({ health_score: score }),
      });
      updated++;
    }

    return { updated, total: subscribers.length };
  } catch (e: any) {
    console.error("Health score recalc error:", e?.message);
    return { error: e?.message };
  }
}
