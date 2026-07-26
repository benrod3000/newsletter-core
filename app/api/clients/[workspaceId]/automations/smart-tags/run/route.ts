import { NextRequest, NextResponse } from "next/server";
import { getClientContextFromJWT, assertWorkspaceAccess } from "@/lib/client-context";
import { runSmartTagsForWorkspace } from "@/lib/automations/smart-tags";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const authHeaders = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };

/**
 * POST /api/clients/[workspaceId]/automations/smart-tags/run
 * JWT-authenticated, workspace-scoped - runs smart tag evaluation
 * for the current workspace only. Called from the Settings dashboard.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params;
  const ctx = getClientContextFromJWT(req);
  if (!ctx || !assertWorkspaceAccess(ctx, workspaceId))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const result = await runSmartTagsForWorkspace(workspaceId);
    return NextResponse.json(result, { status: 200 });
  } catch (err: any) {
    console.error("[smart-tags/run] Error:", err?.message || err);
    return NextResponse.json(
      { error: err?.message || "Failed to run smart tags." },
      { status: 500 }
    );
  }
}
