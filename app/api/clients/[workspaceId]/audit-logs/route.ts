import { withWorkspace } from "@/lib/with-workspace";
import { apiSuccess, apiInternalError } from "@/lib/api-response";
import { logError } from "@/lib/logger";

/**
 * GET /api/clients/[workspaceId]/audit-logs
 * List recent audit log entries for a workspace.
 * Query: ?limit=50&offset=0
 */
export const GET = withWorkspace(async ({ req, ctx, db }) => {
  const { searchParams } = new URL(req.url);
  const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 100);
  const offset = parseInt(searchParams.get("offset") || "0");

  const { data, error, count } = await db
    .from("audit_logs")
    .select("*", { count: "exact" })
    .eq("workspace_id", ctx.workspaceId)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    logError(error, { route: "clients.audit-logs.get", workspaceId: ctx.workspaceId });
    return apiInternalError("Failed to load audit logs");
  }

  return apiSuccess({ logs: data, total: count, limit, offset });
});
