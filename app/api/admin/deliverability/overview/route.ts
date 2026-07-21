/**
 * GET /api/admin/deliverability/overview
 *
 * Returns deliverability health overview for the admin's workspace:
 *   - DNS health (SPF, DKIM, DMARC, MX)
 *   - Bounce & complaint rates (last 30 days)
 *   - Overall score (0–100)
 *   - Prioritized recommendations
 *
 * Auth: Admin (Basic Auth via proxy middleware)
 */

import { NextRequest } from "next/server";
import { getAdminContextFromHeaders } from "@/lib/admin-context";
import { getSupabaseClient } from "@/lib/supabase";
import { checkAllDns } from "@/lib/deliverability/dns-checker";
import {
  calculateDnsScore,
  calculateBounceScore,
  calculateComplaintScore,
  calculateOverallScore,
  generateRecommendations,
} from "@/lib/deliverability/scoring";
import { apiSuccess, apiError, apiUnauthorized, apiForbidden, apiInternalError } from "@/lib/api-response";
import type { DeliverabilityOverview } from "@/lib/deliverability/types";

export async function GET(req: NextRequest) {
  const admin = getAdminContextFromHeaders(req.headers);
  if (!admin) return apiUnauthorized();
  if (!admin.clientId) return apiForbidden("No workspace assigned");

  const workspaceId = admin.clientId;

  try {
    const supabase = getSupabaseClient();

    // 1. Fetch workspace config (sender email domain + provider)
    const { data: client, error: clientErr } = await supabase
      .from("clients")
      .select("email_provider, sender_email, sandbox_mode")
      .eq("id", workspaceId)
      .maybeSingle();

    if (clientErr || !client) {
      return apiError(404, "WORKSPACE_NOT_FOUND", "Workspace not found");
    }

    const senderEmail = client.sender_email || "";
    const domain = senderEmail.includes("@")
      ? senderEmail.split("@")[1]
      : senderEmail;
    const provider = client.email_provider || "sendgrid";

    if (!domain) {
      return apiError(422, "NO_SENDER_DOMAIN", "No sender email configured. Set a sender email in Settings first.");
    }

    // 2. DNS health check
    const dnsHealth = await checkAllDns(domain, provider);
    const dnsScore = calculateDnsScore(dnsHealth);

    // 3. Bounce & complaint rates (last 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const { data: eventsData, error: eventsErr } = await supabase
      .from("campaign_events")
      .select("event_type")
      .in("event_type", ["bounce", "complaint"])
      .gte("occurred_at", thirtyDaysAgo)
      .in("campaign_id", supabase
        .from("campaigns")
        .select("id")
        .eq("client_id", workspaceId)
      );

    // Fallback: query via raw approach if the nested query doesn't work
    let bounceCount = 0;
    let complaintCount = 0;

    if (!eventsErr && eventsData) {
      bounceCount = eventsData.filter((e: { event_type: string }) => e.event_type === "bounce").length;
      complaintCount = eventsData.filter((e: { event_type: string }) => e.event_type === "complaint").length;
    } else {
      // Fallback: query campaign IDs first, then events
      const { data: campaigns } = await supabase
        .from("campaigns")
        .select("id")
        .eq("client_id", workspaceId);

      if (campaigns && campaigns.length > 0) {
        const campaignIds = campaigns.map((c: { id: string }) => c.id);
        const { data: events } = await supabase
          .from("campaign_events")
          .select("event_type")
          .in("event_type", ["bounce", "complaint"])
          .in("campaign_id", campaignIds)
          .gte("occurred_at", thirtyDaysAgo);

        if (events) {
          bounceCount = events.filter((e: { event_type: string }) => e.event_type === "bounce").length;
          complaintCount = events.filter((e: { event_type: string }) => e.event_type === "complaint").length;
        }
      }
    }

    // Total sends in the period
    const { data: sentData } = await supabase
      .from("campaigns")
      .select("sent_count")
      .eq("client_id", workspaceId)
      .gte("last_sent_at", thirtyDaysAgo);

    const totalSends = (sentData || []).reduce(
      (sum: number, c: { sent_count?: number }) => sum + (c.sent_count || 0),
      0,
    );

    // Calculate rates (avoid division by zero)
    const bounceRate = totalSends > 0 ? bounceCount / totalSends : 0;
    const complaintRate = totalSends > 0 ? complaintCount / totalSends : 0;
    const bounceScore = calculateBounceScore(bounceRate);
    const complaintScore = calculateComplaintScore(complaintRate);

    // 4. Overall score
    const score = calculateOverallScore(dnsScore, bounceScore, complaintScore);

    // 5. Recommendations
    const recommendations = generateRecommendations(dnsHealth, bounceRate, complaintRate);

    const overview: DeliverabilityOverview = {
      score,
      dnsScore,
      bounceScore,
      complaintScore,
      dnsHealth,
      bounceRate: Math.round(bounceRate * 10000) / 10000,
      complaintRate: Math.round(complaintRate * 10000) / 10000,
      totalSends,
      recommendations,
    };

    return apiSuccess(overview);
  } catch (err: any) {
    console.error("[deliverability/overview] Error:", err?.message || err);
    return apiInternalError(err?.message || "Failed to load deliverability overview");
  }
}
