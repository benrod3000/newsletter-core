import { NextResponse } from "next/server";
import { z } from "zod";
import { withWorkspace } from "@/lib/with-workspace";
import { logError } from "@/lib/logger";
import { logAudit, extractRequestMeta, AUDIT_ACTIONS } from "@/lib/audit-log";
import { quoteFilterValue } from "@/lib/postgrest";
import { parseGeoAreas, fetchSubscribersInAreas } from "@/lib/geo-areas";

/** Subscriber ids are uuid primary keys (migration 001). */
const bulkDeleteSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
});


/**
 * GET /api/clients/[workspaceId]/subscribers
 * Fetch subscribers for a workspace.
 *
 * Query params:
 * - limit: number (default 100)
 * - offset: number (default 0)
 * - status: "confirmed" | "pending" | "unsubscribed" | "active" | "at_risk" | "cold"
 * - near_lat / near_lng / radius: radius query (miles, default 10)
 * - joined_after / joined_before, search
 *
 * Returns: { subscribers: [...], total: number, limit: number, offset: number }
 */
export const GET = withWorkspace(async ({ req, ctx, db }) => {
  const url = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "100"), 1000);
  const offset = parseInt(url.searchParams.get("offset") || "0");
  const status = url.searchParams.get("status");

  /*
   * Areas are a union. The picker allows several and draws a circle for each,
   * while this read near_lat/near_lng only - the first area - and dropped the
   * rest. Selecting Oceanside at 10mi (which contains nobody) alongside
   * Encinitas at 100mi (which contains eight) therefore answered 0, and the page
   * rendered "your audience starts here" over a workspace of 10,310 contacts.
   *
   * Miles convert to kilometres in parseGeoAreas, at the one boundary where the
   * unit changes: campaigns.geo_filter and enqueue_campaign_recipients are both
   * km, so filtering a list and sending to the same shape must agree.
   */
  const areas = parseGeoAreas(url.searchParams);

  if (areas.length > 0) {
    let rows;
    try {
      rows = await fetchSubscribersInAreas(ctx.workspaceId, areas);
    } catch (err) {
      logError(err, { route: "clients.subscribers.nearby", workspaceId: ctx.workspaceId, areas: areas.length });
      return NextResponse.json({ error: "Failed to fetch nearby subscribers" }, { status: 500 });
    }

    // The remaining predicates are applied here because the radius lives in a
    // Postgres function and cannot be composed with PostgREST filters.
    const search = url.searchParams.get("search")?.toLowerCase().trim();
    const joinedAfter = url.searchParams.get("joined_after");
    const joinedBefore = url.searchParams.get("joined_before");

    const filtered = rows.filter((s) => {
      if (status === "confirmed" && !s.confirmed) return false;
      if (status === "pending" && s.confirmed) return false;
      if (status === "unsubscribed" && !s.suppressed) return false;
      if ((status === "active" || status === "at_risk" || status === "cold") && s.health_score !== status) return false;
      if (joinedAfter && s.created_at < joinedAfter) return false;
      if (joinedBefore && s.created_at > `${joinedBefore}T23:59:59`) return false;
      if (search) {
        const hay = `${s.email ?? ""} ${s.first_name ?? ""} ${s.last_name ?? ""}`.toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    });

    return NextResponse.json(
      { subscribers: filtered.slice(offset, offset + limit), total: filtered.length, limit, offset },
      { status: 200 }
    );
  }

  let query = db
    .from("subscribers")
    .select("*", { count: "exact" })
    .eq("workspace_id", ctx.workspaceId);

  if (status === "confirmed") query = query.eq("confirmed", true);
  else if (status === "pending") query = query.eq("confirmed", false);
  else if (status === "unsubscribed") query = query.eq("unsubscribed", true);
  else if (status === "active" || status === "at_risk" || status === "cold") {
    query = query.eq("health_score", status);
  }

  const joinedAfter = url.searchParams.get("joined_after");
  const joinedBefore = url.searchParams.get("joined_before");
  if (joinedAfter) query = query.gte("created_at", joinedAfter);
  if (joinedBefore) query = query.lte("created_at", `${joinedBefore}T23:59:59`);

  const search = url.searchParams.get("search");
  if (search) {
    const q = quoteFilterValue(search);
    query = query.or(
      `email.ilike."%${q}%",first_name.ilike."%${q}%",last_name.ilike."%${q}%"`
    );
  }

  const { data, error, count } = await query
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    logError(error, { route: "clients.subscribers.list", workspaceId: ctx.workspaceId });
    return NextResponse.json({ error: "Failed to fetch subscribers" }, { status: 500 });
  }

  return NextResponse.json(
    { subscribers: data || [], total: count ?? 0, limit, offset },
    { status: 200 }
  );
});

/**
 * POST /api/clients/[workspaceId]/subscribers
 * Add a subscriber to the workspace.
 */
export const POST = withWorkspace(async ({ req, ctx, db }) => {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

  const {
    email, first_name, last_name, phone_number, date_of_birth,
    country, region, city, latitude, longitude,
  } = body;

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Invalid email" }, { status: 400 });
  }

  const { data, error } = await db
    .from("subscribers")
    .insert({
      workspace_id: ctx.workspaceId,
      email: email.toLowerCase().trim(),
      first_name: first_name || null,
      last_name: last_name || null,
      phone_number: phone_number || null,
      date_of_birth: date_of_birth || null,
      country: country || null,
      region: region || null,
      city: city || null,
      latitude: latitude || null,
      longitude: longitude || null,
      confirmed: false,
    })
    .select("*")
    .single();

  if (error) {
    // (workspace_id, email) is unique since migration 024.
    if (error.code === "23505") {
      return NextResponse.json({ error: "Subscriber already exists" }, { status: 409 });
    }
    logError(error, { route: "clients.subscribers.create", workspaceId: ctx.workspaceId });
    return NextResponse.json({ error: "Failed to create subscriber" }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
});

/**
 * DELETE /api/clients/[workspaceId]/subscribers
 * Bulk-delete subscribers by ID. Requires edit permission.
 *
 * Body: { ids: string[] }
 */
export const DELETE = withWorkspace(
  async ({ req, ctx, db }) => {
    const parsed = bulkDeleteSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: "ids must be an array of 1-500 subscriber UUIDs" },
        { status: 400 }
      );
    }

    // `.in()` parameterizes the id list. The original implementation
    // interpolated raw body values into a PostgREST `or=(id.eq....)` filter with
    // no encoding, on a request authenticated by the service-role key.
    const { data, error } = await db
      .from("subscribers")
      .delete()
      .in("id", parsed.data.ids)
      .eq("workspace_id", ctx.workspaceId)
      .select("id");

    if (error) {
      logError(error, { route: "clients.subscribers.bulkDelete", workspaceId: ctx.workspaceId });
      return NextResponse.json({ error: "Failed to delete subscribers" }, { status: 500 });
    }

    // Destructive and irreversible, so it is recorded with the ids rather than
    // just a count: after the fact a count cannot tell an owner which contacts
    // went, and the rows are gone.
    const { ip, ua } = extractRequestMeta(req);
    await logAudit({
      workspace_id: ctx.workspaceId,
      user_id: ctx.userId,
      action: AUDIT_ACTIONS.SUBSCRIBER_DELETED,
      details: { deleted: data?.length ?? 0, requested: parsed.data.ids.length, ids: data?.map((r) => r.id) ?? [] },
      ip_address: ip,
      user_agent: ua,
    });

    // Report rows actually deleted. Returning ids.length counted ids belonging
    // to other workspaces, which the workspace filter silently drops.
    return NextResponse.json({ ok: true, deleted: data?.length ?? 0 });
  },
  { minRole: "editor" }
);
