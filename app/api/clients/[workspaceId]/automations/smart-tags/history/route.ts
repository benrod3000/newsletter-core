import { NextRequest, NextResponse } from "next/server";
import { getClientContextFromJWT, assertWorkspaceAccess } from "@/lib/client-context";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const auth = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params;
  const ctx = getClientContextFromJWT(req);
  if (!ctx || !assertWorkspaceAccess(ctx, workspaceId))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    // Get subscriber IDs for this workspace
    const subsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/subscribers?select=id&client_id=eq.${workspaceId}`,
      { headers: auth }
    );
    const subs = await subsRes.json();
    if (!Array.isArray(subs)) {
      return NextResponse.json({ error: "Failed to fetch subscribers" }, { status: 500 });
    }

    if (subs.length === 0) {
      return NextResponse.json({ tags: [] });
    }

    const subIds = subs.map((s: any) => s.id);
    // Supabase REST supports `in` filter: comma-separated values in parentheses
    const subIdsParam = subIds.map((id: string) => `subscriber_id=eq.${id}`).join(",");

    // Fetch all tags for this workspace's subscribers
    const tagsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/subscriber_tags?select=tag,subscriber_id,created_at&limit=5000&or=(${subIdsParam})&order=created_at.desc`,
      { headers: auth }
    );
    const tags = await tagsRes.json();
    if (!Array.isArray(tags)) {
      return NextResponse.json({ tags: [] });
    }

    // Group by tag with counts and last applied date
    const tagMap = new Map<string, { count: number; lastApplied: string | null }>();
    for (const t of tags) {
      if (!tagMap.has(t.tag)) {
        tagMap.set(t.tag, { count: 0, lastApplied: null });
      }
      const entry = tagMap.get(t.tag)!;
      entry.count++;
      if (!entry.lastApplied || t.created_at > entry.lastApplied) {
        entry.lastApplied = t.created_at;
      }
    }

    const result = Array.from(tagMap.entries()).map(([tag, data]) => ({
      tag,
      count: data.count,
      lastApplied: data.lastApplied,
    }));

    // Sort by count descending
    result.sort((a, b) => b.count - a.count);

    return NextResponse.json({ tags: result });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Internal error" }, { status: 500 });
  }
}
