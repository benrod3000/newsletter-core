import { describe, it, expect, vi } from "vitest";
import { parseGeoAreas, fetchSubscribersInAreas } from "../geo-areas";

/*
 * The Supabase client is the seam. Mocking it here rather than threading an
 * injectable client through fetchSubscribersInAreas keeps the production
 * signature the one the routes actually want to call.
 */
let mockClient: unknown = null;
vi.mock("../supabase", () => ({ getSupabaseClient: () => mockClient }));

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

/**
 * Paging over `nearby_subscribers`.
 *
 * An RPC answer is a PostgREST response, so the project's `max-rows` ceiling of
 * 1,000 applies to it - silently, with no error. `nearby_subscribers` returns
 * SETOF subscribers, so a circle holding more than 1,000 contacts came back
 * holding exactly 1,000 and the route published that as the total. Nothing
 * threw, which is why it survived: these tests passed against the truncating
 * version, because they only covered the parser.
 *
 * Measured against production data: a 200-mile radius on New York holds 1,500
 * contacts and lost 500 of them. At 100 miles it holds exactly 1,000, where the
 * truncated answer and the true one coincide - so the radius most likely to be
 * tried first was the one that looked fine.
 *
 * The mock below is the PostgREST contract as the paging relies on it: a filter
 * builder that honours `.limit()` up to the ceiling, `.gt("id", ...)` as the
 * cursor, and awaits to `{ data, error }`.
 */
describe("fetchSubscribersInAreas", () => {
  const MAX_ROWS = 1000;

  /**
   * A fake set-returning RPC that truncates at `max-rows`, as the real one does.
   *
   * Rows are keyed by centre rather than by call order: paging calls the RPC once
   * per page, so an order-keyed mock would hand page two of the first area the
   * second area's rows and then report the walk as finished.
   */
  function makeClient(rowsByArea: string[][]) {
    const calls: { radiusKm: number; afterId: string | null; limit: number }[] = [];

    function builder(rows: string[], radiusKm: number) {
      let afterId: string | null = null;
      let limit = MAX_ROWS;
      const self = {
        order: () => self,
        limit: (n: number) => {
          limit = n;
          return self;
        },
        gt: (_col: string, value: string) => {
          afterId = value;
          return self;
        },
        then: (resolve: (r: { data: { id: string }[]; error: null }) => unknown) => {
          const start = afterId === null ? 0 : rows.indexOf(afterId) + 1;
          const page = rows.slice(start, start + Math.min(limit, MAX_ROWS));
          calls.push({ radiusKm, afterId, limit });
          return Promise.resolve(resolve({ data: page.map((id) => ({ id })), error: null }));
        },
      };
      return self;
    }

    const centres = new Map<string, string[]>();
    mockClient = {
      rpc: (
        _fn: string,
        args: { center_lat: number; center_lng: number; radius_km: number }
      ) => {
        const key = `${args.center_lat},${args.center_lng}`;
        if (!centres.has(key)) centres.set(key, rowsByArea[centres.size] ?? []);
        return builder(centres.get(key)!, args.radius_km);
      },
    };
    return { calls };
  }

  it("pages past the 1,000-row ceiling instead of truncating", async () => {
    const rows = Array.from({ length: 1500 }, (_, i) => `s${String(i).padStart(4, "0")}`);
    const { calls } = makeClient([rows]);

    const got = await fetchSubscribersInAreas("ws", [{ lat: 40.7, lng: -74, radiusKm: 160 }]);

    expect(got).toHaveLength(1500);
    // Two pages: a full one, then a short one that ends the walk.
    expect(calls).toHaveLength(2);
    expect(calls[0].afterId).toBeNull();
    expect(calls[1].afterId).toBe("s0999");
  });

  it("never asks for more than the ceiling, so a short page stays meaningful", async () => {
    const { calls } = makeClient([["a", "b"]]);
    await fetchSubscribersInAreas("ws", [{ lat: 1, lng: 2, radiusKm: 10 }]);
    expect(calls[0].limit).toBeLessThanOrEqual(MAX_ROWS);
  });

  it("unions overlapping areas without double counting", async () => {
    makeClient([
      ["a", "b", "c"],
      ["c", "d"],
    ]);

    const got = await fetchSubscribersInAreas("ws", [
      { lat: 1, lng: 2, radiusKm: 10 },
      { lat: 1.1, lng: 2.1, radiusKm: 10 },
    ]);

    expect(got.map((r) => r.id)).toEqual(["a", "b", "c", "d"]);
  });
});
