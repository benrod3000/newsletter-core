/**
 * confirmation-email.ts - the double opt-in confirmation email.
 *
 * This used to live privately inside `app/api/subscribe/route.ts` and was
 * hardcoded to SendGrid: it read `SENDGRID_API_KEY` and `SENDGRID_FROM_EMAIL`
 * and returned `{ sent: false }` when either was absent. Neither has ever
 * existed in this project's Vercel environment, so **no confirmation email has
 * ever been sent**, by either caller, for the life of the project.
 *
 * That is the same failure already fixed once in `sendTransactionalEmail`; this
 * was a second copy of it in a different file. Credentials now resolve through
 * `resolveTransactionalConfig()` so there is one answer to "how does this
 * platform send mail" rather than three.
 *
 * Why it matters beyond the email itself: the confirm link carries the lead
 * magnet, so a whole chain downstream of it was dead too - `/api/confirm` builds
 * a tracked lead-magnet URL, `/api/track/click` records
 * `tracking_kind: 'lead_magnet'`, the admin surface derives
 * `lead_magnet_claimed` from those events, and `campaign_audience()` exposes a
 * `claimed_offer` audience. None of it could ever populate.
 *
 * Sender identity is deliberately the **platform** address, not the workspace's.
 * A confirmation is sent before the subscriber has agreed to anything, and the
 * signup can arrive at a workspace with no provider configured at all. Per-
 * workspace sending identity is the direction ARCHITECTURE.md wants; when that
 * lands, this is the call site to change, and `replyTo` below is the seam for it.
 */

import { escapeHtml } from "@/lib/branding";
import { resolveTransactionalConfig, sendEmail } from "@/lib/email-sender";
import { logError } from "@/lib/logger";

export interface SignupSnapshot {
  firstName: string | null;
  lastName: string | null;
  dateOfBirth: string | null;
  phoneNumber: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  timezone: string | null;
  locale: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  referrer: string | null;
  landingPath: string | null;
}

export const EMPTY_SIGNUP_SNAPSHOT: SignupSnapshot = {
  firstName: null,
  lastName: null,
  dateOfBirth: null,
  phoneNumber: null,
  country: null,
  region: null,
  city: null,
  timezone: null,
  locale: null,
  utmSource: null,
  utmMedium: null,
  utmCampaign: null,
  referrer: null,
  landingPath: null,
};

export interface ConfirmationEmailParams {
  email: string;
  confirmationToken: string;
  unsubscribeToken: string;
  /**
   * Origin serving this backend's routes, from `getBaseUrl(req)`. Not APP_URL:
   * that is the frontend, and /api/confirm lives here.
   */
  baseUrl: string;
  /** Name of the thing being unlocked, e.g. a widget's headline. */
  leadTitle: string | null;
  /** The lead magnet itself. Travels on the confirm link, never in this email. */
  leadUrl: string | null;
  snapshot: SignupSnapshot;
  /**
   * What the subscriber signed up to, in their words. Previously hardcoded to
   * one specific newsletter's name, which was wrong for every other workspace -
   * a resume-request widget sent an email naming an unrelated publication.
   */
  audienceName?: string | null;
  /** Where replies should go. Use the workspace's sender when it has one. */
  replyTo?: string | null;
}

export type ConfirmationEmailResult = { sent: true } | { sent: false; reason: string };

export function buildCapturedSignals(snapshot: SignupSnapshot): Array<{ label: string; value: string }> {
  const fullName = [snapshot.firstName, snapshot.lastName].filter(Boolean).join(" ").trim();
  const location = [snapshot.city, snapshot.region, snapshot.country].filter(Boolean).join(", ").trim();
  const sourceParts = [snapshot.utmSource, snapshot.utmMedium, snapshot.utmCampaign].filter(Boolean).join(" / ").trim();

  return [
    fullName ? { label: "Profile", value: fullName } : null,
    snapshot.phoneNumber ? { label: "Phone", value: snapshot.phoneNumber } : null,
    snapshot.dateOfBirth ? { label: "Birthday", value: snapshot.dateOfBirth } : null,
    location ? { label: "Location", value: location } : null,
    snapshot.timezone ? { label: "Timezone", value: snapshot.timezone } : null,
    snapshot.locale ? { label: "Locale", value: snapshot.locale } : null,
    sourceParts ? { label: "Campaign Source", value: sourceParts } : null,
    snapshot.referrer ? { label: "Referrer", value: snapshot.referrer } : null,
    snapshot.landingPath ? { label: "Landing Path", value: snapshot.landingPath } : null,
  ].filter((item): item is { label: string; value: string } => Boolean(item));
}

export async function sendConfirmationEmail({
  email,
  confirmationToken,
  unsubscribeToken,
  baseUrl,
  leadTitle,
  leadUrl,
  snapshot,
  audienceName,
  replyTo,
}: ConfirmationEmailParams): Promise<ConfirmationEmailResult> {
  const resolved = resolveTransactionalConfig();
  if (!resolved.ok) {
    // Not thrown: a signup that cannot be confirmed is still a signup worth
    // keeping, and the caller reports this to the visitor rather than pretending
    // the email went out.
    logError(new Error("Confirmation email is not configured."), {
      route: "email.confirmation",
      missing: resolved.missing,
    });
    return { sent: false, reason: "Email service is not configured." };
  }

  // Escaped because both reach an HTML body and both are caller-supplied:
  // `lead_title` arrives in the /api/subscribe request body, so an unescaped
  // value let a caller inject markup into mail sent to an address of their
  // choosing.
  const audienceLabel = audienceName?.trim() || "this list";
  const safeAudience = escapeHtml(audienceLabel);
  const leadLabel = leadTitle?.trim() || "free download";
  const safeLeadLabel = escapeHtml(leadLabel);

  try {
    const confirmParams = new URLSearchParams({ token: confirmationToken });
    if (leadTitle) confirmParams.set("lead_title", leadTitle);
    if (leadUrl) confirmParams.set("lead_url", leadUrl);
    const confirmUrl = `${baseUrl}/api/confirm?${confirmParams.toString()}`;
    const unsubscribeUrl = `${baseUrl}/unsubscribe?token=${unsubscribeToken}`;

    const capturedSignals = buildCapturedSignals(snapshot);
    const capturedHtml = capturedSignals.length
      ? `
      <div style="margin:0 0 28px;padding:16px 18px;border:1px solid #27272a;border-radius:10px;background:#111114;">
        <p style="margin:0 0 10px;color:#f4f4f5;font-size:13px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;">
          What this signup captured
        </p>
        ${capturedSignals
          .map(
            (item) => `
          <p style="margin:0 0 8px;color:#a1a1aa;font-size:13px;line-height:1.5;">
            <strong style="color:#fff;">${escapeHtml(item.label)}:</strong> ${escapeHtml(item.value)}
          </p>`
          )
          .join("")}
      </div>`
      : "";
    const capturedText = capturedSignals.length
      ? `\n\nWhat this signup captured:\n${capturedSignals.map((item) => `- ${item.label}: ${item.value}`).join("\n")}`
      : "";

    const offerLine = leadUrl ? `\n\nConfirm to unlock: ${leadLabel}.` : "";

    const sent = await sendEmail(
      {
        to: email,
        from: resolved.from,
        ...(replyTo ? { replyTo } : {}),
        subject: leadUrl ? `Confirm your email to get ${leadLabel}` : "Confirm your subscription",
        html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="background:#0d0d0d;font-family:sans-serif;margin:0;padding:40px 24px;">
  <table style="max-width:520px;margin:0 auto;width:100%;">
    <tr><td>
      <h1 style="color:#fff;font-size:32px;font-weight:700;margin:0 0 16px;line-height:1.2;">
        One click to confirm.
      </h1>
      <p style="color:#a1a1aa;font-size:15px;line-height:1.6;margin:0 0 32px;">
        You signed up for <strong style="color:#fff;">${safeAudience}</strong>.
        Hit the button below to confirm and you&rsquo;re in.${leadUrl ? ` You&rsquo;ll also get your <strong style="color:#fff;">${safeLeadLabel}</strong>.` : ""}
      </p>
      ${capturedHtml}
      <a href="${confirmUrl}"
         style="display:inline-block;background:#fbbf24;color:#000;font-size:14px;font-weight:700;padding:14px 28px;border-radius:8px;text-decoration:none;">
        ${leadUrl ? "Confirm and get my download" : "Confirm my subscription"}
      </a>
      <hr style="border:none;border-top:1px solid #27272a;margin:40px 0;">
      <p style="color:#52525b;font-size:12px;line-height:1.5;margin:0;">
        If you didn&rsquo;t sign up for this, you can safely ignore this email.<br>
        <a href="${unsubscribeUrl}" style="color:#52525b;">Unsubscribe</a>
      </p>
    </td></tr>
  </table>
</body>
</html>`,
        text: `Confirm your subscription to ${audienceLabel}.${offerLine}${capturedText}\n\nVisit this link to confirm:\n${confirmUrl}\n\nIf you didn't sign up, ignore this email.\nUnsubscribe: ${unsubscribeUrl}`,
        listUnsubscribe: `<${unsubscribeUrl}>`,
      },
      resolved.config
    );

    if (!sent) {
      return { sent: false, reason: "Email provider rejected the send request." };
    }

    return { sent: true };
  } catch (emailErr) {
    logError(emailErr, { route: "email.confirmation", email });
    return { sent: false, reason: "Email provider rejected the send request." };
  }
}
