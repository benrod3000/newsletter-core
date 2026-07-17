/**
 * Smart Auto-Tagging Automation
 */
import { logError } from "@/lib/logger";

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

    const batchUpserts: Array<{ subscriber_id: string; client_id: string; tag: string }> = [];

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
        batchUpserts.push({ subscriber_id: subId, client_id: d.clientId, tag });
        tagged++;
      }
    }

    // Bulk upsert tags in batches of 100 to avoid rate limits
    const batchSize = 100;
    for (let i = 0; i < batchUpserts.length; i += batchSize) {
      const batch = batchUpserts.slice(i, i + batchSize);
      await fetch(`${supabaseUrl}/rest/v1/subscriber_tags`, {
        method: "POST",
        headers: { ...auth, Prefer: "resolution=ignore-duplicates" },
        body: JSON.stringify(batch),
      });
    }

    return { tagged, evaluated: subscribers.length };
  } catch (e: any) {
    logError(e, { action: 'smart-tags-global' })
    return { error: e?.message };
  }
}

/**
 * Workspace-scoped smart tag evaluation.
 * Same logic as runSmartTags(), but filtered to a single workspace.
 * Called from the Settings dashboard ("Run Now" button).
 */
export async function runSmartTagsForWorkspace(workspaceId: string) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) return { error: "Missing env vars" };

  const auth = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, "Content-Type": "application/json" };
  const now = new Date();
  const fiveCampaignsAgo = new Date(now.getTime() - 45 * 86400000).toISOString();
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 86400000).toISOString();

  let tagged = 0;

  try {
    // Get subscribers for this workspace only
    const subsRes = await fetch(
      `${supabaseUrl}/rest/v1/subscribers?select=id,client_id,email,user_agent&client_id=eq.${workspaceId}&limit=10000`,
      { headers: auth }
    );
    const subscribers = await subsRes.json();
    if (!Array.isArray(subscribers)) return { error: "Failed to fetch subscribers" };

    if (subscribers.length === 0) return { tagged: 0, evaluated: 0 };

    // Get IDs for the subscriber query
    const subIds = subscribers.map((s: any) => s.id).join(",");

    // Get recent campaign events for this workspace's subscribers
    let events: any[] = [];
    try {
      const eventsRes = await fetch(
        `${supabaseUrl}/rest/v1/campaign_events?select=subscriber_id,event_type,occurred_at&occurred_at=gt.${encodeURIComponent(fiveCampaignsAgo)}&subscriber_id=in.(${subIds})&limit=50000`,
        { headers: auth }
      );
      if (eventsRes.ok) {
        const eventsData = await eventsRes.json();
        if (Array.isArray(eventsData)) events = eventsData;
      }
    } catch {
      // campaign_events table may not exist
    }

    // Build per-subscriber engagement data
    const subData = new Map();
    for (const sub of subscribers) {
      subData.set(sub.id, { opens: 0, clicks: 0, lastOpen: null, lastClick: null, userAgent: sub.user_agent });
    }
    for (const e of events) {
      const d = subData.get(e.subscriber_id);
      if (!d) continue;
      if (e.event_type === "open") { d.opens++; if (!d.lastOpen || e.occurred_at > d.lastOpen) d.lastOpen = e.occurred_at; }
      if (e.event_type === "click") { d.clicks++; if (!d.lastClick || e.occurred_at > d.lastClick) d.lastClick = e.occurred_at; }
    }

    const batchUpserts: Array<{ subscriber_id: string; client_id: string; tag: string }> = [];

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
        batchUpserts.push({ subscriber_id: subId, client_id: workspaceId, tag });
        tagged++;
      }
    }

    // Bulk upsert tags in batches of 100
    const batchSize = 100;
    for (let i = 0; i < batchUpserts.length; i += batchSize) {
      const batch = batchUpserts.slice(i, i + batchSize);
      try {
        await fetch(`${supabaseUrl}/rest/v1/subscriber_tags`, {
          method: "POST",
          headers: { ...auth, Prefer: "resolution=ignore-duplicates" },
          body: JSON.stringify(batch),
        });
      } catch {
        // subscriber_tags table may not exist
      }
    }

    return { tagged, evaluated: subscribers.length };
  } catch (e: any) {
    logError(e, { action: 'smart-tags-workspace', workspaceId })
    return { error: e?.message };
  }
}
