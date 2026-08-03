/**
 * Smart auto-tagging.
 *
 * Derives engagement tags from campaign events and applies them to subscribers.
 *
 * This file previously held two near-identical ~100 line copies of the same
 * logic, differing only in whether a workspace filter was applied, and both had
 * the same three defects:
 *
 * 1. The global run fetched `/subscribers?select=...&limit=10000` with **no
 *    workspace filter at all**, then tagged across every tenant in one pass on
 *    service_role - bypassing the isolation the tenancy work established.
 *
 * 2. PostgREST caps responses at 1,000 rows (`max-rows`) whatever `limit` asks
 *    for, so against 10,300 subscribers the run evaluated 1,000 of them and
 *    reported success. Production shows exactly 1,000 tagged subscribers, all
 *    `slipping`, which is what led to this being reported as "not working".
 *
 * 3. Events were fetched with `limit=50000`, capped the same way, so engagement
 *    was under-counted even for the subscribers that were evaluated. That is why
 *    every surviving tag is `slipping`: with events missing, no subscriber
 *    reaches the open or click thresholds and they all look dormant.
 *
 * One implementation now, scoped to a workspace by construction, paging through
 * both reads.
 */
import { logError } from "@/lib/logger";
import { getSupabaseClient } from "@/lib/supabase";
import { fetchAllRows } from "@/lib/paginate";

/** Opens within the window needed to count as engaged. */
const ENGAGED_OPENS = 3;
/** Days of inactivity after which a subscriber is slipping. */
const SLIPPING_AFTER_DAYS = 14;
/** How far back engagement is evaluated. */
const WINDOW_DAYS = 45;

export interface SmartTagResult {
  tagged: number;
  evaluated: number;
  error?: string;
}

interface Engagement {
  opens: number;
  clicks: number;
  lastOpen: string | null;
  userAgent: string | null;
}

/** The tags a subscriber's engagement earns. Pure, so it is directly testable. */
export function tagsFor(e: Engagement, slippingBefore: string): string[] {
  const tags: string[] = [];

  if (e.opens >= ENGAGED_OPENS) tags.push("engaged");
  if (e.clicks >= 1) tags.push("clicker");
  if (!e.lastOpen || e.lastOpen < slippingBefore) tags.push("slipping");

  if (e.lastOpen) {
    const day = new Date(e.lastOpen).getUTCDay();
    if (day === 0 || day === 6) tags.push("weekend-reader");
  }
  if (e.userAgent?.toLowerCase().includes("mobile")) tags.push("mobile");

  return tags;
}

/**
 * Evaluate and tag one workspace.
 *
 * Exported so both the nightly cron and the dashboard's "Run Now" go through the
 * same code path; the cron simply calls it once per workspace.
 */
export async function runSmartTagsForWorkspace(workspaceId: string): Promise<SmartTagResult> {
  const supabase = getSupabaseClient();
  const now = Date.now();
  const windowStart = new Date(now - WINDOW_DAYS * 86_400_000).toISOString();
  const slippingBefore = new Date(now - SLIPPING_AFTER_DAYS * 86_400_000).toISOString();

  try {
    const subscribers = await fetchAllRows((afterId, pageSize) => {
      let q = supabase
        .from("subscribers")
        .select("id, user_agent")
        .eq("workspace_id", workspaceId)
        .order("id", { ascending: true })
        .limit(pageSize);
      if (afterId) q = q.gt("id", afterId);
      return q;
    });

    if (subscribers.length === 0) return { tagged: 0, evaluated: 0 };

    // Events are fetched for the whole workspace and joined in memory rather
    // than chunked by subscriber id. The old approach put 50 ids in a URL per
    // request, which is both more round trips and a URL-length hazard; a
    // workspace-scoped read with the same keyset walk is simpler and complete.
    const events = await fetchAllRows((afterId, pageSize) => {
      let q = supabase
        .from("campaign_events")
        .select("id, subscriber_id, event_type, occurred_at")
        .eq("workspace_id", workspaceId)
        .in("event_type", ["open", "click"])
        .gte("occurred_at", windowStart)
        .order("id", { ascending: true })
        .limit(pageSize);
      if (afterId) q = q.gt("id", afterId);
      return q;
    });

    const engagement = new Map<string, Engagement>(
      subscribers.map((s) => [s.id, { opens: 0, clicks: 0, lastOpen: null, userAgent: s.user_agent }])
    );

    for (const e of events) {
      if (!e.subscriber_id) continue;
      const d = engagement.get(e.subscriber_id);
      if (!d) continue;

      if (e.event_type === "open") {
        d.opens++;
        if (!d.lastOpen || e.occurred_at > d.lastOpen) d.lastOpen = e.occurred_at;
      } else if (e.event_type === "click") {
        d.clicks++;
      }
    }

    const rows: Array<{ subscriber_id: string; workspace_id: string; tag: string }> = [];
    for (const [subscriberId, e] of engagement) {
      for (const tag of tagsFor(e, slippingBefore)) {
        rows.push({ subscriber_id: subscriberId, workspace_id: workspaceId, tag });
      }
    }

    const BATCH = 500;
    for (let i = 0; i < rows.length; i += BATCH) {
      const { error } = await supabase
        .from("subscriber_tags")
        // The unique key is (subscriber_id, tag) - `subscriber_tags_subscriber_id_tag_key`,
        // verified against the database rather than assumed. workspace_id is not
        // part of it and does not need to be: a subscriber belongs to exactly one
        // workspace, so subscriber_id already implies it.
        .upsert(rows.slice(i, i + BATCH), {
          onConflict: "subscriber_id,tag",
          ignoreDuplicates: true,
        });

      // Reported rather than swallowed: a partial tagging run that claims
      // success is how this went unnoticed for as long as it did.
      if (error) {
        logError(error, { action: "smart-tags.upsert", workspaceId, batchStart: i });
        return { tagged: i, evaluated: subscribers.length, error: error.message };
      }
    }

    return { tagged: rows.length, evaluated: subscribers.length };
  } catch (err) {
    logError(err, { action: "smart-tags.workspace", workspaceId });
    return { tagged: 0, evaluated: 0, error: err instanceof Error ? err.message : "failed" };
  }
}

/**
 * Nightly run across every workspace.
 *
 * One workspace at a time, and one workspace's failure does not stop the rest.
 * Sequential on purpose: this is a background job with no deadline, and running
 * tenants concurrently would multiply load on a shared database for no benefit.
 */
export async function runSmartTags(): Promise<{
  workspaces: number;
  tagged: number;
  evaluated: number;
  failures: Array<{ workspaceId: string; error: string }>;
}> {
  const supabase = getSupabaseClient();

  const workspaces = await fetchAllRows((afterId, pageSize) => {
    let q = supabase.from("clients").select("id").order("id", { ascending: true }).limit(pageSize);
    if (afterId) q = q.gt("id", afterId);
    return q;
  });

  let tagged = 0;
  let evaluated = 0;
  const failures: Array<{ workspaceId: string; error: string }> = [];

  for (const workspace of workspaces) {
    const result = await runSmartTagsForWorkspace(workspace.id);
    tagged += result.tagged;
    evaluated += result.evaluated;
    if (result.error) failures.push({ workspaceId: workspace.id, error: result.error });
  }

  return { workspaces: workspaces.length, tagged, evaluated, failures };
}
