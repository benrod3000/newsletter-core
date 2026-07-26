/**
 * Open- and click-tracking injection.
 *
 * Lived in two places - send-campaign.ts (exported but never actually called on
 * the send path, so sent email carried no tracking at all) and a private copy in
 * app/web/[id]/route.ts. One copy now, used by both.
 */

/**
 * Links that must never be rewritten.
 *
 * Unsubscribe in particular: routing it through the click tracker makes
 * unsubscribing depend on the tracker being up, and records every unsubscribe
 * as a click. Both are bad - the first is a compliance risk under one-click
 * unsubscribe, the second quietly inflates engagement metrics.
 */
const UNTRACKED_PATHS = ["/api/track/", "/unsubscribe", "/api/unsubscribe"];

function shouldTrack(url: string): boolean {
  return !UNTRACKED_PATHS.some((path) => url.includes(path));
}

/**
 * Wrap outbound links with the click tracker and append an open pixel.
 * Both carry the campaign and subscriber so events can be attributed.
 */
export function injectTracking(
  html: string,
  campaignId: string,
  subscriberId: string,
  baseUrl: string
): string {
  const c = encodeURIComponent(campaignId);
  const s = encodeURIComponent(subscriberId);

  const result = html.replace(/href="(https?:\/\/[^"]+)"/gi, (match, url: string) => {
    if (!shouldTrack(url)) return match;
    return `href="${baseUrl}/api/track/click?c=${c}&s=${s}&u=${encodeURIComponent(url)}"`;
  });

  const pixel = `<img src="${baseUrl}/api/track/open?c=${c}&s=${s}" width="1" height="1" style="display:none" alt="">`;

  return result.includes("</body>")
    ? result.replace("</body>", `${pixel}</body>`)
    : result + pixel;
}
