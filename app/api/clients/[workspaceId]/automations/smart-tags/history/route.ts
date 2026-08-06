import { NextRequest, NextResponse } from "next/server";
import { getClientContextFromJWT, assertWorkspaceAccess } from "@/lib/client-context";
import { getSupabaseClient } from "@/lib/supabase";
import { fetchAllRows } from "@/lib/paginate";
import { logError } from "@/lib/logger";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params;
  const ctx = getClientContextFromJWT(req);
  if (!ctx || !assertWorkspaceAccess(ctx, workspaceId))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = getSupabaseClient();

  try {
    // One workspace-scoped query, rather than fetching every subscriber id and
    // building an `or=(subscriber_id=eq.…)` filter from them. That shape was
    // truncated twice over: the subscriber read had no limit and so took
    // PostgREST's 1,000-row default, and the tag read asked for 5,000 and got
    // the same 1,000 back. A workspace with more than 1,000 subscribers saw tag
    // counts computed from an arbitrary subset, presented as totals.
    //
    // subscriber_tags.workspace_id is NOT NULL, so the id list was never needed.
    let tags: { tag: string; created_at: string | null }[];
    try {
      tags = await fetchAllRows<{ id: number; tag: string; created_at: string | null }>(
        (afterId, pageSize) => {
          let q = supabase
            .from("subscriber_tags")
            .select("id, tag, created_at")
            .eq("workspace_id", workspaceId)
            .order("id", { ascending: true })
            .limit(pageSize);
          if (afterId) q = q.gt("id", afterId);
          return q;
        }
      );
    } catch (err) {
      logError(err, { route: "clients.smart-tags.history", workspaceId });
      return NextResponse.json({ error: "Failed to load tag history" }, { status: 500 });
    }

    // Group by tag with counts and last applied date
    const tagMap = new Map<string, { count: number; lastApplied: string | null }>();
    for (const t of tags) {
      if (!tagMap.has(t.tag)) {
        tagMap.set(t.tag, { count: 0, lastApplied: null });
      }
      const entry = tagMap.get(t.tag)!;
      entry.count++;
      if (t.created_at && (!entry.lastApplied || t.created_at > entry.lastApplied)) {
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
