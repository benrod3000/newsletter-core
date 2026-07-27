import { NextResponse } from "next/server";
import { withWorkspace } from "@/lib/with-workspace";
import { logError } from "@/lib/logger";

/**
 * GET /api/clients/[workspaceId]/segments
 * List saved audience segments for this workspace.
 */
export const GET = withWorkspace(async ({ ctx, db }) => {
  const { data, error } = await db
    .from("saved_segments")
    .select("id,name,filters,created_at")
    // Redundant once migration 049 is applied - the policy already constrains
    // this to one workspace. Kept deliberately: the filter is correct whether or
    // not RLS is active, so the two are belt and braces rather than a single
    // point of failure.
    .eq("workspace_id", ctx.workspaceId)
    .order("created_at", { ascending: false });

  if (error) {
    logError(error, { workspaceId: ctx.workspaceId, action: "list-segments" });
    return NextResponse.json({ error: "Failed to load segments" }, { status: 500 });
  }

  return NextResponse.json({ segments: data ?? [] });
});

/**
 * POST /api/clients/[workspaceId]/segments
 * Save a new audience segment.
 * Body: { name: string, filters: { status?: string, search?: string, geoFilter?: any } }
 */
export const POST = withWorkspace(
  async ({ req, ctx, db }) => {
    let body: { name?: string; filters?: Record<string, unknown> };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid body" }, { status: 400 });
    }

    const name = body.name?.trim();
    if (!name) return NextResponse.json({ error: "Segment name is required" }, { status: 400 });

    const { data, error } = await db
      .from("saved_segments")
      .insert({ workspace_id: ctx.workspaceId, name, filters: body.filters || {} })
      .select("id,name,filters,created_at")
      .single();

    if (error) {
      logError(error, { workspaceId: ctx.workspaceId, action: "save-segment" });
      return NextResponse.json({ error: "Failed to save segment" }, { status: 500 });
    }

    return NextResponse.json({ segment: data }, { status: 201 });
  },
  { minRole: "editor" }
);
