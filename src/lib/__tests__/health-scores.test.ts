import { describe, it, expect } from "vitest";
import { scoreFor } from "../health-scores";

/**
 * The scoring rules, extracted so they can be checked without a database.
 *
 * Worth testing precisely because the previous implementation's docstring and
 * its code disagreed: the comment promised "cold: never engaged and subscribed
 * 60+ days ago" while the code marked anyone unengaged and older than 30 days
 * cold. Nobody could tell, because the job never finished scoring anyone.
 *
 * The `cold` default is also load-bearing in a way that is easy to miss: it is
 * what auto-clean deletes on, so being wrong here erases contacts.
 */

const NOW = Date.parse("2026-08-05T00:00:00Z");
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

describe("scoreFor", () => {
  it("marks recent engagement as active", () => {
    expect(scoreFor(daysAgo(1), daysAgo(400), NOW)).toBe("active");
    expect(scoreFor(daysAgo(29), daysAgo(400), NOW)).toBe("active");
  });

  it("marks 30-60 day old engagement as at risk", () => {
    expect(scoreFor(daysAgo(31), daysAgo(400), NOW)).toBe("at_risk");
    expect(scoreFor(daysAgo(59), daysAgo(400), NOW)).toBe("at_risk");
  });

  it("marks engagement older than 60 days as cold", () => {
    expect(scoreFor(daysAgo(61), daysAgo(400), NOW)).toBe("cold");
    expect(scoreFor(daysAgo(365), daysAgo(400), NOW)).toBe("cold");
  });

  it("gives a brand new subscriber the benefit of the doubt", () => {
    // They have not had the chance to engage yet, so absence proves nothing.
    expect(scoreFor(null, daysAgo(1), NOW)).toBe("active");
    expect(scoreFor(null, daysAgo(29), NOW)).toBe("active");
  });

  it("marks a never-engaged older subscriber cold", () => {
    expect(scoreFor(null, daysAgo(31), NOW)).toBe("cold");
    expect(scoreFor(null, daysAgo(400), NOW)).toBe("cold");
  });

  it("prefers engagement over signup date when both are known", () => {
    // Someone who joined long ago but opened yesterday is active, not cold.
    expect(scoreFor(daysAgo(1), daysAgo(1000), NOW)).toBe("active");
  });

  it("returns cold, not active, for the whole audience of a workspace that never sent anything", () => {
    // The case that couples this to auto-clean: no campaigns means no events,
    // so every subscriber past 30 days scores cold. auto-clean must refuse to
    // act on that, which is asserted in auto-clean.test.ts.
    const audience = [daysAgo(31), daysAgo(90), daysAgo(200)];
    expect(audience.map((c) => scoreFor(null, c, NOW))).toEqual(["cold", "cold", "cold"]);
  });
});
