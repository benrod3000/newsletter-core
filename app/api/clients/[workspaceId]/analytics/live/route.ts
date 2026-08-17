import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";
import { getClientContextFromJWT, assertWorkspaceAccess } from "@/lib/client-context";
import { logError } from "@/lib/logger";

/**
 * GET /api/clients/[workspaceId]/analytics/live
 * The most recent engagement for the real-time pulse. Last 5 minutes, 10 events.
 *
 * Rewritten. The previous version had three faults:
 *
 * 1. **It queried `campaign_events` with no workspace filter.** It ran as
 *    service-role, so RLS did not apply, and it selected `email` - meaning the ten
 *    most recent opens and clicks from *any* workspace, subscriber addresses
 *    included, were returned to whoever was looking. The campaign title fell back to
 *    "Unknown" for a foreign campaign, but the address was still in the payload.
 *    No exposure has occurred, because only one workspace has ever had engagement
 *    data; it would have begun with the second.
 *
 * 2. **The event-type filter was malformed.** `&in=(event_type,open,click)` is not
 *    PostgREST syntax - the form is `event_type=in.(open,click)` - so it read as a
 *    filter on a column named `in`, PostgREST answered 42703, and the route returned
 *    an empty list. That is why the pulse showed nothing, and it also masked the
 *    problem above.
 *
 * 3. **It gave up when the workspace had no campaigns.** A workspace whose only
 *    engagement comes from capture forms would see a permanently empty pulse, which
 *    describes this project today: every engagement event in the database is a
 *    lead-magnet click, and those have no campaign.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params;
  const ctx = getClientContextFromJWT(req);
  if (!ctx || !assertWorkspaceAccess(ctx, workspaceId)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseClient();
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

  try {
    // Scoped to this workspace. campaign_events.workspace_id is NOT NULL as of
    // migration 048, so this filter is total - there is no row it can miss.
    const { data: events, error } = await supabase
      .from("campaign_events")
      .select("event_type, email, occurred_at, campaign_id, metadata")
      .eq("workspace_id", workspaceId)
      .in("event_type", ["open", "click"])
      .gte("occurred_at", fiveMinAgo)
      .order("occurred_at", { ascending: false })
      .limit(10);

    if (error) {
      logError(error, { route: "clients.analytics.live", workspaceId });
      return NextResponse.json({ events: [], now: new Date().toISOString() });
    }

    const rows = events ?? [];
    if (rows.length === 0) {
      return NextResponse.json({ events: [], now: new Date().toISOString() });
    }

    // Titles are looked up only for the campaigns actually referenced, and only
    // when at least one event has a campaign. Fetching them first meant a workspace
    // with no campaigns never got as far as reading its events.
    const campaignIds = [...new Set(rows.map((e) => e.campaign_id).filter(Boolean))] as string[];
    const titleById = new Map<string, string>();

    if (campaignIds.length > 0) {
      const { data: campaigns } = await supabase
        .from("campaigns")
        .select("id, title")
        .eq("workspace_id", workspaceId)
        .in("id", campaignIds);

      for (const c of campaigns ?? []) titleById.set(c.id, c.title || "Untitled");
    }

    const mapped = rows.map((e) => {
      // A lead-magnet click has no campaign. Naming it for what it is beats
      // "Unknown", which is what every event in this project currently reads as.
      const kind =
        e.metadata && typeof e.metadata === "object" && !Array.isArray(e.metadata)
          ? (e.metadata as Record<string, unknown>)["tracking_kind"]
          : null;

      const source = e.campaign_id
        ? titleById.get(e.campaign_id) ?? "Untitled"
        : kind === "lead_magnet"
          ? "Capture form download"
          : "Direct link";

      return {
        type: e.event_type,
        email: e.email,
        campaign: source,
        campaign_id: e.campaign_id,
        timestamp: e.occurred_at,
      };
    });

    return NextResponse.json({ events: mapped, now: new Date().toISOString() });
  } catch (err) {
    logError(err, { route: "clients.analytics.live", workspaceId });
    return NextResponse.json({ events: [], now: new Date().toISOString() });
  }
}
