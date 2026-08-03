import { describe, it, expect } from "vitest";
import { tagsFor } from "../automations/smart-tags";

/**
 * Tag derivation, extracted so it can be checked without a database.
 *
 * Worth testing directly because production told us something was wrong through
 * this function's output and nobody could read it: every tagged subscriber had
 * exactly `slipping` and nothing else. That is the correct result for a
 * subscriber with no events, and events were being truncated away, so the rule
 * that fires when engagement is missing was the only one that ever fired.
 */

const SLIPPING_BEFORE = "2026-07-20T00:00:00.000Z";
const RECENT = "2026-08-01T00:00:00.000Z"; // a Saturday
const OLD = "2026-07-01T00:00:00.000Z";

function engagement(overrides: Partial<Parameters<typeof tagsFor>[0]> = {}) {
  return { opens: 0, clicks: 0, lastOpen: null, userAgent: null, ...overrides };
}

describe("tagsFor", () => {
  it("marks a subscriber with no activity as slipping", () => {
    // The all-1,000-rows-are-slipping case from production.
    expect(tagsFor(engagement(), SLIPPING_BEFORE)).toEqual(["slipping"]);
  });

  it("marks three or more opens as engaged", () => {
    const tags = tagsFor(engagement({ opens: 3, lastOpen: RECENT }), SLIPPING_BEFORE);

    expect(tags).toContain("engaged");
    expect(tags).not.toContain("slipping");
  });

  it("does not mark two opens as engaged", () => {
    expect(tagsFor(engagement({ opens: 2, lastOpen: RECENT }), SLIPPING_BEFORE)).not.toContain(
      "engaged"
    );
  });

  it("marks any click as a clicker", () => {
    expect(tagsFor(engagement({ clicks: 1, lastOpen: RECENT }), SLIPPING_BEFORE)).toContain(
      "clicker"
    );
  });

  it("marks a stale last open as slipping even when opens are high", () => {
    // Someone who read a lot and then stopped is the case worth catching.
    const tags = tagsFor(engagement({ opens: 20, lastOpen: OLD }), SLIPPING_BEFORE);

    expect(tags).toContain("engaged");
    expect(tags).toContain("slipping");
  });

  it("marks a weekend last open as a weekend reader", () => {
    expect(tagsFor(engagement({ lastOpen: RECENT }), SLIPPING_BEFORE)).toContain("weekend-reader");
  });

  it("does not mark a weekday last open as a weekend reader", () => {
    // 2026-08-03 is a Monday.
    const tags = tagsFor(engagement({ lastOpen: "2026-08-03T00:00:00.000Z" }), SLIPPING_BEFORE);

    expect(tags).not.toContain("weekend-reader");
  });

  it("detects mobile from the user agent, case insensitively", () => {
    expect(tagsFor(engagement({ userAgent: "iPhone MOBILE Safari" }), SLIPPING_BEFORE)).toContain(
      "mobile"
    );
  });

  it("does not crash on a null user agent", () => {
    expect(() => tagsFor(engagement({ userAgent: null }), SLIPPING_BEFORE)).not.toThrow();
  });

  it("can return several tags at once", () => {
    const tags = tagsFor(
      engagement({ opens: 5, clicks: 2, lastOpen: RECENT, userAgent: "Mobile" }),
      SLIPPING_BEFORE
    );

    expect(new Set(tags)).toEqual(new Set(["engaged", "clicker", "weekend-reader", "mobile"]));
  });
});
