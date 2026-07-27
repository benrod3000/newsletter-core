import { NextRequest, NextResponse } from "next/server";
import { getClientContextFromJWT, assertWorkspaceAccess } from "@/lib/client-context";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const auth = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" };

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params;
  const ctx = getClientContextFromJWT(req);
  if (!ctx || !assertWorkspaceAccess(ctx, workspaceId))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { subscriberIds, tag } = await req.json();
  if (!Array.isArray(subscriberIds) || subscriberIds.length === 0 || !tag?.trim()) {
    return NextResponse.json({ error: "subscriberIds (array) and tag (string) are required" }, { status: 400 });
  }

  const normalizedTag = tag.trim().toLowerCase();

  // Verify all subscriber IDs belong to this workspace
  const idsParam = subscriberIds.map((id: string) => `id=eq.${id}`).join(",");
  const verifyRes = await fetch(
    `${SUPABASE_URL}/rest/v1/subscribers?select=id&workspace_id=eq.${workspaceId}&or=(${idsParam})`,
    { headers: auth }
  );
  const existing = await verifyRes.json();
  if (!Array.isArray(existing)) {
    return NextResponse.json({ error: "Failed to verify subscribers" }, { status: 500 });
  }

  const validIds = existing.map((s: any) => s.id);
  if (validIds.length === 0) {
    return NextResponse.json({ error: "No valid subscribers found in this workspace" }, { status: 400 });
  }

  // Batch upsert tags (100 per batch, ignore duplicates)
  const batchSize = 100;
  const batchUpserts = validIds.map((subscriberId: string) => ({
    subscriber_id: subscriberId,
    workspace_id: workspaceId,
    tag: normalizedTag,
  }));

  for (let i = 0; i < batchUpserts.length; i += batchSize) {
    const batch = batchUpserts.slice(i, i + batchSize);
    await fetch(`${SUPABASE_URL}/rest/v1/subscriber_tags`, {
      method: "POST",
      headers: { ...auth, Prefer: "resolution=ignore-duplicates" },
      body: JSON.stringify(batch),
    });
  }

  return NextResponse.json({ ok: true, tagged: validIds.length, tag: normalizedTag }, { status: 201 });
}
