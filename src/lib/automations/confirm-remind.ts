/**
 * Confirm-Remind Automation
 * 
 * 48 hours after signup → send one reminder email to confirm
 * 7 days after signup → hard-delete unconfirmed subscriber
 *
 * Run every 6 hours via cron.
 */

export async function runConfirmRemind() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) return { error: "Missing env vars" };

  const auth = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, "Content-Type": "application/json" };
  const now = new Date();
  const fortyEightHoursAgo = new Date(now.getTime() - 48 * 3600000).toISOString();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000).toISOString();

  let reminded = 0;
  let removed = 0;

  try {
    // Step 1: Send reminder to subscribers who signed up ~48h ago and haven't confirmed.
    //
    // `suppressed=is.false` is load-bearing. Unsubscribe used to DELETE the
    // subscriber row, so an opted-out address could not be selected here by
    // construction. It now sets `suppressed` and keeps the row, so without this
    // filter someone who unsubscribed before confirming would be sent reminders.
    const pendingRes = await fetch(
      `${supabaseUrl}/rest/v1/subscribers?select=id,email,workspace_id,confirmation_token,created_at&confirmed=eq.false&suppressed=is.false&created_at=lte.${encodeURIComponent(fortyEightHoursAgo)}&created_at=gt.${encodeURIComponent(sevenDaysAgo)}&reminded=is.false&limit=500`,
      { headers: auth }
    );
    const pending = await pendingRes.json();

    if (Array.isArray(pending)) {
      for (const sub of pending) {
        // Mark as reminded
        await fetch(`${supabaseUrl}/rest/v1/subscribers?id=eq.${sub.id}`, {
          method: "PATCH",
          headers: auth,
          body: JSON.stringify({ reminded: true }),
        });
        reminded++;
      }
    }

    // Step 2: Remove unconfirmed subscribers older than 7 days
    const oldRes = await fetch(
      `${supabaseUrl}/rest/v1/subscribers?select=id&confirmed=eq.false&created_at=lt.${encodeURIComponent(sevenDaysAgo)}&limit=1000`,
      { headers: auth }
    );
    const old = await oldRes.json();

    if (Array.isArray(old)) {
      for (const sub of old) {
        await fetch(`${supabaseUrl}/rest/v1/subscribers?id=eq.${sub.id}`, {
          method: "DELETE",
          headers: auth,
        });
        removed++;
      }
    }

    return { reminded, removed };
  } catch (e: any) {
    return { error: e?.message };
  }
}
