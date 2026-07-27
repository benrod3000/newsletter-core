import { NextResponse } from "next/server";
import { withWorkspace } from "@/lib/with-workspace";
import { logError } from "@/lib/logger";

/**
 * GET /api/clients/[workspaceId]/subscriber-lists
 * Fetch subscriber lists for a workspace.
 *
 * Returns: { lists: [...] }
 */
export const GET = withWorkspace(async ({ ctx, db }) => {
  const { data, error } = await db
    .from("subscriber_lists")
    .select("*")
    .eq("workspace_id", ctx.workspaceId)
    .order("created_at", { ascending: false });

  if (error) {
    logError(error, { route: "clients.subscriber-lists.list", workspaceId: ctx.workspaceId });
    return NextResponse.json({ error: "Failed to fetch lists" }, { status: 500 });
  }

  return NextResponse.json({ lists: data || [] }, { status: 200 });
});

/**
 * POST /api/clients/[workspaceId]/subscriber-lists
 * Create a new subscriber list. Requires edit permission.
 *
 * Body: {
 *   name: string;
 *   description?: string;
 *   opt_in_type?: "single" | "double"; // default "single"
 * }
 */
export const POST = withWorkspace(
  async ({ req, ctx, db }) => {
    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

    const { name, description, opt_in_type } = body;
    if (!name) return NextResponse.json({ error: "Name required" }, { status: 400 });

    const validOptInType = ["single", "double"].includes(opt_in_type) ? opt_in_type : "single";

    const { data, error } = await db
      .from("subscriber_lists")
      .insert({
        workspace_id: ctx.workspaceId,
        name,
        description: description || null,
        opt_in_type: validOptInType,
      })
      .select()
      .single();

    if (error) {
      if (error.code === "23505") {
        return NextResponse.json({ error: "List with this name already exists" }, { status: 409 });
      }
      logError(error, { route: "clients.subscriber-lists.create", workspaceId: ctx.workspaceId });
      return NextResponse.json({ error: "Failed to create list" }, { status: 500 });
    }

    return NextResponse.json(data, { status: 201 });
  },
  { minRole: "editor" }
);
