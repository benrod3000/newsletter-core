/**
 * Quiet hours.
 *
 * The TCPA restricts marketing calls and texts to 8am through 9pm in the
 * RECIPIENT's local time, not the sender's. Getting this wrong is not a soft
 * failure: it is a per-message statutory violation, and a campaign drained by a
 * cron at a fixed UTC hour will land in the middle of someone's night as a
 * matter of course rather than as an accident.
 *
 * The drain checks this per recipient and DEFERS anyone outside their window
 * rather than failing them. Failing would be the easy implementation and the
 * wrong one: `failed` is terminal, the recovery cron does not revisit it, and
 * the person would simply never receive a message they consented to because of
 * what time it was when the job happened to run.
 */

/** Inclusive lower bound, exclusive upper bound, in the recipient's local time. */
export const QUIET_HOURS_START = 8;
export const QUIET_HOURS_END = 21;

/**
 * The window used when a recipient's timezone is unknown, expressed in UTC.
 *
 * 18:00 through 02:00 UTC is the intersection of 8am-to-9pm across every US
 * mainland and Hawaii zone (UTC-10 through UTC-5, ignoring DST). So a message
 * sent inside it is within local hours wherever in that span the recipient
 * actually is.
 *
 * It is deliberately narrow. The alternative designs are both worse: guessing a
 * single default zone sends at 5am to a third of the country, and deferring
 * unknown-timezone recipients forever means they never receive anything at all.
 *
 * This is an edge case by volume - 12 of 10,312 subscribers have no timezone -
 * so the narrowness costs almost nothing.
 */
export const UNKNOWN_TZ_UTC_START = 18;
export const UNKNOWN_TZ_UTC_END = 2;

/**
 * The recipient's local hour, or null if the timezone is unusable.
 *
 * `Intl.DateTimeFormat` throws a RangeError on an unrecognized timezone, and
 * `subscribers.timezone` is populated from client-supplied data, so it can be
 * anything at all.
 */
export function localHourIn(timezone: string, now: Date): number | null {
  try {
    const hour = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      hour12: false,
    }).format(now);

    const parsed = Number(hour);
    // `hour12: false` can render midnight as 24 in some environments.
    if (!Number.isFinite(parsed)) return null;
    return parsed % 24;
  } catch {
    return null;
  }
}

/**
 * True when it is an acceptable time to text this person right now.
 *
 * @param timezone IANA zone from the subscriber row, or null.
 * @param now      Injected so this is testable without freezing the clock.
 */
export function isSendableNow(timezone: string | null | undefined, now: Date = new Date()): boolean {
  if (timezone) {
    const hour = localHourIn(timezone, now);
    if (hour !== null) {
      return hour >= QUIET_HOURS_START && hour < QUIET_HOURS_END;
    }
    // An unrecognized zone falls through to the conservative window rather than
    // being treated as "no restriction". A bad timezone string is a reason to be
    // more careful, not less.
  }

  const utcHour = now.getUTCHours();
  // The window wraps midnight, so this is an OR rather than a range check.
  return utcHour >= UNKNOWN_TZ_UTC_START || utcHour < UNKNOWN_TZ_UTC_END;
}

/**
 * Split a claimed batch into those sendable now and those to defer.
 *
 * Returned as two arrays rather than a filter so the caller cannot accidentally
 * drop the deferred half. Losing it silently would mean the recipients stayed
 * claimed until their lock went stale, which looks like a slow send rather than
 * a bug.
 */
export function partitionBySendableNow<T extends { timezone: string | null }>(
  recipients: T[],
  now: Date = new Date()
): { sendable: T[]; deferred: T[] } {
  const sendable: T[] = [];
  const deferred: T[] = [];
  for (const r of recipients) {
    (isSendableNow(r.timezone, now) ? sendable : deferred).push(r);
  }
  return { sendable, deferred };
}
