import { describe, it, expect } from "vitest";
import {
  isSendableNow,
  localHourIn,
  partitionBySendableNow,
} from "../sms/quiet-hours";

/**
 * The window is the recipient's local time, never the server's.
 *
 * A cron running at a fixed UTC hour lands in the middle of someone's night as a
 * matter of routine, not as an accident, so this is the check standing between a
 * scheduled drain and a per-message statutory violation.
 *
 * Times are constructed in UTC and checked against zones with known offsets, so
 * these do not depend on where the test runs.
 */

/** 2026-06-15 is inside DST for both US and UK, which the offsets below assume. */
function utc(hour: number, minute = 0): Date {
  return new Date(Date.UTC(2026, 5, 15, hour, minute));
}

describe("localHourIn", () => {
  it("converts to the recipient's zone", () => {
    // 18:00 UTC in June is 14:00 Eastern (UTC-4) and 11:00 Pacific (UTC-7).
    expect(localHourIn("America/New_York", utc(18))).toBe(14);
    expect(localHourIn("America/Los_Angeles", utc(18))).toBe(11);
    expect(localHourIn("Europe/London", utc(18))).toBe(19);
  });

  it("returns null for an unrecognized zone rather than throwing", () => {
    // subscribers.timezone comes from client-supplied data, so it can be
    // anything. Intl throws a RangeError on garbage.
    expect(localHourIn("Mars/Olympus_Mons", utc(18))).toBeNull();
    expect(localHourIn("", utc(18))).toBeNull();
  });

  it("reports midnight as 0, not 24", () => {
    // 04:00 UTC in June is midnight Eastern.
    expect(localHourIn("America/New_York", utc(4))).toBe(0);
  });
});

describe("isSendableNow", () => {
  it("allows the middle of the recipient's day", () => {
    // 18:00 UTC is 14:00 Eastern.
    expect(isSendableNow("America/New_York", utc(18))).toBe(true);
  });

  it("blocks the recipient's night even when it is daytime for the server", () => {
    // 04:00 UTC is midnight Eastern. This is the case the whole module exists
    // for: a cron firing at a reasonable UTC hour texting someone at midnight.
    expect(isSendableNow("America/New_York", utc(4))).toBe(false);
  });

  it("is inclusive at 8am and exclusive at 9pm", () => {
    // 12:00 UTC is 08:00 Eastern; 01:00 UTC is 21:00 Eastern the previous day.
    expect(isSendableNow("America/New_York", utc(12))).toBe(true);
    expect(isSendableNow("America/New_York", utc(11, 59))).toBe(false);
    expect(isSendableNow("America/New_York", utc(1))).toBe(false);
    expect(isSendableNow("America/New_York", utc(0, 59))).toBe(true);
  });

  it("judges two recipients differently at the same instant", () => {
    // 02:00 UTC is 22:00 Eastern (too late) but 19:00 Pacific (fine). Sending
    // the whole batch on one server-side decision is precisely the bug.
    expect(isSendableNow("America/New_York", utc(2))).toBe(false);
    expect(isSendableNow("America/Los_Angeles", utc(2))).toBe(true);
  });

  it("falls back to the conservative UTC window when the timezone is absent", () => {
    // 18:00 to 02:00 UTC is the intersection of local 8am-9pm across UTC-10 to
    // UTC-5, so it is safe wherever in that span the recipient turns out to be.
    expect(isSendableNow(null, utc(18))).toBe(true);
    expect(isSendableNow(null, utc(23))).toBe(true);
    expect(isSendableNow(null, utc(1))).toBe(true);
    expect(isSendableNow(null, utc(2))).toBe(false);
    expect(isSendableNow(null, utc(17))).toBe(false);
    expect(isSendableNow(null, utc(12))).toBe(false);
  });

  it("treats an unrecognized timezone as unknown, not as unrestricted", () => {
    // A bad timezone string is a reason to be more careful, not less. 12:00 UTC
    // is outside the conservative window.
    expect(isSendableNow("Not/AZone", utc(12))).toBe(false);
    expect(isSendableNow("Not/AZone", utc(20))).toBe(true);
  });
});

describe("partitionBySendableNow", () => {
  it("splits a batch by each recipient's own local time", () => {
    const batch = [
      { id: "east", timezone: "America/New_York" },
      { id: "west", timezone: "America/Los_Angeles" },
      { id: "unknown", timezone: null },
    ];

    // 02:00 UTC: 22:00 Eastern (defer), 19:00 Pacific (send), outside the
    // conservative unknown window (defer).
    const { sendable, deferred } = partitionBySendableNow(batch, utc(2));

    expect(sendable.map((r) => r.id)).toEqual(["west"]);
    expect(deferred.map((r) => r.id)).toEqual(["east", "unknown"]);
  });

  it("accounts for every recipient, so none can be silently dropped", () => {
    const batch = [
      { id: "a", timezone: "America/New_York" },
      { id: "b", timezone: "Australia/Sydney" },
      { id: "c", timezone: null },
      { id: "d", timezone: "Europe/London" },
    ];
    const { sendable, deferred } = partitionBySendableNow(batch, utc(9));
    expect(sendable.length + deferred.length).toBe(batch.length);
  });
});
