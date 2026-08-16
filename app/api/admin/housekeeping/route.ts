import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";
import { getAdminContextFromHeaders } from "@/lib/admin-context";
import { fetchAllRows } from "@/lib/paginate";

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
    if (clientId) countQuery = countQuery.eq("workspace_id", clientId);

    const { count } = await countQuery;

    if (dryRun) {
      return NextResponse.json({ ok: true, count: count ?? 0, dryRun: true });
    }

    let deleteQuery = supabase
      .from("subscribers")
      .delete({ count: "exact" })
      .eq("confirmed", false)
      .lt("created_at", cutoff);
    if (clientId) deleteQuery = deleteQuery.eq("workspace_id", clientId);

    const { count: deleted, error } = await deleteQuery;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true, deleted: deleted ?? 0 });
  }

  // --- Remove bounced / complained subscribers ---
  //
  // Deliberately NOT "remove everyone suppressed". Since migration 065 a suppressed
  // row IS the opt-out record: unsubscribe stopped deleting people and started
  // flagging them, precisely so the objection survives a re-import. Deleting those
  // rows destroys the only evidence the address opted out, and the address becomes
  // mailable again the next time it appears in a CSV - which is the failure the
  // suppression work existed to prevent.
  //
  // A bounce is different in kind. It is deliverability hygiene, not a stated wish,
  // so it stays purgeable.
  if (action === "purge_suppressed") {
    let countQuery = supabase
      .from("subscribers")
      .select("id", { count: "exact", head: true })
      .eq("suppressed", true)
      .neq("suppressed_reason", "unsubscribe");
    if (clientId) countQuery = countQuery.eq("workspace_id", clientId);

    const { count } = await countQuery;

    if (dryRun) {
      return NextResponse.json({ ok: true, count: count ?? 0, dryRun: true });
    }

    let deleteQuery = supabase
      .from("subscribers")
      .delete({ count: "exact" })
      .eq("suppressed", true)
      .neq("suppressed_reason", "unsubscribe");
    if (clientId) deleteQuery = deleteQuery.eq("workspace_id", clientId);

    const { count: deleted, error } = await deleteQuery;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true, deleted: deleted ?? 0 });
  }

  // --- Remove inactive confirmed subscribers (no opens, signed up > N days ago) ---
  if (action === "purge_inactive") {
    const days = typeof body.days === "number" && body.days > 0 ? body.days : 90;
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    // Paged. A plain select stops at PostgREST's 1,000-row ceiling with no error,
    // so this only ever considered the first 1,000 subscribers and reported a
    // dry-run count that had nothing to do with the size of the job.
    const allSubs = await fetchAllRows((afterId, pageSize) => {
      let q = supabase
        .from("subscribers")
        .select("id")
        .eq("confirmed", true)
        .eq("suppressed", false)
        .lt("created_at", cutoff)
        .order("id", { ascending: true })
        .limit(pageSize);
      if (clientId) q = q.eq("workspace_id", clientId);
      if (afterId) q = q.gt("id", afterId);
      return q;
    });

    if (allSubs.length === 0) {
      return NextResponse.json({ ok: true, count: 0, deleted: 0, dryRun });
    }

    const allIds = allSubs.map((s) => s.id);

    /*
     * Who has opened something, asked per candidate rather than fetched wholesale.
     *
     * This was one unbounded `select subscriber_id from campaign_events where
     * event_type = 'open'`, which is wrong twice over on a table that grows without
     * limit:
     *
     *   - PostgREST caps it at 1,000 rows silently, so the "has opened" set was an
     *     arbitrary 1,000 events. Everyone whose open fell outside that window
     *     looked like they had never engaged - and this endpoint DELETES them.
     *   - It had no workspace filter, so an admin purging one workspace could spend
     *     that entire 1,000-row budget on another tenant's events.
     *
     * Batched `.in()` over the actual candidates is bounded, exact, and scoped.
     * Same shape as the engagement check in auto-clean, for the same reason: this
     * decision is irreversible.
     */
    const openedIds = new Set<string>();
    const LOOKUP_BATCH = 200;
    for (let i = 0; i < allIds.length; i += LOOKUP_BATCH) {
      const ids = allIds.slice(i, i + LOOKUP_BATCH);
      let q = supabase
        .from("campaign_events")
        .select("subscriber_id")
        .eq("event_type", "open")
        .in("subscriber_id", ids);
      if (clientId) q = q.eq("workspace_id", clientId);

      const { data, error } = await q;
      // Failing closed: an unreadable events table means we cannot tell who
      // engaged, and the safe answer to that is to delete nobody.
      if (error) {
        return NextResponse.json(
          { error: `Could not verify engagement, nothing deleted: ${error.message}` },
          { status: 500 }
        );
      }
      for (const row of data ?? []) {
        if (row.subscriber_id) openedIds.add(row.subscriber_id);
      }
    }

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
      let del = supabase.from("subscribers").delete({ count: "exact" }).in("id", batch);
      // The ids already come from a scoped query, so this is belt and braces - but
      // it is a mass delete, and the cost of the filter is nothing next to the cost
      // of the id list ever being built differently.
      if (clientId) del = del.eq("workspace_id", clientId);

      const { count, error } = await del;
      // supabase-js resolves errors rather than throwing, so without this a failed
      // batch added zero and the endpoint reported partial work as success.
      if (error) {
        return NextResponse.json(
          { error: `Deleted ${deleted} before failing: ${error.message}`, deleted },
          { status: 500 }
        );
      }
      deleted += count ?? 0;
    }

    return NextResponse.json({ ok: true, deleted });
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
