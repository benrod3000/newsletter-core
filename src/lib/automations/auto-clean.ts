/**
 * Auto-clean: delete subscribers who have been disengaged for a long time.
 *
 * Runs daily at 02:00. This is the only scheduled job in the system that
 * destroys customer data, so it is written to fail closed at every step.
 *
 * WHAT WAS WRONG WITH THE PREVIOUS VERSION
 *
 * Four independent defects, each of which alone would make it unsafe to run:
 *
 * 1. It deleted on the wrong criterion. The docstring promised "90+ days no
 *    engagement" and the code compared `created_at` - the signup date. Someone
 *    who joined two years ago and went cold yesterday was eligible for deletion
 *    on the next run. Engagement was never consulted.
 *
 * 2. Its GDPR audit record could never be written. The insert supplied
 *    event_type, details and occurred_at, none of which are columns on
 *    gdpr_audit_events, and omitted action, admin_username and admin_role, all
 *    of which are NOT NULL. Every insert 400'd, the result was never checked,
 *    and the delete proceeded regardless - so contacts would have been erased
 *    with no record that it happened.
 *
 * 3. It read `limit=5000`, which PostgREST caps at 1,000 whatever is asked for.
 *
 * 4. It returned a `moved` count for moving subscribers to a "Cold Leads" list.
 *    Nothing in the function ever moved anything; the line incrementing it sat
 *    next to a comment reading "future: implement list membership".
 *
 * WHY THE SCORING GUARD EXISTS
 *
 * health_score is computed by a separate nightly job that, until recently, timed
 * out partway and left most subscribers unscored. `cold` is also the *default*
 * score for anyone with no engagement events, so a workspace with no campaign
 * history scores everyone cold once they are 30 days old.
 *
 * Put together: fixing the scoring job turns "nobody is cold" into "almost
 * everyone is cold", and this job would then delete them. Nothing about that
 * requires a person to make a mistake - it happens on a timer. So deletion is
 * refused unless the population is substantially scored, and unless there is
 * real engagement history to have been absent from.
 */
import { logError, logWarn } from "@/lib/logger";
import { getSupabaseClient } from "@/lib/supabase";
import { fetchAllRows } from "@/lib/paginate";
import { logAudit, AUDIT_ACTIONS } from "@/lib/audit-log";

/** Days without engagement before a subscriber is deleted. */
const DELETE_AFTER_DAYS = 90;

/**
 * Share of a workspace that must carry a health score before any deletion.
 *
 * A partially-scored population cannot distinguish "cold" from "not yet looked
 * at", and the difference decides whether someone is erased.
 */
const MIN_SCORED_RATIO = 0.95;

export interface AutoCleanResult {
  workspaces: number;
  deleted: number;
  skipped: Array<{ workspaceId: string; reason: string }>;
}

export async function runAutoClean(): Promise<AutoCleanResult> {
  const supabase = getSupabaseClient();
  const cutoff = new Date(Date.now() - DELETE_AFTER_DAYS * 86_400_000).toISOString();

  const workspaces = await fetchAllRows((afterId, pageSize) => {
    let q = supabase.from("clients").select("id").order("id", { ascending: true }).limit(pageSize);
    if (afterId) q = q.gt("id", afterId);
    return q;
  });

  let deleted = 0;
  const skipped: Array<{ workspaceId: string; reason: string }> = [];

  for (const workspace of workspaces) {
    try {
      const result = await cleanWorkspace(supabase, workspace.id, cutoff);
      deleted += result.deleted;
      if (result.reason) skipped.push({ workspaceId: workspace.id, reason: result.reason });
    } catch (err) {
      logError(err, { action: "auto-clean.workspace", workspaceId: workspace.id });
      skipped.push({ workspaceId: workspace.id, reason: "errored" });
    }
  }

  return { workspaces: workspaces.length, deleted, skipped };
}

async function cleanWorkspace(
  supabase: ReturnType<typeof getSupabaseClient>,
  workspaceId: string,
  cutoff: string
): Promise<{ deleted: number; reason?: string }> {
  const { count: total, error: totalErr } = await supabase
    .from("subscribers")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId);

  if (totalErr) throw new Error(totalErr.message);
  if (!total) return { deleted: 0 };

  const { count: scored, error: scoredErr } = await supabase
    .from("subscribers")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .not("health_score", "is", null);

  if (scoredErr) throw new Error(scoredErr.message);

  if ((scored ?? 0) / total < MIN_SCORED_RATIO) {
    const reason = `only ${scored ?? 0}/${total} subscribers scored`;
    logWarn(`[auto-clean] skipping ${workspaceId}: ${reason}`);
    return { deleted: 0, reason };
  }

  // Deleting for absent engagement is only meaningful where engagement is
  // recorded at all. A workspace that has never sent a campaign has no opens or
  // clicks by definition, and every subscriber looks equally disengaged.
  const { count: events, error: eventsErr } = await supabase
    .from("campaign_events")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId);

  if (eventsErr) throw new Error(eventsErr.message);
  if (!events) {
    const reason = "workspace has no engagement history";
    logWarn(`[auto-clean] skipping ${workspaceId}: ${reason}`);
    return { deleted: 0, reason };
  }

  const candidates = await fetchAllRows((afterId, pageSize) => {
    let q = supabase
      .from("subscribers")
      .select("id, email, created_at")
      .eq("workspace_id", workspaceId)
      .eq("health_score", "cold")
      // Never delete a suppressed row. Those rows exist *in order* to be kept:
      // unsubscribe stopped deleting subscribers and now records suppression
      // instead, so the row is the durable proof that the address opted out. An
      // unsubscribed contact is cold almost by definition, so without this filter
      // auto-clean would delete precisely the records that stop the address being
      // mailed again, and it would do it on a timer with no human involved.
      .eq("suppressed", false)
      // Signed up long enough ago to have had the chance to engage. This is a
      // necessary condition, not the criterion - the engagement check below is.
      .lt("created_at", cutoff)
      .order("id", { ascending: true })
      .limit(pageSize);
    if (afterId) q = q.gt("id", afterId);
    return q;
  });

  if (candidates.length === 0) return { deleted: 0 };

  // The actual criterion: no open or click inside the window. Checked per
  // candidate against the events table rather than inferred from health_score,
  // because health_score is a derived summary and this decision is irreversible.
  const recentlyEngaged = new Set<string>();
  const BATCH = 200;
  for (let i = 0; i < candidates.length; i += BATCH) {
    const ids = candidates.slice(i, i + BATCH).map((c) => c.id);
    const { data, error } = await supabase
      .from("campaign_events")
      .select("subscriber_id")
      .eq("workspace_id", workspaceId)
      .in("subscriber_id", ids)
      .gte("occurred_at", cutoff);

    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      if (row.subscriber_id) recentlyEngaged.add(row.subscriber_id);
    }
  }

  const toDelete = candidates.filter((c) => !recentlyEngaged.has(c.id));
  if (toDelete.length === 0) return { deleted: 0 };

  // Recorded before the delete, and the delete does not proceed if it fails.
  // The previous version had this the other way round, with an insert that could
  // never succeed, so erasure would have been unaudited.
  const { error: auditErr } = await supabase.from("gdpr_audit_events").insert(
    toDelete.map((sub) => ({
      workspace_id: workspaceId,
      subscriber_id: sub.id,
      subscriber_email: sub.email,
      action: "auto_clean_delete",
      admin_username: "system:auto-clean",
      admin_role: "system",
      metadata: { reason: `no engagement in ${DELETE_AFTER_DAYS} days`, cutoff },
    }))
  );

  if (auditErr) {
    logError(auditErr, { action: "auto-clean.audit", workspaceId });
    return { deleted: 0, reason: "could not write audit record; nothing deleted" };
  }

  const { data: removed, error: deleteErr } = await supabase
    .from("subscribers")
    .delete()
    .in("id", toDelete.map((s) => s.id))
    .eq("workspace_id", workspaceId)
    .select("id");

  if (deleteErr) throw new Error(deleteErr.message);

  await logAudit({
    workspace_id: workspaceId,
    action: AUDIT_ACTIONS.SUBSCRIBER_DELETED,
    details: {
      deleted: removed?.length ?? 0,
      source: "auto-clean",
      criterion: `no engagement in ${DELETE_AFTER_DAYS} days`,
    },
  });

  return { deleted: removed?.length ?? 0 };
}
