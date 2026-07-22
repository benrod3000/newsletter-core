/**
 * GET /api/clients/[workspaceId]/deliverability/overview
 *
 * Deliverability health for the caller's workspace: DNS health, bounce and
 * complaint rates, an overall score, and prioritized recommendations.
 *
 * Auth: client JWT.
 *
 * The dashboard previously called /api/admin/deliverability/overview, which is
 * behind admin Basic Auth — so the page always 401'd. Shares its implementation
 * with the admin route via buildDeliverabilityOverview().
 */

import { NextRequest } from "next/server";
import { getClientContextFromJWT, assertWorkspaceAccess } from "@/lib/client-context";
import { buildDeliverabilityOverview } from "@/lib/deliverability/overview";
import { apiSuccess, apiError, apiUnauthorized, apiInternalError } from "@/lib/api-response";
import { logError } from "@/lib/logger";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params;
  const ctx = getClientContextFromJWT(req);
  if (!ctx || !assertWorkspaceAccess(ctx, workspaceId)) return apiUnauthorized();

  try {
    const result = await buildDeliverabilityOverview(workspaceId);
    if (!result.ok) return apiError(result.status, result.code, result.message);
    return apiSuccess(result.overview);
  } catch (err) {
    logError(err, { route: "clients.deliverability.overview", workspaceId });
    return apiInternalError("Failed to load deliverability overview");
  }
}
