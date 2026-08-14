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
function renderOperatorBody(
  body: string,
  buttonHtml: string,
  textColor: string,
  linkColor: string
): string {
  const escaped = escapeHtml(body.trim());

  // Bare URLs become links. Runs *after* escaping, and only matches http(s), so
  // nothing here can introduce markup - a signature reading "brod3000.com" should
  // be clickable without the operator having to write HTML they cannot write anyway.
  const linkify = (text: string) =>
    text.replace(
      /\bhttps?:\/\/[^\s<]+|\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s<]*)?/gi,
      (match) => {
        if (match.includes("&lt;") || match.includes("&gt;")) return match;
        const href = match.startsWith("http") ? match : `https://${match}`;
        return `<a href="${href}" style="color:${linkColor};text-decoration:underline;">${match}</a>`;
      }
    );

  const withParagraphs = escaped
    .split(/\n{2,}/)
    .map(
      (para) =>
        `<p style="color:${textColor};font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.65;margin:0 0 18px;">${linkify(
          para.replace(/\n/g, "<br>")
        )}</p>`
    )
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
  emailHeading,
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
   * The large headline. Its own field rather than the first line of the body,
   * because it is set in different type at a different size - folding it into the
   * body would mean guessing which paragraph was meant to be shouted.
   */
  emailHeading?: string | null;
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

    // Palette. `ink` is the near-black used for every border and for headline
    // type; `ground` is the warm off-white the card sits on. The brand colour is
    // used as fill - a top rule and the button - never as body text, which is what
    // keeps a bright yellow legible.
    const ink = secondary;
    const ground = "#f5f5f0";
    const card = "#f7f7f4";
    const body = "#3f3f46";
    const hairline = "#d4d4d0";
    const buttonText = readableTextOn(primary);

    // Boxed wordmark: outlined rather than filled, so it reads as a mark instead of
    // a highlight. A logo replaces it when one is set - width as an attribute as
    // well as a style, because Outlook ignores styles on images.
    const header = logoUrl
      ? `<img src="${escapeHtml(logoUrl)}" alt="${brandName}" width="150" style="max-width:150px;height:auto;display:block;margin:0 0 34px;border:0;">`
      : `<table cellpadding="0" cellspacing="0" border="0" style="margin:0 0 34px;"><tr><td style="border:3px solid ${ink};padding:9px 14px;">
          <span style="color:${ink};font-family:Helvetica,Arial,sans-serif;font-size:15px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;">${brandName}</span>
        </td></tr></table>`;

    const heading = emailHeading?.trim() || `Here's ${label}`;
    const headingHtml = `
      <h1 style="color:${ink};font-family:Helvetica,Arial,sans-serif;font-size:44px;font-weight:800;letter-spacing:-0.025em;text-transform:uppercase;line-height:0.92;margin:0 0 28px;">
        ${escapeHtml(heading)}
      </h1>
      <div style="border-top:1px solid ${hairline};font-size:0;line-height:0;margin:0 0 26px;">&nbsp;</div>`;

    const buttonHtml = `
      <table cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 28px;">
        <tr><td style="background:${primary};border:3px solid ${ink};">
          <a href="${downloadUrl}"
             style="display:block;color:${buttonText};font-family:Helvetica,Arial,sans-serif;font-size:15px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;padding:16px 40px;text-decoration:none;">
            Open ${safeLabel}
          </a>
        </td></tr>
      </table>`;

    const customBody = emailBody?.trim();
    const bodyHtml = customBody
      ? renderOperatorBody(customBody, buttonHtml, body, ink)
      : `
      <p style="color:${body};font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.65;margin:0 0 18px;">
        Here&rsquo;s ${safeLabel}, as requested${safeSender ? ` from ${safeSender}` : ""}.
      </p>${buttonHtml}`;

    // The plain-text alternative. Not decoration: a message with no text part is a
    // spam signal, and some clients render it by preference. Mirrors the same
    // order - heading, body, link, why-you-got-this - so the two do not drift.
    const bodyText = customBody
      ? customBody.includes(DOWNLOAD_LINK_TAG)
        ? customBody.replace(DOWNLOAD_LINK_TAG, downloadUrl)
        : `${customBody}\n\n${downloadUrl}`
      : `${heading}\n\nHere's ${label}, as requested${sender ? ` from ${sender}` : ""}.\n\n${downloadUrl}`;

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
<body style="background:${ground};font-family:Helvetica,Arial,sans-serif;margin:0;padding:0;">
  <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${ground};">
    <tr><td align="center" style="padding:24px 12px 40px;">
      <table cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px;background:${card};border:1px solid ${hairline};">
        <!-- Brand rule. The one place the colour appears at full strength. -->
        <tr><td style="height:8px;background:${primary};font-size:0;line-height:0;">&nbsp;</td></tr>
        <tr><td style="padding:34px 32px 30px;">
          ${header}
          ${headingHtml}
          ${bodyHtml}
          <div style="border-top:1px solid ${hairline};font-size:0;line-height:0;margin:8px 0 22px;">&nbsp;</div>
          <p style="color:#71717a;font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:1.6;margin:0 0 8px;">
            You received this because you requested ${safeLabel}${safeSender ? ` from ${safeSender}` : ""}.${unsubscribeHtml}
          </p>
          <p style="color:#a1a1aa;font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:1.6;margin:0;">
            If the button does not work, use this link:<br>
            <a href="${downloadUrl}" style="color:#71717a;text-decoration:underline;word-break:break-all;">${escapeHtml(downloadUrl)}</a>
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
