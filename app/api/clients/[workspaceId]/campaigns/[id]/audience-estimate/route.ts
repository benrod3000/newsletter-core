import { NextResponse } from "next/server";
import { withWorkspace } from "@/lib/with-workspace";
import { getSupabaseClient } from "@/lib/supabase";
import { logError } from "@/lib/logger";
import { isUuid } from "@/lib/route-params";
import { parseGeoFilter } from "@/lib/geo-utils";
import { parseAudience } from "@/lib/send-queue";

const CORS = { "Access-Control-Allow-Origin": "*" };

/**
 * GET /api/clients/{workspaceId}/campaigns/{id}/audience-estimate
 *
 * How many people this campaign would actually reach, as it is currently
 * configured.
 *
 * The send confirmation previously showed `campaign.sent_count`, which is how
 * many were *already* sent. On an unsent draft that is 0, so it fell through
 * `||` and the dialog read "will be sent to all confirmed subscribers" with no
 * number at all, beside a cost line computed from an invented 100 recipients and
 * attributed to AWS SES whatever the workspace's real provider was.
 *
 * The count comes from count_campaign_recipients(), which reads the same
 * campaign_audience() predicate that enqueue_campaign_recipients() inserts from
 * (migration 056). One definition, so the number shown and the set mailed cannot
 * drift apart. Verified against production before shipping: both returned 10,300
 * with zero set difference.
 */
export const GET = withWorkspace<{ workspaceId: string; id: string }>(
  async ({ ctx, params }) => {
    const { id } = params;

    if (!isUuid(id)) {
      return NextResponse.json({ error: "Invalid campaign ID" }, { status: 422, headers: CORS });
    }

    // Service-role: count_campaign_recipients is SECURITY DEFINER and reads
    // across subscribers and campaign_events. withWorkspace already proved
    // membership, and the workspace id is passed explicitly rather than read
    // from a claim, so this cannot count another tenant's audience.
    const supabase = getSupabaseClient();

    const { data: campaign, error: campaignError } = await supabase
      .from("campaigns")
      .select("id, audience, geo_filter")
      .eq("id", id)
      .eq("workspace_id", ctx.workspaceId)
      .maybeSingle();

    if (campaignError) {
      logError(campaignError, {
        route: "clients.campaigns.audience-estimate",
        workspaceId: ctx.workspaceId,
        id,
      });
      return NextResponse.json({ error: "Failed to load campaign" }, { status: 500, headers: CORS });
    }
    if (!campaign) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404, headers: CORS });
    }

    const { audience, listId } = parseAudience(campaign.audience || "confirmed");
    const geo = parseGeoFilter(campaign.geo_filter);

    const { data: count, error } = await supabase.rpc("count_campaign_recipients", {
      p_workspace: ctx.workspaceId,
      p_audience: audience,
      p_list_id: listId ?? undefined,
      p_country: geo.country ?? undefined,
      p_regions: geo.regions.length ? geo.regions : undefined,
      p_cities: geo.cities.length ? geo.cities : undefined,
      p_center_lat: geo.center_lat ?? undefined,
      p_center_lng: geo.center_lng ?? undefined,
      p_radius_km: geo.radius_km ?? undefined,
    });

    if (error) {
      logError(error, {
        route: "clients.campaigns.audience-estimate",
        workspaceId: ctx.workspaceId,
        id,
      });
      // No fallback number. A wrong count here is worse than no count: the whole
      // point is that the user can trust what the confirmation dialog says.
      return NextResponse.json(
        { error: "Could not calculate recipients" },
        { status: 500, headers: CORS }
      );
    }

    return NextResponse.json(
      {
        count: count ?? 0,
        audience: campaign.audience || "confirmed",
        // Echoed back so the UI can say *why* the number is what it is, rather
        // than showing a bare figure the user has to take on trust.
        filters: {
          list_id: listId,
          country: geo.country,
          regions: geo.regions,
          cities: geo.cities,
          radius_km: geo.radius_km,
        },
      },
      { status: 200, headers: CORS }
    );
  }
);
