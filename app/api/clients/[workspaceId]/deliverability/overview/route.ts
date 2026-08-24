/**
 * GET /api/clients/[workspaceId]/deliverability/overview
 *
 * Deliverability health for the caller's workspace: DNS health, bounce and
 * complaint rates, an overall score, and prioritized recommendations.
 *
 * Auth: client JWT.
 *
 * The dashboard previously called /api/admin/deliverability/overview, which is
 * behind admin Basic Auth - so the page always 401'd. Shares its implementation
 * with the admin route via buildDeliverabilityOverview().
 */

import { withWorkspace } from "@/lib/with-workspace";
import { buildDeliverabilityOverview } from "@/lib/deliverability/overview";
import { apiSuccess, apiError, apiInternalError } from "@/lib/api-response";
import { logError } from "@/lib/logger";

export const GET = withWorkspace<{ workspaceId: string }>(
  async ({ params }) => {
    const { workspaceId } = params;

  try {
    const result = await buildDeliverabilityOverview(workspaceId);
    if (!result.ok) return apiError(result.status, result.code, result.message);
    return apiSuccess(result.overview);
  } catch (err) {
    logError(err, { route: "clients.deliverability.overview", workspaceId });
    return apiInternalError("Failed to load deliverability overview");
  }
},
  { minRole: "viewer" }
);
