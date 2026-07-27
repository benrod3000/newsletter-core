import { withWorkspace } from "@/lib/with-workspace";
import { apiSuccess, apiInternalError } from "@/lib/api-response";
import { logError } from "@/lib/logger";

interface ActivityEvent {
  type: string;
  description: string;
  timestamp: string;
}

export const GET = withWorkspace(async ({ ctx, db }) => {
  const [campRes, subRes, widgetRes] = await Promise.all([
    db.from("campaigns")
      .select("title, status, created_at, updated_at, last_sent_at")
      .eq("workspace_id", ctx.workspaceId)
      .order("created_at", { ascending: false })
      .limit(5),
    db.from("subscribers")
      .select("email, created_at")
      .eq("workspace_id", ctx.workspaceId)
      .order("created_at", { ascending: false })
      .limit(5),
    // This one filtered on a column widget_submissions did not have - it was
    // client_id, and the table carried neither client_id nor workspace_id. So
    // PostgREST rejected it, the result was not an array, and the loop was
    // skipped: widget signups have never appeared in this feed. Migration 048
    // adds the column, which is what makes this work for the first time.
    db.from("widget_submissions")
      .select("email, created_at")
      .eq("workspace_id", ctx.workspaceId)
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  const failed = [campRes, subRes, widgetRes].find((r) => r.error);
  if (failed?.error) {
    logError(failed.error, { route: "clients.activity", workspaceId: ctx.workspaceId });
    return apiInternalError();
  }

  const events: ActivityEvent[] = [];

  for (const c of campRes.data ?? []) {
    const sent = c.status === "sent";
    events.push({
      type: sent ? "campaign_sent" : "campaign_created",
      description: sent ? `Campaign sent: ${c.title}` : `Draft created: ${c.title}`,
      timestamp: sent ? c.last_sent_at || c.updated_at : c.created_at,
    });
  }

  for (const s of subRes.data ?? []) {
    events.push({
      type: "subscriber_added",
      description: `New subscriber: ${s.email}`,
      timestamp: s.created_at,
    });
  }

  for (const w of widgetRes.data ?? []) {
    events.push({
      type: "form_submission",
      description: `Widget signup: ${w.email}`,
      timestamp: w.created_at,
    });
  }

  events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  return apiSuccess({ activity: events.slice(0, 10) });
});
