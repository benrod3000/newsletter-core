import { NextRequest, NextResponse } from "next/server";
import {
  getClientContextFromJWT,
  assertWorkspaceAccess,
} from "@/lib/client-context";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params;
  const context = getClientContextFromJWT(req);
  if (!context || !assertWorkspaceAccess(context, workspaceId)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabaseUrl = process.env.SUPABASE_URL!;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const auth = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` };
  const wId = encodeURIComponent(workspaceId);

  try {
    const [subsRes, campsRes, listsRes, widgetsRes, activityRes] = await Promise.all([
      fetch(`${supabaseUrl}/rest/v1/subscribers?client_id=eq.${wId}&limit=10000`, { headers: auth }),
      fetch(`${supabaseUrl}/rest/v1/campaigns?client_id=eq.${wId}&limit=1000`, { headers: auth }),
      fetch(`${supabaseUrl}/rest/v1/subscriber_lists?client_id=eq.${wId}&limit=1000`, { headers: auth }),
      fetch(`${supabaseUrl}/rest/v1/widgets?workspace_id=eq.${wId}&limit=100`, { headers: auth }),
      fetch(`${supabaseUrl}/rest/v1/clients?id=eq.${wId}&limit=1`, { headers: auth }),
    ]);

    const [subscribers, campaigns, lists, widgets, workspace] = await Promise.all([
      subsRes.json(), campsRes.json(), listsRes.json(), widgetsRes.json(), activityRes.json(),
    ]);

    return NextResponse.json({
      exported_at: new Date().toISOString(),
      workspace: Array.isArray(workspace) ? workspace[0] : null,
      subscribers: Array.isArray(subscribers) ? subscribers : [],
      campaigns: Array.isArray(campaigns) ? campaigns : [],
      lists: Array.isArray(lists) ? lists : [],
      widgets: Array.isArray(widgets) ? widgets : [],
    }, {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="veloce-export-${workspaceId}.json"`,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: "Export failed" }, { status: 500 });
  }
}
