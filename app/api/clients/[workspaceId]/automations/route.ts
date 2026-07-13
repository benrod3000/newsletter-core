import { NextRequest, NextResponse } from "next/server";
import {
  getClientContextFromJWT,
  assertWorkspaceAccess,
  canEditAsClient,
} from "@/lib/client-context";

const CORS = { "Access-Control-Allow-Origin": "*" };

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params;
  const context = getClientContextFromJWT(req);
  if (!context || !assertWorkspaceAccess(context, workspaceId)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: CORS });
  }
  const url = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "50"), 500);
  const offset = parseInt(url.searchParams.get("offset") || "0");
  const supabaseUrl = process.env.SUPABASE_URL!;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const auth = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` };
  try {
    const countRes = await fetch(`${supabaseUrl}/rest/v1/automation_triggers?workspace_id=eq.${workspaceId}&select=count`, { headers: auth });
    const countResult = await countRes.json();
    const total = countResult?.[0]?.count ?? 0;
    const res = await fetch(`${supabaseUrl}/rest/v1/automation_triggers?workspace_id=eq.${workspaceId}&order=updated_at.desc&limit=${limit}&offset=${offset}`, { headers: auth });
    if (!res.ok) return NextResponse.json({ error: "Failed to fetch automations" }, { status: 500, headers: CORS });
    const data = await res.json();
    return NextResponse.json({ automations: data || [], total, limit, offset }, { status: 200, headers: CORS });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500, headers: CORS });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params;
  const context = getClientContextFromJWT(req);
  if (!context || !assertWorkspaceAccess(context, workspaceId)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: CORS });
  }
  if (!canEditAsClient(context)) return NextResponse.json({ error: "Insufficient permissions" }, { status: 403, headers: CORS });
  const body = await req.json();
  const { name, trigger_type, action_type } = body;
  if (!name || !trigger_type || !action_type) return NextResponse.json({ error: "Name, trigger_type, and action_type required" }, { status: 400, headers: CORS });
  const supabaseUrl = process.env.SUPABASE_URL!;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const auth = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, "Content-Type": "application/json", Prefer: "return=representation" };
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/automation_triggers`, { method: "POST", headers: auth, body: JSON.stringify({ workspace_id: workspaceId, name, trigger_type, action_type, is_active: true }) });
    if (!res.ok) return NextResponse.json({ error: "Failed to create automation" }, { status: 500, headers: CORS });
    const data = await res.json();
    return NextResponse.json(data?.[0] || data, { status: 201, headers: CORS });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500, headers: CORS });
  }
}
