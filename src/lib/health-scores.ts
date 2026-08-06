/**
 * Health score recalculation. Runs daily via cron.
 *
 * Rules, which the code and the previous docstring disagreed about:
 * - active   engaged within 30 days, or subscribed within 30 days
 * - at_risk  last engaged 30-60 days ago
 * - cold     last engaged 60+ days ago, or never engaged and subscribed 30+
 *            days ago
 *
 * WHY THIS WAS REWRITTEN
 *
 * It only ever scored the first ~3,000 subscribers, permanently. Measured
 * against production: 3,008 scored, 7,294 null, out of 10,302.
 *
 * The read loop paginated correctly; the write did not. Every subscriber got its
 * own sequential `PATCH`, so a full run needed one HTTP round trip per person.
 * At 10,000+ subscribers that cannot finish inside the function budget, and the
 * route set no `maxDuration`. The job timed out partway, and because it starts
 * from the beginning every night it re-scored the same first few thousand and
 * never once reached the rest.
 *
 * Nothing surfaced the failure. It returned `{ updated, total }` from a variable
 * incremented inside the loop, so a run that died two thirds of the way through
 * simply never returned at all, and the cron logged a timeout that nobody read.
 *
 * Now: subscribers are grouped by the score they should have and updated with
 * one statement per score per chunk - three statements per 500 subscribers
 * rather than 500. A full run is roughly 60 requests instead of 10,300.
 *
 * SAFETY NOTE
 *
 * `cold` is the default for anyone with no engagement events, so a workspace
 * with no campaign history scores everyone cold once they pass 30 days. That
 * matters because auto-clean deletes cold subscribers: see the guard in
 * `automations/auto-clean.ts`, which refuses to act on a partially-scored
 * population or one with no engagement history. Do not remove it.
 */
import { getSupabaseClient } from "@/lib/supabase";
import { fetchAllRows } from "@/lib/paginate";
import { logError, logWarn } from "@/lib/logger";

export type HealthScore = "active" | "at_risk" | "cold";

/** Subscribers per UPDATE statement. Matches the CSV import's batch size. */
const BATCH = 500;

export interface HealthScoreResult {
  scored: number;
  total: number;
  error?: string;
}

/** The score a subscriber earns. Pure, so the rules are directly testable. */
export function scoreFor(
  lastEngagedAt: string | null,
  createdAt: string,
  now: number
): HealthScore {
  const thirtyDaysAgo = new Date(now - 30 * 86_400_000).toISOString();
  const sixtyDaysAgo = new Date(now - 60 * 86_400_000).toISOString();

  if (lastEngagedAt) {
    if (lastEngagedAt >= thirtyDaysAgo) return "active";
    if (lastEngagedAt >= sixtyDaysAgo) return "at_risk";
    return "cold";
  }

  // Never engaged. A new subscriber has not had the chance yet, so they are not
  // penalised for it; past that they are indistinguishable from disengaged.
  return createdAt >= thirtyDaysAgo ? "active" : "cold";
}

export async function recalculateHealthScores(): Promise<HealthScoreResult> {
  const supabase = getSupabaseClient();
  const now = Date.now();
  const sixtyDaysAgo = new Date(now - 60 * 86_400_000).toISOString();

  try {
    const subscribers = await fetchAllRows((afterId, pageSize) => {
      let q = supabase
        .from("subscribers")
        .select("id, created_at")
        .order("id", { ascending: true })
        .limit(pageSize);
      if (afterId) q = q.gt("id", afterId);
      return q;
    });

    if (subscribers.length === 0) return { scored: 0, total: 0 };

    // Only events inside the widest band that changes an answer. Anything older
    // than 60 days produces `cold` either way.
    const events = await fetchAllRows((afterId, pageSize) => {
      let q = supabase
        .from("campaign_events")
        .select("id, subscriber_id, occurred_at")
        .in("event_type", ["open", "click"])
        .gte("occurred_at", sixtyDaysAgo)
        .order("id", { ascending: true })
        .limit(pageSize);
      if (afterId) q = q.gt("id", afterId);
      return q;
    });

    const lastEngaged = new Map<string, string>();
    for (const e of events) {
      if (!e.subscriber_id || !e.occurred_at) continue;
      const seen = lastEngaged.get(e.subscriber_id);
      if (!seen || e.occurred_at > seen) lastEngaged.set(e.subscriber_id, e.occurred_at);
    }

    // Grouped by target score, so each chunk costs one statement per distinct
    // score rather than one per subscriber.
    const byScore = new Map<HealthScore, string[]>([
      ["active", []],
      ["at_risk", []],
      ["cold", []],
    ]);

    for (const sub of subscribers) {
      const score = scoreFor(lastEngaged.get(sub.id) ?? null, sub.created_at, now);
      byScore.get(score)!.push(sub.id);
    }

    let scored = 0;
    for (const [score, ids] of byScore) {
      for (let i = 0; i < ids.length; i += BATCH) {
        const chunk = ids.slice(i, i + BATCH);
        const { data, error } = await supabase
          .from("subscribers")
          .update({ health_score: score })
          .in("id", chunk)
          .select("id");

        if (error) {
          // Returned rather than swallowed. A partial run is the failure mode
          // this rewrite exists to eliminate, so it must be visible.
          logError(error, { action: "health-scores.update", score, chunkStart: i });
          return { scored, total: subscribers.length, error: error.message };
        }
        scored += data?.length ?? 0;
      }
    }

    if (scored !== subscribers.length) {
      logWarn(`[health-scores] scored ${scored} of ${subscribers.length}`);
    }

    return { scored, total: subscribers.length };
  } catch (err) {
    logError(err, { action: "health-scores" });
    return { scored: 0, total: 0, error: err instanceof Error ? err.message : "failed" };
  }
}
