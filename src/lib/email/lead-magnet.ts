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
  // The From name is the workspace's, not the product's. The address stays on the
  // platform's verified domain, which is what SPF and DKIM are bound to.
  const resolved = resolveTransactionalConfig(branding.name);
  if (!resolved.ok) {
    logError(new Error("Lead magnet email is not configured."), {
      route: "email.lead-magnet",
      missing: resolved.missing,
    });
    return { sent: false, reason: "Email service is not configured." };
  }

  const label = leadTitle?.trim() || "your download";
  const safeLabel = escapeHtml(label);
  // Who this is from, in the recipient's terms. This used to be handed the
  // widget's `name`, which is an internal label an operator picks for their own
  // list - so a resume form sent "Thanks for asking about RESUME". The brand name
  // is what a subscriber recognises.
  const sender = audienceName?.trim() || branding.name?.trim() || null;
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
    // The neobrutalist system is built on a near-black ink for borders and text on
    // a warm off-white ground, with the brand colour used as a block of fill rather
    // than as text. `secondary` is the workspace's dark colour, so it becomes the
    // ink; the ground is fixed light because a bordered card needs something to sit
    // on and email clients handle light backgrounds far more predictably than dark
    // ones under forced dark mode.
    const ink = secondary;
    const ground = "#f5f5f0";
    const body = "#3f3f46";
    // The button carries the brand colour, so its label cannot be a fixed black.
    const buttonText = readableTextOn(primary);

    // Squared corners, a hard border and an offset shadow, matching the product's
    // own visual system. A rounded amber pill on dark grey was generic email
    // styling that happened to use the brand's colour - the shape carries as much
    // of the identity as the palette does.
    const buttonHtml = `
      <table cellpadding="0" cellspacing="0" border="0" style="margin:0 0 8px;">
        <tr><td style="background:${ink};padding:0;">
          <a href="${downloadUrl}"
             style="display:inline-block;background:${primary};color:${buttonText};font-family:Helvetica,Arial,sans-serif;font-size:14px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;padding:16px 32px;border:3px solid ${ink};text-decoration:none;position:relative;left:-4px;top:-4px;">
            Open ${safeLabel}
          </a>
        </td></tr>
      </table>`;

    // A logo replaces the wordmark when one is set. width as an attribute as well
    // as a style, because Outlook ignores styles on images.
    const header = logoUrl
      ? `<img src="${escapeHtml(logoUrl)}" alt="${brandName}" width="150" style="max-width:150px;height:auto;display:block;margin:0 0 26px;border:0;">`
      : `<p style="display:inline-block;background:${ink};color:${ground};font-family:Helvetica,Arial,sans-serif;font-size:12px;font-weight:800;letter-spacing:0.16em;text-transform:uppercase;padding:8px 14px;margin:0 0 26px;">
          ${brandName}
        </p>`;

    const customBody = emailBody?.trim();
    const bodyHtml = customBody
      ? renderOperatorBody(customBody, buttonHtml, body)
      : `
      <h1 style="color:${ink};font-family:Helvetica,Arial,sans-serif;font-size:34px;font-weight:800;letter-spacing:-0.02em;text-transform:uppercase;line-height:0.95;margin:0 0 18px;">
        Here&rsquo;s ${safeLabel}
      </h1>
      <div style="height:8px;width:88px;background:${primary};border:2px solid ${ink};margin:0 0 22px;"></div>
      <p style="color:${body};font-size:15px;line-height:1.7;margin:0 0 28px;">
        Thanks for asking${safeSender ? ` from ${safeSender}` : ""}. The link below is yours.
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
<body style="background:${ground};font-family:Helvetica,Arial,sans-serif;margin:0;padding:32px 16px;">
  <table cellpadding="0" cellspacing="0" border="0" style="max-width:600px;margin:0 auto;width:100%;">
    <tr><td style="background:${ink};">
      <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#ffffff;border:3px solid ${ink};position:relative;left:-5px;top:-5px;">
        <tr><td style="height:10px;background:${primary};border-bottom:3px solid ${ink};"></td></tr>
        <tr><td style="padding:34px 30px 30px;">
          ${header}
          ${bodyHtml}
        </td></tr>
        <tr><td style="border-top:3px solid ${ink};background:${ground};padding:18px 30px;">
          <p style="color:#71717a;font-size:11px;line-height:1.6;margin:0;letter-spacing:0.02em;">
            You received this because you requested it${safeSender ? ` from ${safeSender}` : ""}.${unsubscribeHtml}
          </p>
        </td></tr>
      </table>
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
