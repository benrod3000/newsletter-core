import { NextResponse } from "next/server";
import { withWorkspace } from "@/lib/with-workspace";
import { isUuid } from "@/lib/route-params";
import { logError } from "@/lib/logger";

export const GET = withWorkspace<{ workspaceId: string; subscriberId: string }>(
  async ({ ctx, db, params }) => {
    const { subscriberId } = params;

    if (!isUuid(subscriberId)) {
      return NextResponse.json({ error: "Invalid subscriber ID" }, { status: 422 });
    }

    // Establish ownership first. Previously the child queries ran in the same
    // Promise.all as the ownership check - their results were gated by the 404
    // below, so nothing leaked, but the queries executed regardless and the
    // safety depended entirely on the ordering of a later branch.
    const { data: subscriber, error: subError } = await db
      .from("subscribers")
      .select("*")
      .eq("id", subscriberId)
      .eq("workspace_id", ctx.workspaceId)
      .maybeSingle();

    if (subError) {
      logError(subError, {
        route: "clients.gdpr.export",
        workspaceId: ctx.workspaceId,
        subscriberId,
      });
      return NextResponse.json({ error: "Export failed" }, { status: 500 });
    }
    if (!subscriber) {
      return NextResponse.json({ error: "Subscriber not found" }, { status: 404 });
    }

    // These four are keyed only by subscriber_id. That used to make the ownership
    // check above load-bearing: get the ordering wrong and they would happily
    // return another workspace's rows. Since migration 048 each of these tables
    // carries workspace_id and is covered by a policy, so the scoped client
    // cannot reach across tenants regardless of what the filter says.
    const [eventsRes, tagsRes, notesRes, membershipsRes] = await Promise.all([
      db.from("campaign_events")
        .select("*")
        .eq("subscriber_id", subscriberId)
        .order("occurred_at", { ascending: true })
        .limit(500),
      db.from("subscriber_tags").select("tag, created_at").eq("subscriber_id", subscriberId).limit(100),
      db.from("subscriber_notes").select("*").eq("subscriber_id", subscriberId).limit(100),
      db.from("subscriber_list_memberships").select("list_id").eq("subscriber_id", subscriberId).limit(50),
    ]);

    // subscriber_notes exists as of migration 059. Before that it did not,
    // supabase-js reported the missing relation as { error }, and `?? []`
    // swallowed it - so this export silently omitted notes rather than failing.
    // A subject-access response that quietly drops a category of personal data
    // is the worst place for that, which is why every read is checked below
    // rather than trusted.
    for (const [name, res] of Object.entries({
      campaign_events: eventsRes,
      subscriber_tags: tagsRes,
      subscriber_notes: notesRes,
      subscriber_list_memberships: membershipsRes,
    })) {
      if (res.error) {
        logError(res.error, {
          route: "clients.gdpr.export",
          workspaceId: ctx.workspaceId,
          subscriberId,
          table: name,
        });
      }
    }

    return NextResponse.json({
      exported_at: new Date().toISOString(),
      subscriber,
      campaigns: eventsRes.data ?? [],
      tags: tagsRes.data ?? [],
      notes: notesRes.data ?? [],
      list_memberships: membershipsRes.data ?? [],
    });
  }
);
