import { describe, it, expect } from "vitest";
import { parseGeoAreas } from "../geo-areas";

/**
 * Multi-area radius targeting.
 *
 * The picker has always allowed several areas - a chip and a circle each, and a
 * summary reading "Targeting 2 areas · up to 100 mi" - while every consumer read
 * `locations[0]` and dropped the rest. That is not a missing feature, it is a
 * wrong answer: Oceanside at 10mi (nobody) plus Encinitas at 100mi (eight
 * people) queried Oceanside alone and returned zero, so a workspace of 10,310
 * contacts rendered the "your audience starts here" empty state.
 *
 * Nothing failed. The extra area was on screen the whole time.
 */

const q = (s: string) => new URLSearchParams(s);

describe("parseGeoAreas", () => {
  it("reads every area, not just the first", () => {
    const areas = parseGeoAreas(q("areas=33.1959,-117.3795,10;33.0370,-117.2920,100"));
    expect(areas).toHaveLength(2);
    expect(areas[0].lat).toBeCloseTo(33.1959);
    expect(areas[1].lat).toBeCloseTo(33.037);
  });

  it("converts miles to the kilometres nearby_subscribers expects", () => {
    // The unit boundary that previously let the list and the send disagree:
    // campaigns.geo_filter and enqueue_campaign_recipients are both km.
    const [area] = parseGeoAreas(q("areas=33,-117,10"));
    expect(area.radiusKm).toBeCloseTo(16.09344, 4);
  });

  it("still accepts the original single-area parameters", () => {
    // Saved filters and campaign geo_filter were written in this shape.
    const areas = parseGeoAreas(q("near_lat=33.037&near_lng=-117.292&radius=25"));
    expect(areas).toHaveLength(1);
    expect(areas[0].radiusKm).toBeCloseTo(40.2336, 3);
  });

  it("defaults a missing radius to ten miles rather than zero", () => {
    // A zero radius matches nobody, which is the failure this whole test file
    // exists because of.
    const [byAreas] = parseGeoAreas(q("areas=33,-117"));
    const [byNear] = parseGeoAreas(q("near_lat=33&near_lng=-117"));
    expect(byAreas.radiusKm).toBeCloseTo(16.09344, 4);
    expect(byNear.radiusKm).toBeCloseTo(16.09344, 4);
  });

  it("skips a malformed area instead of defaulting its coordinates", () => {
    // (0, 0) is in the Atlantic. Querying it silently would return a confidently
    // empty set rather than an error.
    const areas = parseGeoAreas(q("areas=notalat,-117,10;33.037,-117.292,50"));
    expect(areas).toHaveLength(1);
    expect(areas[0].lat).toBeCloseTo(33.037);
  });

  it("rejects out-of-range coordinates", () => {
    expect(parseGeoAreas(q("areas=91,-117,10"))).toHaveLength(0);
    expect(parseGeoAreas(q("areas=33,-181,10"))).toHaveLength(0);
  });

  it("returns nothing when no geo filter is present", () => {
    // Callers read an empty array as "no geo filter", so this must not become an
    // area that matches nobody.
    expect(parseGeoAreas(q("status=confirmed&limit=50"))).toEqual([]);
  });

  it("caps the number of areas", () => {
    const many = Array.from({ length: 40 }, (_, i) => `33.${i},-117,10`).join(";");
    expect(parseGeoAreas(q(`areas=${many}`)).length).toBeLessThanOrEqual(25);
  });
});
