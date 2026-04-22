import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";
import { buildHtmlFromEditor, buildWebVersionUrl, mergeDataForRecipient, renderTemplate, type MergeRecipient } from "@/lib/campaign-personalization";

type WebCampaign = {
  id: string;
  subject: string;
  status: "draft" | "scheduled" | "sent";
  editor_html: string;
  editor_css: string | null;
};

function injectTracking(
  html: string,
  campaignId: string,
  subscriberId: string,
  baseUrl: string
): string {
  return html.replace(/href="(https?:\/\/[^\"]+)"/gi, (_match, url: string) => {
    if (url.includes("/api/track/")) return `href="${url}"`;
    return `href="${baseUrl}/api/track/click?c=${encodeURIComponent(campaignId)}&s=${encodeURIComponent(subscriberId)}&u=${encodeURIComponent(url)}"`;
  });
}

function getBaseUrl(req: NextRequest): string {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL;
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
  return `${proto}://${host}`;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const subscriberId = req.nextUrl.searchParams.get("s");
  const supabase = getSupabaseClient();

  const { data: campaign } = await supabase
    .from("campaigns")
    .select("id, subject, status, editor_html, editor_css")
    .eq("id", id)
    .maybeSingle<WebCampaign>();

  if (!campaign || campaign.status !== "sent") {
    return new NextResponse("Not found", { status: 404 });
  }

  const baseHtml = buildHtmlFromEditor(campaign.editor_html, campaign.editor_css || "");

  if (!subscriberId) {
    const html = renderTemplate(baseHtml, { web_version_url: "" });
    return new NextResponse(html, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  const { data: subscriber } = await supabase
    .from("subscribers")
    .select("id, email, country, region, city, unsubscribe_token, first_name, last_name, date_of_birth, phone_number")
    .eq("id", subscriberId)
    .maybeSingle<MergeRecipient>();

  if (!subscriber) {
    return new NextResponse("Not found", { status: 404 });
  }

  const baseUrl = getBaseUrl(req);
  const unsubscribeUrl = `${baseUrl}/unsubscribe?token=${subscriber.unsubscribe_token}`;
  const webVersionUrl = buildWebVersionUrl(baseUrl, campaign.id, subscriber.id);
  const mergeData = mergeDataForRecipient(subscriber, unsubscribeUrl, webVersionUrl);
  const renderedHtml = renderTemplate(baseHtml, mergeData);
  const trackedHtml = injectTracking(renderedHtml, campaign.id, subscriber.id, baseUrl);

  return new NextResponse(trackedHtml, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}