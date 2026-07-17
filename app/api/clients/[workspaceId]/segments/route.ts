import { NextRequest, NextResponse } from "next/server";
import { getClientContextFromJWT, assertWorkspaceAccess, canEditAsClient } from "@/lib/client-context";
import { logError } from "@/lib/logger";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const auth = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" };

/**
 * GET /api/clients/[workspaceId]/segments
 * List saved audience segments for this workspace.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params;
  const ctx = getClientContextFromJWT(req);
  if (!ctx || !assertWorkspaceAccess(ctx, workspaceId))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/saved_segments?select=id,name,filters,created_at&workspace_id=eq.${workspaceId}&order=created_at.desc`,
      { headers: auth }
    );
    const data = await res.json();
    return NextResponse.json({ segments: Array.isArray(data) ? data : [] });
  } catch (err) {
    logError(err, { workspaceId, action: 'list-segments' });
    return NextResponse.json({ error: "Failed to load segments" }, { status: 500 });
  }
}

/**
 * POST /api/clients/[workspaceId]/segments
 * Save a new audience segment.
 * Body: { name: string, filters: { status?: string, search?: string, geoFilter?: any } }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params;
  const ctx = getClientContextFromJWT(req);
  if (!ctx || !assertWorkspaceAccess(ctx, workspaceId))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canEditAsClient(ctx))
    return NextResponse.json({ error: "Only editors can save segments" }, { status: 403 });

  let body: { name?: string; filters?: Record<string, unknown> };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const name = body.name?.trim();
  if (!name) return NextResponse.json({ error: "Segment name is required" }, { status: 400 });

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/saved_segments`, {
      method: "POST",
      headers: { ...auth, Prefer: "return=representation" },
      body: JSON.stringify({
        workspace_id: workspaceId,
        name,
        filters: body.filters || {},
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`Supabase ${res.status}`);
    return NextResponse.json({ segment: Array.isArray(data) ? data[0] : data }, { status: 201 });
  } catch (err) {
    logError(err, { workspaceId, action: 'save-segment' });
    return NextResponse.json({ error: "Failed to save segment" }, { status: 500 });
  }
}
