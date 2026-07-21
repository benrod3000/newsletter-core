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
import { getSupabaseClient } from "@/lib/supabase";
import { checkAllDns } from "@/lib/deliverability/dns-checker";
import { apiSuccess, apiError, apiUnauthorized, apiForbidden, apiInternalError } from "@/lib/api-response";
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

    // Basic domain validation
    if (!/^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)+$/.test(domain)) {
      return apiError(422, "INVALID_DOMAIN", `"${domain}" is not a valid domain name`);
    }

    // If admin has a workspace, use their provider for DKIM/SPF validation
    let provider = "sendgrid";
    if (admin.clientId) {
      const supabase = getSupabaseClient();
      const { data: client } = await supabase
        .from("clients")
        .select("email_provider")
        .eq("id", admin.clientId)
        .maybeSingle();
      if (client?.email_provider) {
        provider = client.email_provider;
      }
    }

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
  } catch (err: any) {
    console.error("[deliverability/dns] Error:", err?.message || err);
    return apiInternalError(err?.message || "DNS check failed");
  }
}
