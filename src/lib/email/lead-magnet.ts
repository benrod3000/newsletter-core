/**
 * lead-magnet.ts - delivering the file a capture widget promised.
 *
 * Widgets are **single opt-in**: the submit handler inserts the subscriber with
 * `confirmed: true`, and the widget copy says the link is on its way by email.
 * So this is a delivery email, not a double opt-in confirmation. The confirmation
 * flow in `confirmation-email.ts` carries a lead magnet too, but only for
 * `/api/subscribe`, where the address genuinely has to be confirmed first.
 *
 * Nothing sent this before. `widgets.download_url` is `NOT NULL` and the column
 * defaults promise delivery ("Check your inbox! The download link is on its
 * way."), but the only thing the submit handler did with it was hand it to a
 * `subscriber_joined` automation - and there are zero automation_triggers in
 * production, so the lookup returned an empty list and the function returned
 * without sending. Even with a trigger, automations run on a **daily** cron
 * (Vercel Hobby ceiling), so "on its way" would have meant up to 24 hours.
 * Two people requested Ben's resume and got nothing.
 *
 * The link is wrapped in `/api/track/click` with `kind=lead_magnet`, matching
 * what `/api/confirm` builds, because that click event is what populates
 * `lead_magnet_claimed` in the admin surface and the `claimed_offer` audience in
 * `campaign_audience()`. Both had been permanently empty for the same reason.
 */

import { escapeHtml, readableTextOn, DEFAULT_BRANDING, type Branding } from "@/lib/branding";
import { resolveTransactionalConfig, sendEmail } from "@/lib/email-sender";
import { logError } from "@/lib/logger";

export type LeadMagnetEmailResult = { sent: true } | { sent: false; reason: string };

/**
 * Wrap a lead magnet URL in a tracked click.
 *
 * `u` is `encodeURIComponent`-ed *before* `searchParams.set` encodes it again,
 * because `/api/track/click` reads it with a single `decodeURIComponent`. Keep
 * the double encoding: dropping it breaks any destination with a query string of
 * its own. `/api/confirm` builds the same shape - if you change one, change both.
 */
export function buildTrackedLeadMagnetUrl({
  appUrl,
  subscriberId,
  leadUrl,
  leadTitle,
}: {
  appUrl: string;
  subscriberId: string;
  leadUrl: string;
  leadTitle?: string | null;
}): string {
  const tracked = new URL("/api/track/click", appUrl);
  tracked.searchParams.set("s", subscriberId);
  tracked.searchParams.set("u", encodeURIComponent(leadUrl));
  tracked.searchParams.set("kind", "lead_magnet");
  if (leadTitle) tracked.searchParams.set("title", leadTitle);
  return tracked.toString();
}

/** Where the download button goes in an operator-written body. */
export const DOWNLOAD_LINK_TAG = "{{download_link}}";

/**
 * Turn an operator's plain-text body into HTML.
 *
 * Escaped, never interpolated raw: widget config is editable by any workspace
 * member, and this text is mailed to subscribers. Newlines become paragraphs, and
 * the one merge tag is replaced with the tracked button. If the tag is absent the
 * button is appended, because a delivery email with no way to reach the file is
 * the failure this whole change exists to fix.
 */
function renderOperatorBody(body: string, buttonHtml: string, textColor: string): string {
  const escaped = escapeHtml(body.trim());
  const withParagraphs = escaped
    .split(/\n{2,}/)
    .map((para) => `<p style="color:${textColor};font-size:15px;line-height:1.7;margin:0 0 20px;">${para.replace(/\n/g, "<br>")}</p>`)
    .join("");

  const tag = escapeHtml(DOWNLOAD_LINK_TAG);
  if (withParagraphs.includes(tag)) {
    return withParagraphs.replace(tag, buttonHtml);
  }
  return `${withParagraphs}${buttonHtml}`;
}

export async function sendLeadMagnetEmail({
  email,
  subscriberId,
  leadUrl,
  leadTitle,
  unsubscribeToken,
  baseUrl,
  audienceName,
  replyTo,
  emailSubject,
  emailBody,
  branding = DEFAULT_BRANDING,
}: {
  email: string;
  subscriberId: string;
  leadUrl: string;
  leadTitle: string | null;
  unsubscribeToken: string | null;
  /**
   * Origin that serves this backend's own routes, from `getBaseUrl(req)`.
   *
   * Passed in rather than read from the environment here, matching
   * `buildRecipientEmail`. The first version of this file used
   * `APP_URL ?? NEXT_PUBLIC_APP_URL`, and those two mean different things: APP_URL
   * is the **frontend** (it builds /dashboard and password-reset links) while
   * NEXT_PUBLIC_APP_URL is this API. So every tracked link pointed at the React
   * app, which has no /api/track/click route and rendered its 404 page. The email
   * arrived, the link was dead, and nothing on the server could notice.
   */
  baseUrl: string;
  audienceName?: string | null;
  replyTo?: string | null;
  /** Operator-written subject. Falls back to the built-in copy when empty. */
  emailSubject?: string | null;
  /** Operator-written body, plain text. Falls back to the built-in copy. */
  emailBody?: string | null;
  /**
   * The workspace's logo and colours, from `resolveBranding(client)`.
   *
   * This email is the first thing a subscriber ever receives, and it was fixed dark
   * grey with an amber button regardless of what the workspace had set - so a form
   * embedded on a branded site sent something that looked like it came from
   * somewhere else. Uses the same shell as `buildHtmlFromEditor`, so a lead magnet
   * and a campaign read as the same sender.
   */
  branding?: Branding;
}): Promise<LeadMagnetEmailResult> {
  const resolved = resolveTransactionalConfig();
  if (!resolved.ok) {
    logError(new Error("Lead magnet email is not configured."), {
      route: "email.lead-magnet",
      missing: resolved.missing,
    });
    return { sent: false, reason: "Email service is not configured." };
  }

  const label = leadTitle?.trim() || "your download";
  const safeLabel = escapeHtml(label);
  const sender = audienceName?.trim() || null;
  const safeSender = sender ? escapeHtml(sender) : null;

  try {
    const downloadUrl = buildTrackedLeadMagnetUrl({ appUrl: baseUrl, subscriberId, leadUrl, leadTitle });

    // CAN-SPAM requires the opt-out mechanism in the message itself, not only in
    // a header. A widget subscriber is on a list now, so this is not exempt.
    const unsubscribeUrl = unsubscribeToken
      ? `${baseUrl}/unsubscribe?token=${unsubscribeToken}`
      : null;

    const unsubscribeHtml = unsubscribeUrl
      ? `<br><a href="${unsubscribeUrl}" style="color:#71717a;text-decoration:underline;">Unsubscribe</a>`
      : "";
    const unsubscribeText = unsubscribeUrl ? `\nUnsubscribe: ${unsubscribeUrl}` : "";

    const { primary, secondary, logoUrl } = branding;
    const brandName = escapeHtml(branding.name);
    // The button carries the brand colour, so its label cannot be a fixed black.
    const buttonText = readableTextOn(primary);

    const buttonHtml = `
      <a href="${downloadUrl}"
         style="display:inline-block;background:${primary};color:${buttonText};font-size:14px;font-weight:700;padding:14px 28px;border-radius:8px;text-decoration:none;">
        Open ${safeLabel}
      </a>`;

    // A logo replaces the wordmark when one is set. width as an attribute as well
    // as a style, because Outlook ignores styles on images.
    const header = logoUrl
      ? `<img src="${escapeHtml(logoUrl)}" alt="${brandName}" width="160" style="max-width:160px;height:auto;display:block;margin:0 0 24px;border:0;">`
      : `<p style="color:${primary};font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;margin:0 0 20px;">
          ${brandName}
        </p>`;

    const customBody = emailBody?.trim();
    const bodyHtml = customBody
      ? renderOperatorBody(customBody, buttonHtml, "#e4e4e7")
      : `
      <h1 style="color:#ffffff;font-size:32px;font-weight:700;margin:0 0 16px;line-height:1.2;">
        Here&rsquo;s ${safeLabel}.
      </h1>
      <p style="color:#e4e4e7;font-size:15px;line-height:1.7;margin:0 0 32px;">
        Thanks for asking${safeSender ? ` about ${safeSender}` : ""}. The link below is yours.
      </p>${buttonHtml}`;

    const bodyText = customBody
      ? (customBody.includes(DOWNLOAD_LINK_TAG)
          ? customBody.replace(DOWNLOAD_LINK_TAG, downloadUrl)
          : `${customBody}\n\n${downloadUrl}`)
      : `Here's ${label}.\n\n${downloadUrl}`;

    const sent = await sendEmail(
      {
        to: email,
        from: resolved.from,
        ...(replyTo ? { replyTo } : {}),
        subject: emailSubject?.trim() || `Here's ${label}`,
        html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body style="background:${secondary};font-family:sans-serif;margin:0;padding:40px 24px;">
  <table style="max-width:600px;margin:0 auto;width:100%;">
    <tr><td>
      ${header}
      ${bodyHtml}
      <hr style="border:none;border-top:1px solid #27272a;margin:40px 0;">
      <p style="color:#71717a;font-size:12px;line-height:1.5;margin:0;">
        You received this because you requested it${safeSender ? ` from ${safeSender}` : ""}.${unsubscribeHtml}
      </p>
    </td></tr>
  </table>
</body>
</html>`,
        text: `${bodyText}\n\nYou received this because you requested it${sender ? ` from ${sender}` : ""}.${unsubscribeText}`,
        ...(unsubscribeUrl ? { listUnsubscribe: `<${unsubscribeUrl}>` } : {}),
      },
      resolved.config
    );

    if (!sent) return { sent: false, reason: "Email provider rejected the send request." };
    return { sent: true };
  } catch (err) {
    logError(err, { route: "email.lead-magnet", email });
    return { sent: false, reason: "Email provider rejected the send request." };
  }
}
