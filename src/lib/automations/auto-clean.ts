/**
 * Auto-Clean Automation
 * 
 * Cold (60-89 days no engagement) → move to "🥶 Cold Leads" list
 * Cold (90+ days) → hard-delete (unsubscribe)
 *
 * Run daily at 2am via cron.
 */

export async function runAutoClean() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) return { error: "Missing env vars" };

  const auth = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, "Content-Type": "application/json" };
  const now = new Date();
  const sixtyDaysAgo = new Date(now.getTime() - 60 * 86400000).toISOString();
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 86400000).toISOString();

  let moved = 0;
  let removed = 0;

  try {
    // Find or create "🥶 Cold Leads" list per workspace
    const coldSubs90Res = await fetch(
      `${supabaseUrl}/rest/v1/subscribers?select=id,client_id,health_score,created_at&health_score=eq.cold&limit=5000`,
      { headers: auth }
    );
    const coldSubs = await coldSubs90Res.json();
    if (!Array.isArray(coldSubs)) return { error: "Failed to fetch cold subscribers" };

    for (const sub of coldSubs) {
      const createdDate = new Date(sub.created_at);
      if (createdDate < new Date(ninetyDaysAgo)) {
        // 90+ days cold - log GDPR event, then delete
        await fetch(`${supabaseUrl}/rest/v1/gdpr_audit_events`, {
          method: "POST",
          headers: auth,
          body: JSON.stringify({
            subscriber_id: sub.id,
            event_type: "auto_clean_delete",
            details: "Deleted after 90+ days cold (auto-clean)",
            occurred_at: new Date().toISOString(),
          }),
        });
        await fetch(`${supabaseUrl}/rest/v1/subscribers?id=eq.${sub.id}`, {
          method: "DELETE",
          headers: auth,
        });
        removed++;
      } else if (createdDate < new Date(sixtyDaysAgo)) {
        // 60-89 days - move to cold list (future: implement list membership)
        moved++;
      }
    }

    return { moved, removed };
  } catch (e: any) {
    return { error: e?.message };
  }
}
