import { NextRequest, NextResponse } from "next/server";
import {
  getClientContextFromJWT,
  assertWorkspaceAccess,
  canEditAsClient,
} from "@/lib/client-context";

const CORS = { "Access-Control-Allow-Origin": "*" };

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string; id: string }> }
) {
  const { workspaceId, id } = await params;
  const context = getClientContextFromJWT(req);
  if (!context || !assertWorkspaceAccess(context, workspaceId)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: CORS });
  }
  if (!canEditAsClient(context)) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403, headers: CORS });
  }
  if (!isUuid(id)) {
    return NextResponse.json({ error: "Invalid campaign ID" }, { status: 422, headers: CORS });
  }

  const supabaseUrl = process.env.SUPABASE_URL!;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const auth = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` };

  try {
    // Verify campaign exists
    const checkRes = await fetch(`${supabaseUrl}/rest/v1/campaigns?id=eq.${id}&client_id=eq.${workspaceId}&select=id,status&limit=1`, { headers: auth });
    const campaigns = await checkRes.json();
    if (!Array.isArray(campaigns) || campaigns.length === 0) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404, headers: CORS });
    }

    const body = await req.json();
    const updateData: Record<string, unknown> = {};

    if (body.schedule_now) {
      updateData.status = "scheduled";
      updateData.scheduled_for = body.schedule_for || new Date().toISOString();
    } else {
      if (body.title !== undefined) updateData.title = body.title;
      if (body.subject !== undefined) updateData.subject = body.subject;
      if (body.audience !== undefined) updateData.audience = body.audience;
      if (body.editor_html !== undefined) updateData.editor_html = body.editor_html;
      if (body.editor_css !== undefined) updateData.editor_css = body.editor_css;
    }

    const patchHeaders = { ...auth, "Content-Type": "application/json", Prefer: "return=representation" };
    const res = await fetch(`${supabaseUrl}/rest/v1/campaigns?id=eq.${id}`, {
      method: "PATCH",
      headers: patchHeaders,
      body: JSON.stringify(updateData),
    });
    if (!res.ok) return NextResponse.json({ error: "Failed to update campaign" }, { status: 500, headers: CORS });
    const data = await res.json();
    return NextResponse.json(data?.[0] || data, { status: 200, headers: CORS });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500, headers: CORS });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string; id: string }> }
) {
  const { workspaceId, id } = await params;
  const context = getClientContextFromJWT(req);
  if (!context || !assertWorkspaceAccess(context, workspaceId)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: CORS });
  }
  if (!canEditAsClient(context)) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403, headers: CORS });
  }

  const supabaseUrl = process.env.SUPABASE_URL!;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const auth = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` };

  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/campaigns?id=eq.${id}&client_id=eq.${workspaceId}`, {
      method: "DELETE",
      headers: auth,
    });
    if (!res.ok) return NextResponse.json({ error: "Failed to delete campaign" }, { status: 500, headers: CORS });
    return NextResponse.json({ ok: true }, { status: 200, headers: CORS });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500, headers: CORS });
  }
}
