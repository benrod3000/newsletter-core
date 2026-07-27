import { NextResponse } from "next/server";
import { withWorkspace } from "@/lib/with-workspace";
import { logError } from "@/lib/logger";

const CORS = { "Access-Control-Allow-Origin": "*" };

export const GET = withWorkspace(async ({ req, ctx, db }) => {
  const url = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "50"), 500);
  const offset = parseInt(url.searchParams.get("offset") || "0");

  const { data, error, count } = await db
    .from("automation_triggers")
    .select("*", { count: "exact" })
    .eq("workspace_id", ctx.workspaceId)
    .order("updated_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    logError(error, { route: "clients.automations.list", workspaceId: ctx.workspaceId });
    return NextResponse.json({ error: "Failed to fetch automations" }, { status: 500, headers: CORS });
  }

  return NextResponse.json(
    { automations: data || [], total: count ?? 0, limit, offset },
    { status: 200, headers: CORS }
  );
});

export const POST = withWorkspace(
  async ({ req, ctx, db }) => {
    const body = await req.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400, headers: CORS });
    }

    const { name, trigger_type, action_type } = body;
    if (!name || !trigger_type || !action_type) {
      return NextResponse.json(
        { error: "Name, trigger_type, and action_type required" },
        { status: 400, headers: CORS }
      );
    }

    const { data, error } = await db
      .from("automation_triggers")
      .insert({
        workspace_id: ctx.workspaceId,
        name,
        trigger_type,
        action_type,
        is_active: true,
      })
      .select("*")
      .single();

    if (error) {
      logError(error, { route: "clients.automations.create", workspaceId: ctx.workspaceId });
      return NextResponse.json({ error: "Failed to create automation" }, { status: 500, headers: CORS });
    }

    return NextResponse.json(data, { status: 201, headers: CORS });
  },
  { minRole: "editor" }
);
