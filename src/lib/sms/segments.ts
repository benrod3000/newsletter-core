/**
 * How many SMS segments a body costs.
 *
 * Carriers bill per segment, not per message, and the boundary is not where
 * people expect. A body is encoded as GSM-7 if every character is in the GSM
 * alphabet, giving 160 characters in a single segment and 153 per segment once a
 * message has to be split (7 bytes per segment go to the concatenation header).
 * One character outside that alphabet forces the whole body to UCS-2, which
 * drops the limits to 70 and 67.
 *
 * So a single curly quote, an em dash, or an emoji more than halves the capacity
 * of the entire message. A 140 character body is one segment; paste the same text
 * from a word processor with a smart apostrophe in it and it becomes three. That
 * is a 3x cost increase from an invisible character, and nobody discovers it
 * until the invoice.
 *
 * This exists so the composer can show the count before the send rather than
 * after, and so the send path can refuse a body that would fan out absurdly.
 */

/**
 * The GSM 03.38 basic character set.
 *
 * Written out rather than expressed as ranges because it is not contiguous and a
 * clever range would silently include characters that are not in it.
 */
const GSM7_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?" +
  "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";

/**
 * Characters reachable in GSM-7 only via an escape sequence, so each one costs
 * TWO of the 160 (or 153) characters rather than one.
 *
 * Missing this is how a body of exactly 160 characters containing a single
 * newline-adjacent bracket silently becomes two segments.
 */
const GSM7_EXTENDED = "^{}\\[~]|€";

const GSM7_BASIC_SET = new Set(GSM7_BASIC);
const GSM7_EXTENDED_SET = new Set(GSM7_EXTENDED);

export type SmsEncoding = "GSM-7" | "UCS-2";

export interface SmsSegmentInfo {
  encoding: SmsEncoding;
  /** Billable segments. Always at least 1, even for an empty body. */
  segments: number;
  /**
   * Encoded length in the units the limits are counted in: GSM-7 septets
   * (escapes counted twice) or UCS-2 code units (astral characters counted
   * twice, because a surrogate pair occupies two).
   */
  encodedLength: number;
  /** How many more units fit before another segment is billed. */
  remainingInSegment: number;
  /**
   * The characters that forced UCS-2, deduplicated and in order of appearance.
   * Empty for a GSM-7 body. This is what lets the UI say "your apostrophe is
   * costing you 2 extra segments" instead of just showing a number.
   */
  nonGsmCharacters: string[];
}

const GSM7_SINGLE = 160;
const GSM7_CONCATENATED = 153;
const UCS2_SINGLE = 70;
const UCS2_CONCATENATED = 67;

export function smsSegments(body: string): SmsSegmentInfo {
  const text = typeof body === "string" ? body : "";

  // Iterate by code point, not by index. `for (const c of text)` yields astral
  // characters (most emoji) whole, where `text[i]` would hand back half a
  // surrogate pair and misjudge both the encoding and the length.
  const nonGsm: string[] = [];
  const seen = new Set<string>();
  let septets = 0;

  for (const char of text) {
    if (GSM7_BASIC_SET.has(char)) {
      septets += 1;
    } else if (GSM7_EXTENDED_SET.has(char)) {
      septets += 2;
    } else if (!seen.has(char)) {
      seen.add(char);
      nonGsm.push(char);
    }
  }

  if (nonGsm.length === 0) {
    return build("GSM-7", septets, GSM7_SINGLE, GSM7_CONCATENATED, nonGsm);
  }

  // UCS-2 counts 16-bit code units, so an astral character costs two. `.length`
  // already counts code units, which is exactly right here and exactly wrong
  // above.
  return build("UCS-2", text.length, UCS2_SINGLE, UCS2_CONCATENATED, nonGsm);
}

function build(
  encoding: SmsEncoding,
  encodedLength: number,
  single: number,
  concatenated: number,
  nonGsmCharacters: string[]
): SmsSegmentInfo {
  if (encodedLength <= single) {
    return {
      encoding,
      segments: 1,
      encodedLength,
      remainingInSegment: single - encodedLength,
      nonGsmCharacters,
    };
  }

  const segments = Math.ceil(encodedLength / concatenated);
  return {
    encoding,
    segments,
    encodedLength,
    remainingInSegment: segments * concatenated - encodedLength,
    nonGsmCharacters,
  };
}

/**
 * Ceiling on a single message.
 *
 * Twilio accepts up to 1600 characters, and the old inline send loop simply
 * truncated to that with `.slice(0, 1600)` - silently, mid-sentence, after the
 * operator had already been told how many people it was going to. 1600 GSM-7
 * characters is 11 segments per recipient, so at 10,000 recipients it is 110,000
 * billable segments from one send.
 *
 * The send path refuses rather than truncates. A message the author did not
 * write is worse than an error they can act on.
 */
export const MAX_SMS_SEGMENTS = 10;
