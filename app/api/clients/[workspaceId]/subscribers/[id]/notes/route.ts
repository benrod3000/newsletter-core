import { NextRequest, NextResponse } from "next/server";
import { getClientContextFromJWT, assertWorkspaceAccess } from "@/lib/client-context";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const auth = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string; id: string }> }
) {
  const { workspaceId, id } = await params;
  const ctx = getClientContextFromJWT(req);
  if (!ctx || !assertWorkspaceAccess(ctx, workspaceId))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [notesRes, tagsRes] = await Promise.all([
    fetch(`${SUPABASE_URL}/rest/v1/subscriber_notes?select=*&subscriber_id=eq.${id}&order=created_at.desc`, { headers: auth }),
    fetch(`${SUPABASE_URL}/rest/v1/subscriber_tags?select=tag&subscriber_id=eq.${id}`, { headers: auth }),
  ]);
  const notes = await notesRes.json();
  const tags = await tagsRes.json();
  return NextResponse.json({ notes: notes || [], tags: (tags || []).map((t: any) => t.tag) });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string; id: string }> }
) {
  const { workspaceId, id } = await params;
  const ctx = getClientContextFromJWT(req);
  if (!ctx || !assertWorkspaceAccess(ctx, workspaceId))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { note, tag } = await req.json();
  const headers = { ...auth, "Content-Type": "application/json", Prefer: "return=representation" };

  if (note) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/subscriber_notes`, {
      method: "POST", headers,
      body: JSON.stringify({ subscriber_id: id, workspace_id: workspaceId, note: note.trim() }),
    });
    const data = await res.json();
    return NextResponse.json({ note: data?.[0] }, { status: 201 });
  }

  if (tag) {
    await fetch(`${SUPABASE_URL}/rest/v1/subscriber_tags`, {
      method: "POST", headers: { ...headers, Prefer: "return=minimal" },
      body: JSON.stringify({ subscriber_id: id, workspace_id: workspaceId, tag: tag.trim().toLowerCase() }),
    });
    return NextResponse.json({ ok: true }, { status: 201 });
  }

  return NextResponse.json({ error: "note or tag required" }, { status: 400 });
}
