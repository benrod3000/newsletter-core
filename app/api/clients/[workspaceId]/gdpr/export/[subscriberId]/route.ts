import { NextRequest, NextResponse } from "next/server";
import { getClientContextFromJWT, assertWorkspaceAccess } from "@/lib/client-context";
import { getSupabaseClient } from "@/lib/supabase";
import { isUuid } from "@/lib/route-params";
import { logError } from "@/lib/logger";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string; subscriberId: string }> }
) {
  const { workspaceId, subscriberId } = await params;
  const ctx = getClientContextFromJWT(req);
  if (!ctx || !assertWorkspaceAccess(ctx, workspaceId))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!isUuid(subscriberId)) {
    return NextResponse.json({ error: "Invalid subscriber ID" }, { status: 422 });
  }

  try {
    const supabase = getSupabaseClient();

    // Establish ownership first. Previously the child queries ran in the same
    // Promise.all as the ownership check — their results were gated by the 404
    // below, so nothing leaked, but the queries executed regardless and the
    // safety depended entirely on the ordering of a later branch.
    const { data: subscriber, error: subError } = await supabase
      .from("subscribers")
      .select("*")
      .eq("id", subscriberId)
      .eq("client_id", workspaceId)
      .maybeSingle();

    if (subError) {
      logError(subError, { route: "clients.gdpr.export", workspaceId, subscriberId });
      return NextResponse.json({ error: "Export failed" }, { status: 500 });
    }
    if (!subscriber) {
      return NextResponse.json({ error: "Subscriber not found" }, { status: 404 });
    }

    const [eventsRes, tagsRes, notesRes, membershipsRes] = await Promise.all([
      supabase
        .from("campaign_events")
        .select("*")
        .eq("subscriber_id", subscriberId)
        .order("occurred_at", { ascending: true })
        .limit(500),
      supabase.from("subscriber_tags").select("tag, created_at").eq("subscriber_id", subscriberId).limit(100),
      supabase.from("subscriber_notes").select("*").eq("subscriber_id", subscriberId).limit(100),
      supabase.from("subscriber_list_memberships").select("list_id").eq("subscriber_id", subscriberId).limit(50),
    ]);

    return NextResponse.json({
      exported_at: new Date().toISOString(),
      subscriber,
      campaigns: eventsRes.data ?? [],
      tags: tagsRes.data ?? [],
      notes: notesRes.data ?? [],
      list_memberships: membershipsRes.data ?? [],
    });
  } catch (e) {
    logError(e, { route: "clients.gdpr.export", workspaceId, subscriberId });
    return NextResponse.json({ error: "Export failed" }, { status: 500 });
  }
}
