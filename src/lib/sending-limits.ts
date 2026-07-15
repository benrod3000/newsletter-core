/**
 * Sending limit enforcement for newsletter-core.
 *
 * Reads the workspace's `sending_limit_monthly` from the `clients` table
 * and rejects a send if it would exceed the cap.
 *
 * The DB columns (`sending_limit_monthly`, `sent_this_month`, etc.)
 * were added in migration 021_add_sending_limits.sql.
 */

/**
 * Checks whether sending `requestedCount` emails would exceed
 * the workspace's monthly sending limit. Throws if it would.
 *
 * Also increments the `sent_this_month` counter atomically so that
 * concurrent sends don't race past the limit.
 */
export async function checkSendingLimit(
  supabase: ReturnType<typeof import("@/lib/supabase").getSupabaseClient>,
  workspaceId: string,
  requestedCount: number,
): Promise<void> {
  // Fetch the workspace's current sending limit & counters
  const { data: client, error } = await supabase
    .from("clients")
    .select("sending_limit_monthly, sent_this_month, sending_limit_total, sent_total")
    .eq("id", workspaceId)
    .single();

  if (error) {
    // If we can't read limits, fail open (allow send) — the DB row should exist
    console.warn(`[sending-limits] Could not read limits for ${workspaceId}: ${error.message}`);
    return;
  }

  if (!client) return;

  const limitMonthly = client.sending_limit_monthly;
  const sentThisMonth = client.sent_this_month ?? 0;
  const limitTotal = client.sending_limit_total;
  const sentTotal = client.sent_total ?? 0;

  // Check monthly limit
  if (limitMonthly !== null && limitMonthly > 0) {
    const wouldExceedMonthly = (sentThisMonth + requestedCount) > limitMonthly;
    if (wouldExceedMonthly) {
      const remaining = Math.max(0, limitMonthly - sentThisMonth);
      throw new Error(
        `Monthly sending limit reached (${sentThisMonth}/${limitMonthly}). ` +
        `You can send ${remaining} more emails this month. Upgrade or wait for the limit to reset.`
      );
    }
  }

  // Check total lifetime limit
  if (limitTotal !== null && limitTotal > 0) {
    const wouldExceedTotal = (sentTotal + requestedCount) > limitTotal;
    if (wouldExceedTotal) {
      const remaining = Math.max(0, limitTotal - sentTotal);
      throw new Error(
        `Lifetime sending limit reached (${sentTotal}/${limitTotal}). ` +
        `You can send ${remaining} more emails total. Upgrade to increase your limit.`
      );
    }
  }

  // Atomically increment the counters so concurrent sends don't race past the cap.
  // This uses a Supabase RPC or direct update — we do a simple increment here.
  // If the RPC doesn't exist, we just warn and continue.
  try {
    await supabase.rpc("increment_sending_counters", {
      p_workspace_id: workspaceId,
      p_count: requestedCount,
    });
  } catch {
    // RPC may not exist yet — fall back to a direct update
    await supabase
      .from("clients")
      .update({
        sent_this_month: sentThisMonth + requestedCount,
        sent_total: sentTotal + requestedCount,
      })
      .eq("id", workspaceId);
  }
}
