import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";
import {
  getClientContextFromJWT,
  assertWorkspaceAccess,
  canEditAsClient,
} from "@/lib/client-context";

/**
 * GET /api/clients/[workspaceId]/campaigns
 * Fetch campaigns for a workspace (JWT authenticated)
 * 
 * Query params:
 * - limit: number (default 50)
 * - offset: number (default 0)
 * 
 * Returns: { campaigns: [...], total: number, limit: number, offset: number }
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params;
  const context = getClientContextFromJWT(req);

  if (!context || !assertWorkspaceAccess(context, workspaceId)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "50"), 500);
  const offset = parseInt(url.searchParams.get("offset") || "0");

  const supabase = getSupabaseClient();

  try {
    const { data, count, error } = await supabase
      .from("campaigns")
      .select("id, name, subject, audience, created_at, updated_at, status, processed", { count: "exact" })
      .eq("client_id", workspaceId)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error("Campaign fetch error:", error);
      return NextResponse.json(
        { error: "Failed to fetch campaigns" },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        campaigns: data || [],
        total: count || 0,
        limit,
        offset,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Campaign endpoint error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/clients/[workspaceId]/campaigns
 * Create a new campaign (JWT authenticated, requires edit permission)
 * 
 * Body: {
 *   name: string;
 *   subject: string;
 *   audience: "confirmed" | "all" | "pending" | "claimed_offer" | "list:<id>";
 *   editor_html?: string;
 *   editor_css?: string;
 * }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params;
  const context = getClientContextFromJWT(req);

  if (!context || !assertWorkspaceAccess(context, workspaceId)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!canEditAsClient(context)) {
    return NextResponse.json(
      { error: "Insufficient permissions" },
      { status: 403 }
    );
  }

  const body = await req.json();
  const { name, subject, audience, editor_html, editor_css } = body;

  if (!name || !subject) {
    return NextResponse.json(
      { error: "Name and subject required" },
      { status: 400 }
    );
  }

  const supabase = getSupabaseClient();

  try {
    const { data, error } = await supabase
      .from("campaigns")
      .insert({
        client_id: workspaceId,
        name,
        subject,
        audience: audience || "confirmed",
        editor_html: editor_html || null,
        editor_css: editor_css || null,
        status: "draft",
        processed: false,
      })
      .select()
      .single();

    if (error) {
      console.error("Campaign creation error:", error);
      return NextResponse.json(
        { error: "Failed to create campaign" },
        { status: 500 }
      );
    }

    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    console.error("Campaign creation endpoint error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
