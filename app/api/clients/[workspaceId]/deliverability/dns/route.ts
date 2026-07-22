/**
 * GET /api/clients/[workspaceId]/deliverability/dns?domain=example.com
 *
 * Checks SPF, DKIM, DMARC and MX for a domain, validated against the
 * workspace's configured email provider.
 *
 * Auth: client JWT.
 */

import { NextRequest } from "next/server";
import { getClientContextFromJWT, assertWorkspaceAccess } from "@/lib/client-context";
import { checkAllDns } from "@/lib/deliverability/dns-checker";
import { isValidDomain, getWorkspaceProvider } from "@/lib/deliverability/overview";
import { apiSuccess, apiError, apiUnauthorized, apiInternalError } from "@/lib/api-response";
import { logError } from "@/lib/logger";
import type { DnsCheckResponse } from "@/lib/deliverability/types";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params;
  const ctx = getClientContextFromJWT(req);
  if (!ctx || !assertWorkspaceAccess(ctx, workspaceId)) return apiUnauthorized();

  try {
    const domain = new URL(req.url).searchParams.get("domain")?.trim().toLowerCase();

    if (!domain) {
      return apiError(422, "MISSING_DOMAIN", "Query parameter 'domain' is required");
    }
    if (!isValidDomain(domain)) {
      return apiError(422, "INVALID_DOMAIN", `"${domain}" is not a valid domain name`);
    }

    const provider = await getWorkspaceProvider(workspaceId);
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
    logError(err, { route: "clients.deliverability.dns", workspaceId });
    return apiInternalError("DNS check failed");
  }
}
