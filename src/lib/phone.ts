/**
 * Phone numbers, stored in one format.
 *
 * There used to be two phone columns and two ideas of what a phone number is.
 * `subscribers.phone_number` was written by the dashboard, the CSV importer and
 * the homepage form; `subscribers.phone` was written only by the widget form and
 * was what every SMS path read. In production `phone_number` held 10,300 rows and
 * `phone` held none, so every SMS query matched nobody and would have kept
 * matching nobody however many contacts were added. Migration 072 collapses them
 * onto `phone_number`.
 *
 * The formatting half of that split lived here. The send loop prefixed `+1` onto
 * anything without one, the test-send route did its own slightly different
 * version, and the STOP webhook matched with a trailing-wildcard `ilike` because
 * nothing could say what shape the stored value had. A suffix match on an unknown
 * format is how one person's STOP silences a different person.
 *
 * So: normalize once, on write, and store E.164 only. Then the webhook can match
 * exactly, and the "is this number valid" question has a single answer. Same
 * approach as `safeColor` and `safeLogoUrl` in `branding.ts` - validate at the
 * boundary and fall back to null rather than trusting the column.
 */

/**
 * Calling codes for the countries a bare national number can be resolved for.
 *
 * Deliberately short. Guessing a country for a number that did not come with one
 * is how you text a stranger, so an unlisted country requires the caller to have
 * collected E.164 in the first place. Grow this only when a real workspace needs
 * it.
 */
const CALLING_CODES: Record<string, string> = {
  US: "1",
  CA: "1",
  GB: "44",
  IE: "353",
  AU: "61",
  NZ: "64",
  DE: "49",
  FR: "33",
  ES: "34",
  IT: "39",
  NL: "31",
};

/**
 * National number lengths, used to tell "10 digits, needs a country code" from
 * "11 digits, already carries one". Only the codes above need an entry.
 */
const NATIONAL_LENGTHS: Record<string, number[]> = {
  "1": [10],
};

/** Everything a human might type as a separator. */
const SEPARATORS = /[\s\-(). ]/g;

/**
 * E.164 allows at most 15 digits including the country code, and the shortest
 * real international number is around 8. Anything outside that is a typo or a
 * pasted extension, not a number we can text.
 */
const MIN_DIGITS = 8;
const MAX_DIGITS = 15;

/**
 * Normalize to E.164, or null if it cannot be done with confidence.
 *
 * Returning null rather than a best guess is the point: an unsendable number
 * stored as null is visible and skippable, while a wrong number stored as valid
 * sends a stranger someone else's marketing.
 *
 * @param raw          Whatever the operator or visitor typed.
 * @param countryCode  ISO-3166 alpha-2 for the subscriber, used only to resolve
 *                     a bare national number. Ignored when `raw` is already
 *                     international.
 */
export function toE164(raw: unknown, countryCode?: string | null): string | null {
  if (typeof raw !== "string") return null;

  const trimmed = raw.trim();
  if (!trimmed) return null;

  // A leading `00` is the international prefix in most of the world, and people
  // paste it interchangeably with `+`.
  const international = trimmed.startsWith("+") || trimmed.startsWith("00");
  const stripped = trimmed.replace(SEPARATORS, "");

  // Reject anything with characters that are neither digits nor the leading `+`,
  // rather than silently discarding them. "555-0199 ext 4" is not a number we can
  // dial, and quietly dropping the extension invents one that reaches someone
  // else's desk.
  if (!/^\+?\d+$/.test(stripped)) return null;

  let digits = stripped.replace(/\D/g, "");
  if (international && stripped.startsWith("00")) digits = digits.slice(2);

  if (international) {
    // Country codes never begin with zero, so a leading zero here means the
    // national trunk prefix was pasted after the `+`.
    if (digits.startsWith("0")) return null;
    return withinRange(digits) ? `+${digits}` : null;
  }

  const calling = countryCode ? CALLING_CODES[countryCode.trim().toUpperCase()] : undefined;
  if (!calling) return null;

  // Trunk prefix: UK, Germany, France and others write the national number with a
  // leading 0 that is dropped in E.164. North America has no trunk prefix, so
  // stripping one there would corrupt the number.
  let national = digits;
  if (calling !== "1" && national.startsWith("0")) national = national.slice(1);

  // Already carries its own country code, written without a `+`.
  if (national.startsWith(calling)) {
    const remainder = national.slice(calling.length);
    const expected = NATIONAL_LENGTHS[calling];
    if (expected && expected.includes(remainder.length)) {
      return withinRange(national) ? `+${national}` : null;
    }
  }

  const expected = NATIONAL_LENGTHS[calling];
  if (expected && !expected.includes(national.length)) return null;

  const full = `${calling}${national}`;
  return withinRange(full) ? `+${full}` : null;
}

function withinRange(digits: string): boolean {
  return digits.length >= MIN_DIGITS && digits.length <= MAX_DIGITS;
}

/**
 * True when a stored value is already E.164.
 *
 * For read paths that must not repair data on the fly. Once migration 072 has
 * run, a stored number that fails this is a bug in a writer, and repairing it at
 * read time would hide that.
 */
export function isE164(value: unknown): value is string {
  return typeof value === "string" && /^\+[1-9]\d{7,14}$/.test(value);
}
