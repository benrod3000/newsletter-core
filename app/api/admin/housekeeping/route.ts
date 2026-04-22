import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";
import { getAdminContextFromHeaders } from "@/lib/admin-context";

export async function POST(req: NextRequest) {
  const admin = getAdminContextFromHeaders(req.headers);
  if (!admin) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (admin.role !== "owner") return NextResponse.json({ error: "Owner only." }, { status: 403 });

  const body = await req.json().catch(() => null);
  if (!body?.action) return NextResponse.json({ error: "Missing action." }, { status: 400 });

  const supabase = getSupabaseClient();
  const dryRun = body.dryRun === true;
  const { action } = body;

  // Scope to a specific workspace if provided (or default)
  let clientId: string | null = admin.clientId;
  if (!clientId && body.clientId) clientId = body.clientId;

  // --- Purge unconfirmed older than N days ---
  if (action === "purge_unconfirmed") {
    const days = typeof body.days === "number" && body.days > 0 ? body.days : 30;
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    let countQuery = supabase
      .from("subscribers")
      .select("id", { count: "exact", head: true })
      .eq("confirmed", false)
      .lt("created_at", cutoff);
    if (clientId) countQuery = countQuery.eq("client_id", clientId);

    const { count } = await countQuery;

    if (dryRun) {
      return NextResponse.json({ ok: true, count: count ?? 0, dryRun: true });
    }

    let deleteQuery = supabase
      .from("subscribers")
      .delete({ count: "exact" })
      .eq("confirmed", false)
      .lt("created_at", cutoff);
    if (clientId) deleteQuery = deleteQuery.eq("client_id", clientId);

    const { count: deleted, error } = await deleteQuery;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true, deleted: deleted ?? 0 });
  }

  // --- Remove suppressed (bounced / complained) subscribers ---
  if (action === "purge_suppressed") {
    let countQuery = supabase
      .from("subscribers")
      .select("id", { count: "exact", head: true })
      .eq("suppressed", true);
    if (clientId) countQuery = countQuery.eq("client_id", clientId);

    const { count } = await countQuery;

    if (dryRun) {
      return NextResponse.json({ ok: true, count: count ?? 0, dryRun: true });
    }

    let deleteQuery = supabase
      .from("subscribers")
      .delete({ count: "exact" })
      .eq("suppressed", true);
    if (clientId) deleteQuery = deleteQuery.eq("client_id", clientId);

    const { count: deleted, error } = await deleteQuery;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true, deleted: deleted ?? 0 });
  }

  // --- Remove inactive confirmed subscribers (no opens, signed up > N days ago) ---
  if (action === "purge_inactive") {
    const days = typeof body.days === "number" && body.days > 0 ? body.days : 90;
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    let subQuery = supabase
      .from("subscribers")
      .select("id")
      .eq("confirmed", true)
      .lt("created_at", cutoff);
    if (clientId) subQuery = subQuery.eq("client_id", clientId);

    const { data: allSubs } = await subQuery;
    if (!allSubs || allSubs.length === 0) {
      return NextResponse.json({ ok: true, count: 0, deleted: 0, dryRun });
    }

    const allIds = allSubs.map((s) => s.id);

    // Get subscriber IDs who have opened at least one campaign
    const { data: openedSubs } = await supabase
      .from("campaign_events")
      .select("subscriber_id")
      .eq("event_type", "open")
      .not("subscriber_id", "is", null);

    const openedIds = new Set((openedSubs ?? []).map((e) => e.subscriber_id).filter(Boolean));
    const inactiveIds = allIds.filter((id) => !openedIds.has(id));

    if (dryRun) {
      return NextResponse.json({ ok: true, count: inactiveIds.length, dryRun: true });
    }

    if (inactiveIds.length === 0) {
      return NextResponse.json({ ok: true, deleted: 0 });
    }

    let deleted = 0;
    const BATCH = 100;
    for (let i = 0; i < inactiveIds.length; i += BATCH) {
      const batch = inactiveIds.slice(i, i + BATCH);
      const { count } = await supabase
        .from("subscribers")
        .delete({ count: "exact" })
        .in("id", batch);
      deleted += count ?? 0;
    }

    return NextResponse.json({ ok: true, deleted });
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
