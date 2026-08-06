import { NextResponse } from "next/server";
import { withWorkspace } from "@/lib/with-workspace";
import { logError } from "@/lib/logger";
import { fetchAllRows } from "@/lib/paginate";

interface WidgetRow {
  id: string;
  name: string;
  slug: string;
}

/**
 * GET /api/clients/[workspaceId]/widgets/analytics
 * Per-widget impressions, submissions and conversion rate.
 */
export const GET = withWorkspace(async ({ ctx, db }) => {
  // NOTE: this reads up to 50,000 raw event rows and aggregates them in Node.
  // Same shape as the campaign analytics scan the architecture doc calls out,
  // with the same failure mode - past the cap the numbers are quietly wrong
  // rather than obviously missing. The fix is an incremental rollup keyed by
  // (workspace, widget, event_type), which is Phase 1 work against the new
  // events table so it only gets written once. Left as-is here on purpose.
  // `.limit(50000)` here was not the constraint it looked like: PostgREST caps a
  // response at 1,000 rows whatever is asked for, so this returned 1,000 events
  // and reported the resulting counts as if complete. The widget with the most
  // traffic would have been the one most understated.
  const eventsPromise = fetchAllRows<{ id: string; widget_id: string; event_type: string }>(
    (afterId, pageSize) => {
      let q = db
        .from("widget_events")
        .select("id,widget_id,event_type")
        .eq("workspace_id", ctx.workspaceId)
        .order("id", { ascending: true })
        .limit(pageSize);
      if (afterId) q = q.gt("id", afterId);
      return q;
    }
  ).then(
    (data) => ({ data, error: null as null | { message: string } }),
    (err: Error) => ({ data: [] as { id: string; widget_id: string; event_type: string }[], error: { message: err.message } })
  );

  const [eventsRes, widgetsRes] = await Promise.all([
    eventsPromise,
    db
      .from("widgets")
      .select("id,name,slug")
      .eq("workspace_id", ctx.workspaceId),
  ]);

  if (eventsRes.error || widgetsRes.error) {
    logError(eventsRes.error ?? widgetsRes.error, {
      route: "clients.widgets.analytics",
      workspaceId: ctx.workspaceId,
    });
    // The previous version returned e?.message straight to the caller, which
    // hands database internals to the browser.
    return NextResponse.json({ error: "Failed to load widget analytics" }, { status: 500 });
  }

  const stats = new Map<string, { impressions: number; submissions: number }>();
  for (const e of eventsRes.data ?? []) {
    const entry = stats.get(e.widget_id) ?? { impressions: 0, submissions: 0 };
    if (e.event_type === "impression") entry.impressions++;
    else entry.submissions++;
    stats.set(e.widget_id, entry);
  }

  const widgets = ((widgetsRes.data ?? []) as WidgetRow[]).map((w) => {
    const s = stats.get(w.id) ?? { impressions: 0, submissions: 0 };
    return {
      id: w.id,
      name: w.name,
      slug: w.slug,
      impressions: s.impressions,
      submissions: s.submissions,
      conversionRate:
        s.impressions > 0 ? `${((s.submissions / s.impressions) * 100).toFixed(1)}%` : "0%",
    };
  });

  return NextResponse.json({ widgets });
});
