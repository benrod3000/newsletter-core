import { getSupabaseClient } from "@/lib/supabase";
import { logError, logWarn } from "@/lib/logger";
import { fetchAllRows } from "@/lib/paginate";
import {
  sendConfirmationEmail,
  EMPTY_SIGNUP_SNAPSHOT,
} from "@/lib/email/confirmation-email";

/**
 * Confirm-remind: nudge people who signed up but never confirmed, then let the
 * ones who never do fall away.
 *
 * This file previously did neither of those things correctly, and the gap
 * between its name and its behaviour was the whole problem.
 *
 *   1. IT SENT NO EMAIL. There were no imports and no send call anywhere in the
 *      file. It selected `email` and `confirmation_token`, used neither, set
 *      `reminded = true` and incremented a counter called `reminded`. The
 *      selecting query filters on `reminded = false`, so marking was one-way:
 *      the single reminder each person was owed was consumed, having sent
 *      nothing, and could never be sent again.
 *
 *   2. IT THEN DELETED THEM. Step two hard-deletes every unconfirmed subscriber
 *      older than seven days, on a daily cron. So the sequence was: silently
 *      spend the reminder, wait five days, delete the person.
 *
 *   3. STEP TWO IGNORED SUPPRESSION. Step one filters `suppressed = false` and
 *      carries a comment explaining why that is load-bearing. Step two had no
 *      such filter, so it deleted the opt-out records of people who unsubscribed
 *      before confirming - and a deleted suppression does not survive a
 *      re-import, which is the exact property the unsubscribe rework existed to
 *      protect.
 *
 *   4. NOTHING WAS CHECKED. Every fetch response was ignored while `reminded++`
 *      and `removed++` ran regardless, so the route reported work it had not
 *      done. Both loops were also one HTTP round trip per row, the shape that
 *      already timed out once in the health-score cron.
 *
 * It was latent rather than actively destructive only because production has no
 * unconfirmed subscribers. It arms the moment anyone adds a contact by hand:
 * `POST /api/clients/[workspaceId]/subscribers` inserts `confirmed: false`.
 */

/** Reminder goes out this long after signup. */
const REMIND_AFTER_MS = 48 * 3600_000;
/** Unconfirmed signups are removed after this long. */
const REMOVE_AFTER_MS = 7 * 86400_000;

/**
 * Per-run ceiling on reminder emails.
 *
 * Each one is an API call to a provider, inside a function with a wall-clock
 * limit. Bounded so a backlog drains over several days instead of timing out
 * partway and leaving the marked-but-unsent state this function used to create
 * by design.
 */
const MAX_REMINDERS_PER_RUN = 200;

interface PendingRow {
  id: string;
  email: string;
  workspace_id: string;
  confirmation_token: string;
  unsubscribe_token: string;
}

export interface ConfirmRemindResult {
  reminded: number;
  remindFailed: number;
  removed: number;
  error?: string;
}

export async function runConfirmRemind(baseUrl: string): Promise<ConfirmRemindResult> {
  const supabase = getSupabaseClient();
  const now = Date.now();
  const remindBefore = new Date(now - REMIND_AFTER_MS).toISOString();
  const removeBefore = new Date(now - REMOVE_AFTER_MS).toISOString();

  let reminded = 0;
  let remindFailed = 0;
  let removed = 0;

  try {
    // --- Step 1: remind ---

    const { data: pending, error: pendingError } = await supabase
      .from("subscribers")
      .select("id, email, workspace_id, confirmation_token, unsubscribe_token")
      .eq("confirmed", false)
      .eq("suppressed", false)
      .eq("reminded", false)
      .lte("created_at", remindBefore)
      .gt("created_at", removeBefore)
      .limit(MAX_REMINDERS_PER_RUN);

    if (pendingError) {
      // Checked, unlike before. supabase-js resolves errors rather than
      // throwing, so an unchecked failure here reported a clean run over work
      // that never happened.
      logError(pendingError, { scope: "confirm-remind.pending" });
      return { reminded: 0, remindFailed: 0, removed: 0, error: pendingError.message };
    }

    const rows = (pending ?? []) as PendingRow[];

    // Workspace names, for an email that says what the person signed up to.
    // Fetched once rather than per recipient.
    const workspaceNames = await loadWorkspaceNames(
      supabase,
      [...new Set(rows.map((r) => r.workspace_id))]
    );

    for (const sub of rows) {
      const result = await sendConfirmationEmail({
        email: sub.email,
        confirmationToken: sub.confirmation_token,
        unsubscribeToken: sub.unsubscribe_token,
        // From the request, never APP_URL: that points at the frontend, and
        // /api/confirm lives on this service. A reminder built from APP_URL
        // carries a confirmation link that 404s.
        baseUrl,
        leadTitle: null,
        leadUrl: null,
        snapshot: EMPTY_SIGNUP_SNAPSHOT,
        audienceName: workspaceNames.get(sub.workspace_id) ?? null,
      });

      if (!result.sent) {
        // The reminder flag is NOT set. This is the whole correction: the flag
        // records that a reminder was delivered, so setting it after a failure
        // spends the person's one reminder on nothing and guarantees they are
        // deleted five days later having never heard from us.
        remindFailed++;
        logWarn("confirm-remind: reminder not sent", {
          subscriberId: sub.id,
          workspaceId: sub.workspace_id,
          reason: result.reason,
        });
        continue;
      }

      const { error: markError } = await supabase
        .from("subscribers")
        .update({ reminded: true })
        .eq("id", sub.id);

      if (markError) {
        // Sent but not marked. The next run will send a second reminder, which
        // is mildly annoying and strictly better than the alternative of
        // marking without sending.
        logError(markError, { scope: "confirm-remind.mark", subscriberId: sub.id });
        remindFailed++;
        continue;
      }

      reminded++;
    }

    // --- Step 2: remove ---

    /*
     * `suppressed = false` is the important filter here, and its absence was a
     * real defect rather than an oversight in style.
     *
     * A suppressed row is an opt-out record. Deleting it does not just lose
     * history: it means the address can be re-imported and mailed again, because
     * nothing remains to say it opted out. Every other path that touches
     * suppressed rows was corrected for this; this one was missed because it
     * deletes rather than sends, so it never appeared in an audit of senders.
     */
    const doomed = await fetchAllRows<{ id: string }>((afterId, pageSize) => {
      let q = supabase
        .from("subscribers")
        .select("id")
        .eq("confirmed", false)
        .eq("suppressed", false)
        .lt("created_at", removeBefore)
        .order("id", { ascending: true })
        .limit(pageSize);
      if (afterId) q = q.gt("id", afterId as string);
      return q;
    });

    if (doomed.length > 0) {
      // One statement, not one round trip per row. The previous loop issued a
      // DELETE per subscriber and counted every one as removed without looking
      // at the response.
      const { error: deleteError } = await supabase
        .from("subscribers")
        .delete()
        .in("id", doomed.map((d) => d.id));

      if (deleteError) {
        logError(deleteError, { scope: "confirm-remind.delete", count: doomed.length });
        return { reminded, remindFailed, removed: 0, error: deleteError.message };
      }
      removed = doomed.length;
    }

    return { reminded, remindFailed, removed };
  } catch (err) {
    logError(err, { scope: "confirm-remind" });
    return {
      reminded,
      remindFailed,
      removed,
      error: err instanceof Error ? err.message : "unknown",
    };
  }
}

async function loadWorkspaceNames(
  supabase: ReturnType<typeof getSupabaseClient>,
  ids: string[]
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (ids.length === 0) return names;

  const { data, error } = await supabase.from("clients").select("id, name").in("id", ids);
  if (error) {
    // Not fatal. The email falls back to generic wording rather than not being
    // sent at all.
    logError(error, { scope: "confirm-remind.workspaceNames" });
    return names;
  }
  for (const row of data ?? []) names.set(row.id, row.name);
  return names;
}
