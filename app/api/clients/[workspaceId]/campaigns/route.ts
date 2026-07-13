import { NextRequest, NextResponse } from "next/server";
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

  const supabaseUrl = process.env.SUPABASE_URL!;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const auth = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` };

  try {
    const countRes = await fetch(`${supabaseUrl}/rest/v1/campaigns?client_id=eq.${workspaceId}&select=count`, {
      headers: { ...auth, Accept: "application/json" },
    });
    const countResult = await countRes.json();
    const total = countResult?.[0]?.count ?? 0;

    const res = await fetch(
      `${supabaseUrl}/rest/v1/campaigns?client_id=eq.${workspaceId}&order=created_at.desc&limit=${limit}&offset=${offset}`,
      { headers: auth }
    );

    if (!res.ok) {
      const errText = await res.text();
      console.error("Campaign fetch error:", res.status, errText);
      return NextResponse.json({ error: "Failed to fetch campaigns" }, { status: 500 });
    }

    const data = await res.json();
    return NextResponse.json({ campaigns: data || [], total, limit, offset }, { status: 200 });
  } catch (error) {
    console.error("Campaign endpoint error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * POST /api/clients/[workspaceId]/campaigns
 * Create a new campaign (JWT authenticated, requires edit permission)
 * 
 * Body: {
 *   title: string;
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
  const { title, subject, audience, editor_html, editor_css } = body;

  if (!title || !subject) {
    return NextResponse.json(
      { error: "Title and subject required" },
      { status: 400 }
    );
  }

  try {
    const supabaseUrl = process.env.SUPABASE_URL!;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const auth = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, "Content-Type": "application/json", Prefer: "return=representation" };

    const res = await fetch(`${supabaseUrl}/rest/v1/campaigns`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        client_id: workspaceId,
        title,
        subject,
        audience: audience || "confirmed",
        editor_html: editor_html || "",
        editor_css: editor_css || null,
        status: "draft",
        sent_count: 0,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("Campaign create error:", res.status, errText);
      return NextResponse.json({ error: "Failed to create campaign" }, { status: 500 });
    }

    const data = await res.json();
    return NextResponse.json(data?.[0] || data, { status: 201 });
  } catch (error) {
    console.error("Campaign creation error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
