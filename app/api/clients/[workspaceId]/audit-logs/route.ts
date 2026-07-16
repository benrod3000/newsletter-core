import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";
import { getClientContextFromJWT } from "@/lib/client-context";
import { logAudit, AUDIT_ACTIONS, extractRequestMeta } from "@/lib/audit-log";

/**
 * GET /api/clients/[workspaceId]/audit-logs
 * List recent audit log entries for a workspace.
 * Query: ?limit=50&offset=0
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const ctx = getClientContextFromJWT(req);
  const { workspaceId } = await params;

  if (!ctx || ctx.workspaceId !== workspaceId) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Access denied" } }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 100);
  const offset = parseInt(searchParams.get("offset") || "0");

  try {
    const supabase = getSupabaseClient();
    const { data, error, count } = await supabase
      .from("audit_logs")
      .select("*", { count: "exact" })
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    return NextResponse.json({ logs: data, total: count, limit, offset }, { status: 200 });
  } catch (e: any) {
    console.error("[audit-logs] Error:", e?.message);
    return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: "Failed to load audit logs" } }, { status: 500 });
  }
}
