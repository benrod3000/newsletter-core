import { NextResponse } from "next/server";
import { withWorkspace } from "@/lib/with-workspace";
import { logError } from "@/lib/logger";

/**
 * GET /api/clients/[workspaceId]/campaigns
 * Fetch campaigns for a workspace.
 *
 * Query params:
 * - limit: number (default 50)
 * - offset: number (default 0)
 *
 * Returns: { campaigns: [...], total: number, limit: number, offset: number }
 */
export const GET = withWorkspace(async ({ req, ctx, db }) => {
  const url = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "50"), 500);
  const offset = parseInt(url.searchParams.get("offset") || "0");

  const { data, error, count } = await db
    .from("campaigns")
    .select("*", { count: "exact" })
    .eq("workspace_id", ctx.workspaceId)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    logError(error, { route: "clients.campaigns.list", workspaceId: ctx.workspaceId });
    return NextResponse.json({ error: "Failed to fetch campaigns" }, { status: 500 });
  }

  return NextResponse.json(
    { campaigns: data || [], total: count ?? 0, limit, offset },
    { status: 200 }
  );
});

/**
 * POST /api/clients/[workspaceId]/campaigns
 * Create a new campaign. Requires edit permission.
 *
 * Body: {
 *   title: string;
 *   subject: string;
 *   audience: "confirmed" | "all" | "pending" | "claimed_offer" | "list:<id>";
 *   editor_html?: string;
 *   editor_css?: string;
 * }
 */
export const POST = withWorkspace(
  async ({ req, ctx, db }) => {
    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

    const { title, subject, audience, editor_html, editor_css } = body;

    if (!title || !subject) {
      return NextResponse.json({ error: "Title and subject required" }, { status: 400 });
    }

    const { data, error } = await db
      .from("campaigns")
      .insert({
        workspace_id: ctx.workspaceId,
        title,
        subject,
        audience: audience || "confirmed",
        editor_html: editor_html || "",
        editor_css: editor_css || null,
        status: "draft",
        sent_count: 0,
      })
      .select("*")
      .single();

    if (error) {
      logError(error, { route: "clients.campaigns.create", workspaceId: ctx.workspaceId });
      return NextResponse.json({ error: "Failed to create campaign" }, { status: 500 });
    }

    return NextResponse.json(data, { status: 201 });
  },
  { minRole: "editor" }
);
