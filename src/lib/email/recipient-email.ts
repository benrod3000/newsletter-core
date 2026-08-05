import {
  buildWebVersionUrl,
  mergeDataForRecipient,
  renderTemplate,
  type MergeRecipient,
} from "@/lib/campaign-personalization";
import { injectTracking } from "@/lib/campaign-tracking";

/**
 * Turn a rendered campaign shell into one recipient's email.
 *
 * Extracted from the campaign send loop so that anything else sending to a
 * subscriber is physically unable to skip a step. Automations were the reason:
 * they built `{ to, from, subject, html }` by hand and sent that, which meant
 * every automated email went out with
 *
 *   - no unsubscribe link, and no List-Unsubscribe header
 *   - no merge tags, so `{{ first_name }}` arrived literally
 *   - no open or click tracking
 *
 * The missing unsubscribe link is the serious one. It is required by CAN-SPAM
 * and by PECR/GDPR for marketing mail, and the route already selected
 * `unsubscribe_token` from the database - it simply never used it.
 *
 * Callers pass the shell (already through buildHtmlFromEditor with the
 * workspace's branding) and get back the exact parameters to hand a transport.
 */

export interface RecipientEmailParams {
  /** The campaign shell, already branded. Merge tags still unresolved. */
  baseHtml: string;
  /** Subject line, may contain merge tags. */
  subject: string;
  /** Plain-text alternative, may contain merge tags. */
  message: string;
  subscriber: MergeRecipient;
  from: string;
  baseUrl: string;
  /** Present for campaign sends; absent for one-off automation mail. */
  campaignId?: string | null;
}

export interface RecipientEmail {
  to: string;
  from: string;
  subject: string;
  text: string;
  html: string;
  listUnsubscribe: string;
}

export function buildRecipientEmail(params: RecipientEmailParams): RecipientEmail {
  const { baseHtml, subject, message, subscriber, from, baseUrl, campaignId } = params;

  const unsubUrl = `${baseUrl}/unsubscribe?token=${subscriber.unsubscribe_token}`;
  // The one-click header target is the API route, not the confirmation page:
  // a mail client following List-Unsubscribe expects the action to happen, not
  // to be shown a page asking it to confirm.
  const unsubApiUrl = `${baseUrl}/api/unsubscribe?token=${subscriber.unsubscribe_token}`;

  const webVersionUrl = campaignId ? buildWebVersionUrl(baseUrl, campaignId, subscriber.id) : "";

  const mergeData = mergeDataForRecipient(subscriber, unsubUrl, webVersionUrl);

  // Tracking needs a campaign to attribute opens and clicks to. Automation mail
  // that is not tied to a campaign is sent untracked rather than being given a
  // fabricated id, which would corrupt that campaign's analytics.
  const html = campaignId
    ? injectTracking(renderTemplate(baseHtml, mergeData.html), campaignId, subscriber.id, baseUrl)
    : renderTemplate(baseHtml, mergeData.html);

  return {
    to: subscriber.email,
    from,
    subject: renderTemplate(subject, mergeData.text),
    text: renderTemplate(message, mergeData.text),
    html,
    listUnsubscribe: unsubApiUrl,
  };
}
