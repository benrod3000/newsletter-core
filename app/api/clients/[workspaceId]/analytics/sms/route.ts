import { NextRequest, NextResponse } from "next/server";
import { getClientContextFromJWT, assertWorkspaceAccess } from "@/lib/client-context";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const auth = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };

/**
 * GET /api/clients/[workspaceId]/analytics/sms
 * SMS/RCS analytics for this workspace.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params;
  const ctx = getClientContextFromJWT(req);
  if (!ctx || !assertWorkspaceAccess(ctx, workspaceId))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    // Count SMS-reachable subscribers
    const countRes = await fetch(
      `${SUPABASE_URL}/rest/v1/subscribers?select=count&client_id=eq.${workspaceId}&sms_consent=is.true&not.phone=is.null`,
      { headers: auth, signal: AbortSignal.timeout(10000) }
    );
    const countData = await countRes.json();
    const reachable = countData?.[0]?.count ?? 0;

    return NextResponse.json({
      reachable,
      sent: reachable > 0 ? null : 0,
      responseRate: null,
      message: reachable > 0
        ? `${reachable} subscribers can receive SMS. Send tracking will populate as campaigns are sent.`
        : "No SMS contacts yet. Widget signups with phone + consent will appear here.",
    });
  } catch {
    return NextResponse.json({ error: "Failed to load SMS stats" }, { status: 500 });
  }
}
