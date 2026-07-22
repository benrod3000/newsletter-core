/**
 * GET /api/admin/deliverability/overview
 *
 * Deliverability health overview for the admin's assigned workspace.
 * Auth: Admin (Basic Auth via proxy middleware).
 *
 * The computation is shared with the client-facing route via
 * buildDeliverabilityOverview() — see src/lib/deliverability/overview.ts.
 */

import { NextRequest } from "next/server";
import { getAdminContextFromHeaders } from "@/lib/admin-context";
import { buildDeliverabilityOverview } from "@/lib/deliverability/overview";
import { apiSuccess, apiError, apiUnauthorized, apiForbidden, apiInternalError } from "@/lib/api-response";
import { logError } from "@/lib/logger";

export async function GET(req: NextRequest) {
  const admin = getAdminContextFromHeaders(req.headers);
  if (!admin) return apiUnauthorized();
  if (!admin.clientId) return apiForbidden("No workspace assigned");

  try {
    const result = await buildDeliverabilityOverview(admin.clientId);
    if (!result.ok) return apiError(result.status, result.code, result.message);
    return apiSuccess(result.overview);
  } catch (err) {
    logError(err, { route: "admin.deliverability.overview", workspaceId: admin.clientId });
    return apiInternalError("Failed to load deliverability overview");
  }
}
