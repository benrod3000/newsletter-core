/**
 * Inbound SMS keywords.
 *
 * The webhook handled STOP, UNSUBSCRIBE and CANCEL. US carriers require the
 * full set, and the missing ones are not obscure: END and QUIT are what a lot of
 * people actually type, and STOPALL is what some handsets send from their own
 * blocking UI. A keyword that is not recognized falls through as an ordinary
 * message, so the person believes they have opted out and the next campaign
 * reaches them anyway.
 *
 * Opt-in matters as much. Without START and UNSTOP there is no way back: someone
 * who texted STOP by accident could never resubscribe, because the only other
 * route is a signup form that refuses to re-add a suppressed contact.
 */

export type SmsKeyword = "opt_out" | "opt_in" | "help" | "none";

const OPT_OUT = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "REVOKE", "OPTOUT"]);
const OPT_IN = new Set(["START", "YES", "UNSTOP", "OPTIN"]);
const HELP = new Set(["HELP", "INFO"]);

/**
 * Classify an inbound message body.
 *
 * Carriers match the keyword as the whole message, case-insensitively, ignoring
 * surrounding whitespace and trailing punctuation. Matching a keyword ANYWHERE
 * in the body would be worse than useless: "please don't stop sending these"
 * would opt the sender out of exactly what they just asked for.
 */
export function classifyInboundSms(body: string | null | undefined): SmsKeyword {
  if (typeof body !== "string") return "none";

  // Strip trailing punctuation and surrounding whitespace, then collapse the
  // whole thing. "Stop." and " STOP " are opt-outs; "stop sending" is not.
  const normalized = body.trim().replace(/[.!?,;:]+$/, "").toUpperCase();
  if (!normalized) return "none";

  if (OPT_OUT.has(normalized)) return "opt_out";
  if (OPT_IN.has(normalized)) return "opt_in";
  if (HELP.has(normalized)) return "help";
  return "none";
}

/** Carrier-required reply confirming an opt-out. */
export const OPT_OUT_REPLY =
  "You have been unsubscribed and will not receive further messages. Reply START to resubscribe.";

export const OPT_IN_REPLY = "You are resubscribed. Reply STOP to opt out at any time.";

export const HELP_REPLY =
  "Reply STOP to unsubscribe. Message and data rates may apply. Support: support@brod3000.com";

/** TwiML for a single reply message. */
export function twiml(message: string): string {
  const escaped = message
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escaped}</Message></Response>`;
}

/** TwiML acknowledging receipt without replying. Silence is the correct answer to an ordinary message. */
export const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';
