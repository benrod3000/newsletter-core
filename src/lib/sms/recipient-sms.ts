import {
  mergeDataForRecipient,
  renderTemplate,
  type MergeRecipient,
} from "@/lib/campaign-personalization";
import { smsSegments, MAX_SMS_SEGMENTS, type SmsSegmentInfo } from "./segments";

/**
 * Turn a campaign's SMS body into one recipient's message.
 *
 * The exact analogue of `buildRecipientEmail`, and it exists for the same
 * reason that one does. Automations used to hand-assemble `{ to, from, subject,
 * html }` and send it, which meant every automated email went out with no
 * unsubscribe link, no merge tags and no tracking. The unsubscribe link was the
 * serious one: required by CAN-SPAM, and the data to build it was already loaded
 * and simply never used.
 *
 * SMS has the identical trap with the identical severity. The opt-out
 * instruction has to be IN the message. Carriers require it, and unlike email
 * there is no header that can carry it instead - there is no List-Unsubscribe
 * for SMS, so if it is not in the body it does not exist. The old inline send
 * loop did merge tags by hand with two `.replace()` calls and appended no opt-out
 * at all.
 *
 * So nothing hand-assembles an SMS. Everything that texts a subscriber comes
 * through here.
 */

/** Recognized as an opt-out instruction, so one is not appended twice. */
const OPT_OUT_PATTERN = /\b(stop|unsubscribe|opt[\s-]?out)\b/i;

/**
 * Appended when the author has not written their own.
 *
 * Kept short because it is billed: at 22 characters it fits inside the same
 * segment for most bodies rather than pushing every message to two.
 */
export const DEFAULT_OPT_OUT_NOTICE = "Reply STOP to opt out";

export interface RecipientSmsParams {
  /** The campaign's SMS body, merge tags unresolved. */
  body: string;
  subscriber: MergeRecipient;
  /** Sender number, E.164. */
  from: string;
  /**
   * Base URL for any link the body builds. Present for parity with the email
   * builder; SMS link tracking is not implemented, see below.
   */
  baseUrl: string;
  campaignId?: string | null;
}

export interface RecipientSms {
  to: string;
  from: string;
  body: string;
  segments: SmsSegmentInfo;
}

export class SmsBodyTooLongError extends Error {
  constructor(
    public readonly segments: number,
    public readonly max: number
  ) {
    super(
      `This message is ${segments} segments per recipient, over the ${max} segment limit. ` +
        `Shorten it, or remove characters that force UCS-2 encoding.`
    );
    this.name = "SmsBodyTooLongError";
  }
}

export function buildRecipientSms(params: RecipientSmsParams): RecipientSms {
  const { body, subscriber, from } = params;

  if (!subscriber.phone_number) {
    // Should be unreachable: `campaign_audience()` filters on a non-null
    // phone_number and `claim_campaign_recipients` returns it. Throwing rather
    // than skipping because reaching here means the audience predicate and this
    // builder disagree, and silently dropping the recipient would hide that.
    throw new Error(`Subscriber ${subscriber.email} has no phone number`);
  }

  const unsubUrl = `${params.baseUrl}/unsubscribe?token=${subscriber.unsubscribe_token}`;

  // `.text`, not `.html`. The two maps exist because names are attacker-
  // influenced and must be escaped before reaching HTML, but the escaped values
  // in a plain-text context render literally: "O&#39;Brien" in the inbox. An SMS
  // is plain text end to end, so the raw map is the correct one, and using the
  // HTML map here would be the same bug in a new channel.
  const mergeData = mergeDataForRecipient(subscriber, unsubUrl).text;
  const merged = renderTemplate(body, mergeData);

  // The opt-out goes on after merging, so a merge tag resolving to text
  // containing "stop" cannot accidentally suppress it.
  const withOptOut = OPT_OUT_PATTERN.test(merged)
    ? merged
    : `${merged.trimEnd()}\n${DEFAULT_OPT_OUT_NOTICE}`;

  const segments = smsSegments(withOptOut);

  // Refuse rather than truncate.
  //
  // The old loop did `.slice(0, 1600)`, silently, mid-sentence, after the
  // operator had already been shown a recipient count. A message the author did
  // not write is worse than an error they can act on, and at 1600 characters the
  // cost is 11 segments per recipient - 110,000 billable segments across a
  // 10,000 person audience, from a truncation nobody was told about.
  if (segments.segments > MAX_SMS_SEGMENTS) {
    throw new SmsBodyTooLongError(segments.segments, MAX_SMS_SEGMENTS);
  }

  return {
    to: subscriber.phone_number,
    from,
    body: withOptOut,
    segments,
  };
}

/*
 * Merge data is the email path's, reused rather than reimplemented, so a tag
 * cannot mean one thing in an email and another in a text. The old SMS loop
 * supported exactly `{{first_name}}` and `{{name}}` via two `.replace()` calls,
 * so every other tag the composer offered arrived in the message literally, as
 * `{{city}}`, to a real person. Reuse also brings the `{{ tag | fallback }}`
 * syntax, which the hand-rolled version had no concept of.
 *
 * Not implemented, deliberately, and worth stating so it is not mistaken for an
 * oversight:
 *
 * SMS click tracking. The email path rewrites links through /api/track/click.
 * Doing that here needs a short-link domain, because a tracking URL is longer
 * than the link it replaces and every character is billed - a 40 character
 * tracking URL added to a 130 character message doubles its cost. It also
 * interacts with carrier filtering, which treats unknown shorteners as a spam
 * signal. That is a real feature with real prerequisites, not a line of code,
 * and it belongs with the tracking-domain work already flagged as the one
 * genuine one-way door in the architecture direction.
 *
 * SMS open tracking. Does not exist as a concept. There is no pixel and no
 * equivalent, so any "open rate" shown for SMS would be fabricated.
 */
