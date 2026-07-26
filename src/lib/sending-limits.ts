/**
 * Sending limit enforcement for newsletter-core.
 *
 * The check and the increment happen together, inside the database, in
 * increment_sending_counters() (migration 045). Everything this module used to
 * do in Node — read the counters, compare, increment separately — was both racy
 * and, because the RPC it called did not exist, entirely inert.
 *
 * The failure mode is closed. A quota exists to stop sends; a version of it that
 * waves sends through whenever it cannot run is not a quota — that was the
 * previous behaviour, and it is what made the control inert.
 *
 * The single exception is the function being absent (PGRST202), which can only
 * mean migration 045 has not been applied to this database yet. That degrades to
 * unenforced-and-loudly-logged so the code and the migration can be deployed in
 * either order without taking sending down in between.
 */

import { logError } from "@/lib/logger";

/** Thrown when a send would exceed the workspace's quota, or cannot be checked. */
export class SendingLimitError extends Error {
  constructor(
    message: string,
    readonly reason: string,
  ) {
    super(message);
    this.name = "SendingLimitError";
  }
}

interface QuotaRow {
  allowed: boolean;
  reason: string | null;
  remaining: number | null;
}

function describe(reason: string, remaining: number | null): string {
  switch (reason) {
    case "monthly_limit":
      return `Monthly sending limit reached. You can send ${remaining ?? 0} more emails this period. Upgrade or wait for the limit to reset.`;
    case "lifetime_limit":
      return `Lifetime sending limit reached. You can send ${remaining ?? 0} more emails total. Upgrade to increase your limit.`;
    case "workspace_not_found":
      return "This workspace no longer exists.";
    case "invalid_count":
      return "Invalid recipient count for this send.";
    default:
      return "This send exceeds the workspace's sending limit.";
  }
}

/**
 * Consume `requestedCount` from the workspace's sending quota.
 * Throws SendingLimitError if the send would exceed it, or if the quota cannot
 * be evaluated. Returns the remaining monthly headroom (null when uncapped).
 *
 * Quota is consumed up front, against the real recipient count. Recipients that
 * later fail to send are not refunded — deliberately conservative for an abuse
 * control, but it does mean a badly failing send still spends quota. Worth
 * revisiting alongside per-recipient reconciliation in the send queue.
 */
export async function checkSendingLimit(
  supabase: ReturnType<typeof import("@/lib/supabase").getSupabaseClient>,
  workspaceId: string,
  requestedCount: number,
): Promise<number | null> {
  const { data, error } = await supabase.rpc("increment_sending_counters", {
    p_workspace_id: workspaceId,
    p_count: requestedCount,
  });

  if (error) {
    // PGRST202 is PostgREST's "no such function in the schema cache". The only
    // realistic way to reach it here is deployment skew — this code live before
    // migration 045 is applied — so it degrades to unenforced for that one case
    // rather than rejecting every send in the window between the two deploys.
    //
    // Deliberately narrow. Any other failure (permissions, timeout, bad
    // argument, connection loss) still fails closed: a quota that waves sends
    // through whenever it cannot run is not a quota, and that is precisely the
    // bug this module was written to fix.
    if (error.code === "PGRST202") {
      logError(error, {
        scope: "sending-limits",
        degraded: true,
        workspaceId,
        detail:
          "increment_sending_counters is missing — apply migration " +
          "045_atomic_sending_counters.sql. Sending limits are NOT enforced until then.",
      });
      return null;
    }

    logError(error, { scope: "sending-limits", workspaceId, requestedCount });
    throw new SendingLimitError(
      "Sending limits could not be verified, so the send was not started.",
      "check_failed",
    );
  }

  // RETURNS TABLE arrives as an array of rows.
  const row = (Array.isArray(data) ? data[0] : data) as QuotaRow | undefined;

  if (!row) {
    logError(new Error("increment_sending_counters returned no row"), {
      scope: "sending-limits",
      workspaceId,
    });
    throw new SendingLimitError(
      "Sending limits could not be verified, so the send was not started.",
      "check_failed",
    );
  }

  if (!row.allowed) {
    throw new SendingLimitError(describe(row.reason ?? "", row.remaining), row.reason ?? "unknown");
  }

  return row.remaining ?? null;
}
