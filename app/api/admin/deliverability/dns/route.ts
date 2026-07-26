/**
 * GET /api/admin/deliverability/dns?domain=example.com
 *
 * Checks DNS records for a given domain. Supports checking:
 *   - The workspace's own sending domain
 *   - Custom tracking domains
 *   - Any external domain for diagnostics
 *
 * Auth: Admin (Basic Auth via proxy middleware)
 */

import { NextRequest } from "next/server";
import { getAdminContextFromHeaders } from "@/lib/admin-context";
import { checkAllDns } from "@/lib/deliverability/dns-checker";
import { isValidDomain, getWorkspaceProvider } from "@/lib/deliverability/overview";
import { apiSuccess, apiError, apiUnauthorized, apiInternalError } from "@/lib/api-response";
import { logError } from "@/lib/logger";
import type { DnsCheckResponse } from "@/lib/deliverability/types";

export async function GET(req: NextRequest) {
  const admin = getAdminContextFromHeaders(req.headers);
  if (!admin) return apiUnauthorized();

  try {
    const { searchParams } = new URL(req.url);
    const domain = searchParams.get("domain")?.trim().toLowerCase();

    if (!domain) {
      return apiError(422, "MISSING_DOMAIN", "Query parameter 'domain' is required");
    }

    if (!isValidDomain(domain)) {
      return apiError(422, "INVALID_DOMAIN", `"${domain}" is not a valid domain name`);
    }

    // If the admin has a workspace, use its provider for DKIM/SPF validation
    const provider = admin.clientId ? await getWorkspaceProvider(admin.clientId) : "sendgrid";

    const dnsHealth = await checkAllDns(domain, provider);

    const response: DnsCheckResponse = {
      domain,
      checkedAt: dnsHealth.checkedAt,
      provider,
      spf: dnsHealth.spf,
      dkim: dnsHealth.dkim,
      dmarc: dnsHealth.dmarc,
      mx: dnsHealth.mx,
    };

    return apiSuccess(response);
  } catch (err) {
    // Don't echo err.message to the client - it leaks internals.
    logError(err, { route: "admin.deliverability.dns" });
    return apiInternalError("DNS check failed");
  }
}
