import { NextResponse } from "next/server";
import { z } from "zod";
import { withWorkspace } from "@/lib/with-workspace";
import { getSupabaseClient } from "@/lib/supabase";
import { logError } from "@/lib/logger";
import { logAudit, extractRequestMeta, AUDIT_ACTIONS } from "@/lib/audit-log";
import { quoteFilterValue } from "@/lib/postgrest";

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

  const nearLat = url.searchParams.get("near_lat");
  const nearLng = url.searchParams.get("near_lng");
  const radius = url.searchParams.get("radius") || "10";

  if (nearLat && nearLng) {
    // `radius` arrives in miles, which is what the UI offers. The function takes
    // kilometres, because that is what campaigns.geo_filter stores and what
    // enqueue_campaign_recipients uses - previously this passed `radius_miles`
    // to a km-based world, so filtering the list and sending to the same radius
    // could select different people. Converted here, at the one boundary where
    // the unit changes.
    const radiusKm = parseFloat(radius) * 1.609344;

    const { data, error } = await getSupabaseClient().rpc("nearby_subscribers", {
      p_workspace_id: ctx.workspaceId,
      center_lat: parseFloat(nearLat),
      center_lng: parseFloat(nearLng),
      radius_km: radiusKm,
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
