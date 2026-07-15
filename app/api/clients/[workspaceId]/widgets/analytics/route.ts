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
    // Get per-widget analytics: impressions, submissions, conversion rate
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/widget_events?select=widget_id,event_type&workspace_id=eq.${workspaceId}&limit=50000`,
      { headers: auth }
    );
    const events = await res.json();
    if (!Array.isArray(events)) return NextResponse.json({ widgets: [] });

    // Get widget names
    const widgetsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/widgets?select=id,name,slug&workspace_id=eq.${workspaceId}`,
      { headers: auth }
    );
    const widgets = await widgetsRes.json();

    const widgetMap = new Map();
    for (const e of events) {
      if (!widgetMap.has(e.widget_id)) widgetMap.set(e.widget_id, { impressions: 0, submissions: 0 });
      const entry = widgetMap.get(e.widget_id);
      if (e.event_type === 'impression') entry.impressions++;
      else entry.submissions++;
    }

    const result = (Array.isArray(widgets) ? widgets : []).map((w: any) => {
      const stats = widgetMap.get(w.id) || { impressions: 0, submissions: 0 };
      return {
        id: w.id,
        name: w.name,
        slug: w.slug,
        impressions: stats.impressions,
        submissions: stats.submissions,
        conversionRate: stats.impressions > 0 ? ((stats.submissions / stats.impressions) * 100).toFixed(1) + '%' : '0%',
      };
    });

    return NextResponse.json({ widgets: result });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}
