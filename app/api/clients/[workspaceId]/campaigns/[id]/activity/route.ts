import { NextRequest } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";
import { getClientContextFromJWT, assertWorkspaceAccess } from "@/lib/client-context";
import { apiSuccess, apiUnauthorized, apiInternalError } from "@/lib/api-response";

/**
 * GET /api/clients/[workspaceId]/campaigns/[id]/activity
 * Returns the activity log timeline for a specific campaign.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string; id: string }> }
) {
  const { workspaceId, id: campaignId } = await params;
  const ctx = getClientContextFromJWT(req);
  if (!ctx || !assertWorkspaceAccess(ctx, workspaceId)) return apiUnauthorized();

  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("campaign_activity_log")
      .select("id, event_type, description, details, created_at")
      .eq("campaign_id", campaignId)
      .order("created_at", { ascending: true })
      .limit(50);

    if (error) throw error;
    return apiSuccess({ activity: data || [] });
  } catch (e: any) {
    console.error("[campaign-activity] Error:", e?.message);
    return apiInternalError();
  }
}
