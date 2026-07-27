import { NextResponse } from "next/server";
import { z } from "zod";
import { withWorkspace } from "@/lib/with-workspace";
import { logError } from "@/lib/logger";

/** Subscriber ids are uuid primary keys (migration 001). */
const bulkDeleteSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
});

/**
 * Escape a user-supplied value for use inside a PostgREST filter.
 *
 * PostgREST treats `,` `(` `)` and `.` as filter syntax. The previous version
 * built an `or=(email.ilike.*<search>*,...)` string with only
 * encodeURIComponent applied, which does not encode parentheses at all - so a
 * search term containing `)` could close the or-group and append further
 * top-level filters. The workspace filter is a separate ANDed parameter, so this
 * could not remove tenant scoping, but it could still bend the query.
 *
 * PostgREST allows double-quoting a value, with backslash escapes inside it.
 * Quoting is the correct fix; stripping characters would silently break searches
 * for names like "O'Brien (work)".
 */
function quoteFilterValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

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

  const nearLat = url.searchParams.get("near_lat");
  const nearLng = url.searchParams.get("near_lng");
  const radius = url.searchParams.get("radius") || "10";

  if (nearLat && nearLng) {
    // KNOWN BROKEN, PRE-EXISTING: there is no nearby_subscribers function in the
    // database. This path has been returning 500 for every radius search. Left
    // calling the same RPC rather than silently changing behaviour in a tenancy
    // change - the fix is a migration adding the function (the haversine in
    // enqueue_campaign_recipients is the model) and is tracked separately.
    const { data, error } = await db.rpc("nearby_subscribers", {
      p_workspace_id: ctx.workspaceId,
      center_lat: parseFloat(nearLat),
      center_lng: parseFloat(nearLng),
      radius_miles: parseFloat(radius),
    });

    if (error) {
      logError(error, { route: "clients.subscribers.nearby", workspaceId: ctx.workspaceId });
      return NextResponse.json({ error: "Failed to fetch nearby subscribers" }, { status: 500 });
    }

    const rows = Array.isArray(data) ? data : [];
    return NextResponse.json(
      { subscribers: rows.slice(offset, offset + limit), total: rows.length, limit, offset },
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

    // Report rows actually deleted. Returning ids.length counted ids belonging
    // to other workspaces, which the workspace filter silently drops.
    return NextResponse.json({ ok: true, deleted: data?.length ?? 0 });
  },
  { minRole: "editor" }
);
