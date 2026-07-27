/**
 * Deliverability overview for a workspace.
 *
 * Extracted from the admin route so the admin (Basic Auth) and client (JWT)
 * endpoints share one implementation. The computation only ever needed a
 * workspace id - it was never admin-specific.
 */

import { getSupabaseClient } from "@/lib/supabase";
import { checkAllDns } from "@/lib/deliverability/dns-checker";
import {
  calculateDnsScore,
  calculateBounceScore,
  calculateComplaintScore,
  calculateOverallScore,
  generateRecommendations,
} from "@/lib/deliverability/scoring";
import type { DeliverabilityOverview } from "@/lib/deliverability/types";

/** Evaluation window for bounce and complaint rates. */
const WINDOW_DAYS = 30;

export type OverviewResult =
  | { ok: true; overview: DeliverabilityOverview }
  | { ok: false; status: number; code: string; message: string };

export async function buildDeliverabilityOverview(
  workspaceId: string
): Promise<OverviewResult> {
  const supabase = getSupabaseClient();

  const { data: client, error: clientErr } = await supabase
    .from("clients")
    .select("email_provider, sender_email")
    .eq("id", workspaceId)
    .maybeSingle();

  if (clientErr || !client) {
    return { ok: false, status: 404, code: "WORKSPACE_NOT_FOUND", message: "Workspace not found" };
  }

  const senderEmail = client.sender_email || "";
  const domain = senderEmail.includes("@") ? senderEmail.split("@")[1] : senderEmail;
  const provider = client.email_provider || "sendgrid";

  if (!domain) {
    return {
      ok: false,
      status: 422,
      code: "NO_SENDER_DOMAIN",
      message: "No sender email configured. Set a sender email in Settings first.",
    };
  }

  const dnsHealth = await checkAllDns(domain, provider);
  const dnsScore = calculateDnsScore(dnsHealth);

  const windowStart = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data: campaigns } = await supabase
    .from("campaigns")
    .select("id")
    .eq("workspace_id", workspaceId);

  const campaignIds = (campaigns || []).map((c: { id: string }) => c.id);

  let bounceCount = 0;
  let complaintCount = 0;

  if (campaignIds.length > 0) {
    const { data: events } = await supabase
      .from("campaign_events")
      .select("event_type")
      .in("event_type", ["bounce", "complaint"])
      .in("campaign_id", campaignIds)
      .gte("occurred_at", windowStart);

    if (events) {
      bounceCount = events.filter((e: { event_type: string }) => e.event_type === "bounce").length;
      complaintCount = events.filter((e: { event_type: string }) => e.event_type === "complaint").length;
    }
  }

  const { data: sentData } = await supabase
    .from("campaigns")
    .select("sent_count")
    .eq("workspace_id", workspaceId)
    .gte("last_sent_at", windowStart);

  const totalSends = (sentData || []).reduce(
    (sum: number, c: { sent_count?: number }) => sum + (c.sent_count || 0),
    0
  );

  const bounceRate = totalSends > 0 ? bounceCount / totalSends : 0;
  const complaintRate = totalSends > 0 ? complaintCount / totalSends : 0;
  const bounceScore = calculateBounceScore(bounceRate);
  const complaintScore = calculateComplaintScore(complaintRate);

  return {
    ok: true,
    overview: {
      score: calculateOverallScore(dnsScore, bounceScore, complaintScore),
      dnsScore,
      bounceScore,
      complaintScore,
      dnsHealth,
      bounceRate: Math.round(bounceRate * 10000) / 10000,
      complaintRate: Math.round(complaintRate * 10000) / 10000,
      totalSends,
      recommendations: generateRecommendations(dnsHealth, bounceRate, complaintRate),
    },
  };
}

/** Shared domain-shape validation for the DNS check endpoints. */
export function isValidDomain(domain: string): boolean {
  return /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)+$/.test(
    domain
  );
}

/** Resolve the email provider configured for a workspace, defaulting to sendgrid. */
export async function getWorkspaceProvider(workspaceId: string): Promise<string> {
  const { data } = await getSupabaseClient()
    .from("clients")
    .select("email_provider")
    .eq("id", workspaceId)
    .maybeSingle();
  return data?.email_provider || "sendgrid";
}
