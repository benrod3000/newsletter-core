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
    // Get this workspace's subscriber IDs
    const subsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/subscribers?select=id&client_id=eq.${workspaceId}`,
      { headers: auth }
    );
    const subs = await subsRes.json();
    if (!Array.isArray(subs)) {
      return NextResponse.json({ error: "Failed to fetch subscribers" }, { status: 500 });
    }

    if (subs.length === 0) {
      return NextResponse.json({ runs: [] });
    }

    const subIds = subs.map((s: any) => s.id);
    const subIdsParam = subIds.map((id: string) => `subscriber_id=eq.${id}`).join(",");

    // Fetch auto-clean GDPR audit events for this workspace's subscribers
    const eventsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/gdpr_audit_events?select=*&event_type=eq.auto_clean_delete&or=(${subIdsParam})&order=occurred_at.desc&limit=100`,
      { headers: auth }
    );
    const events = await eventsRes.json();
    if (!Array.isArray(events)) {
      return NextResponse.json({ runs: [] });
    }

    // Group events by date (same timestamp = same run)
    const runMap = new Map<string, { timestamp: string; deleted: number; details: string[] }>();
    for (const e of events) {
      // Group by the minute to cluster runs
      const key = new Date(e.occurred_at).toISOString().slice(0, 16);
      if (!runMap.has(key)) {
        runMap.set(key, { timestamp: e.occurred_at, deleted: 0, details: [] });
      }
      const entry = runMap.get(key)!;
      entry.deleted++;
      if (e.details && !entry.details.includes(e.details)) {
        entry.details.push(e.details);
      }
    }

    const runs = Array.from(runMap.values());
    // Sort newest first
    runs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    return NextResponse.json({ runs });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Internal error" }, { status: 500 });
  }
}
