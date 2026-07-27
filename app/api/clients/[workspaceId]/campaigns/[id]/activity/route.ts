import { withWorkspace } from "@/lib/with-workspace";
import { isUuid } from "@/lib/route-params";
import { apiSuccess, apiError, apiInternalError } from "@/lib/api-response";
import { logError } from "@/lib/logger";

/**
 * GET /api/clients/[workspaceId]/campaigns/[id]/activity
 * Returns the activity log timeline for a specific campaign.
 */
export const GET = withWorkspace<{ workspaceId: string; id: string }>(
  async ({ ctx, db, params }) => {
    const campaignId = params.id;

    if (!isUuid(campaignId)) {
      return apiError(422, "INVALID_ID", "Invalid campaign ID");
    }

    // This query filtered on campaign_id alone, with nothing tying it to the
    // caller's workspace, so any authenticated user could read another
    // workspace's campaign activity log by knowing a campaign id. The workspace
    // filter below fixes it directly, and the policy from migration 049 makes it
    // structural rather than a filter someone has to remember.
    const { data, error } = await db
      .from("campaign_activity_log")
      .select("id, event_type, description, details, created_at")
      .eq("campaign_id", campaignId)
      .eq("workspace_id", ctx.workspaceId)
      .order("created_at", { ascending: true })
      .limit(50);

    if (error) {
      logError(error, {
        route: "clients.campaigns.activity",
        workspaceId: ctx.workspaceId,
        campaignId,
      });
      return apiInternalError();
    }

    return apiSuccess({ activity: data || [] });
  }
);
