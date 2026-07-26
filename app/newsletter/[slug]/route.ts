import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";
import { sanitizeCampaignHtml, sanitizeCampaignCss } from "@/lib/sanitize-campaign-html";

/**
 * GET /newsletter/{slug}
 * Serves a publicly-archived newsletter by its slug.
 * Returns HTML that can be shared, indexed by search engines, and embedded.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const supabase = getSupabaseClient();
  const { data: campaign, error } = await supabase
    .from("campaigns")
    .select("title, subject, editor_html, editor_css, published_at, client_id")
    .eq("public_slug", slug)
    .eq("public_archive", true)
    .single();

  if (error || !campaign) {
    return new NextResponse("Not found", { status: 404 });
  }

  // Also fetch workspace name for branding
  const { data: client } = await supabase
    .from("clients")
    .select("sender_name")
    .eq("id", campaign.client_id)
    .single();

  const senderName = client?.sender_name || "Veloce";
  // Authored by a workspace user and served from an origin every tenant shares,
  // on a page marked indexable - never interpolate either of these raw.
  const html = sanitizeCampaignHtml(campaign.editor_html);
  const css = sanitizeCampaignCss(campaign.editor_css);
  const pubDate = campaign.published_at
    ? new Date(campaign.published_at).toLocaleDateString("en-US", {
        year: "numeric", month: "long", day: "numeric",
      })
    : "";

  const pageHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(campaign.title || campaign.subject || "Newsletter")}: ${escapeHtml(senderName)}</title>
  <meta name="description" content="${escapeHtml(campaign.subject || "")}" />
  <meta property="og:title" content="${escapeHtml(campaign.title || campaign.subject || "Newsletter")}" />
  <meta property="og:description" content="${escapeHtml(campaign.subject || "")}" />
  <meta property="og:type" content="article" />
  <meta name="robots" content="index, follow" />
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; max-width: 650px; margin: 0 auto; padding: 24px 16px; color: #1a1a1a; line-height: 1.6; }
    .meta { font-size: 13px; color: #888; margin-bottom: 32px; border-bottom: 2px solid #eee; padding-bottom: 16px; }
    .meta h1 { font-size: 28px; color: #000; margin: 0 0 4px; }
    img { max-width: 100%; height: auto; }
    ${css}
  </style>
</head>
<body>
  <div class="meta">
    <h1>${escapeHtml(campaign.title || campaign.subject || "Newsletter")}</h1>
    ${pubDate ? `<p>${escapeHtml(senderName)} · ${pubDate}</p>` : ""}
  </div>
  <div class="content">
    ${html}
  </div>
</body>
</html>`;

  return new NextResponse(pageHtml, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
