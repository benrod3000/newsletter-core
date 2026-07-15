import { NextRequest, NextResponse } from "next/server";
import { getClientContextFromJWT, assertWorkspaceAccess } from "@/lib/client-context";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const auth = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" };

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params;
  const ctx = getClientContextFromJWT(req);
  if (!ctx || !assertWorkspaceAccess(ctx, workspaceId))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/campaign_templates?workspace_id=eq.${workspaceId}&order=updated_at.desc&limit=50`,
    { headers: auth }
  );
  const templates = await res.json();
  return NextResponse.json({ templates: templates || [] });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params;
  const ctx = getClientContextFromJWT(req);
  if (!ctx || !assertWorkspaceAccess(ctx, workspaceId))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { name, subject, editor_html, audience, category } = await req.json();
  if (!name?.trim()) return NextResponse.json({ error: "Template name is required" }, { status: 400 });

  const res = await fetch(`${SUPABASE_URL}/rest/v1/campaign_templates`, {
    method: "POST",
    headers: { ...auth, Prefer: "return=representation" },
    body: JSON.stringify({
      workspace_id: workspaceId,
      name: name.trim(),
      subject: subject?.trim() || null,
      editor_html: editor_html || null,
      audience: audience || "confirmed",
      category: category?.trim() || null,
    }),
  });
  const data = await res.json();
  return NextResponse.json({ template: data?.[0] }, { status: 201 });
}
