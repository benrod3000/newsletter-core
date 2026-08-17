import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FIXED_AUDIENCES, isValidAudience } from "../send-campaign";

/**
 * The set of valid audiences, which has now drifted twice in two days.
 *
 * `campaigns.audience` has a CHECK constraint, and it is the only thing that was
 * enforcing this. It never learned about lists, so picking one returned "Failed to
 * create campaign". 067 taught it lists and claimed_offer but not `geo`, which the
 * picker had offered all along, so the same failure came back as "my draft isn't
 * being saved" - the save 23514'd, the route turned that into a 500, and the editor
 * showed nothing at all.
 *
 * A CHECK violation is a terrible way to learn this: it names no column at the client
 * and reads as the feature being broken. So validation moved into the application,
 * `FIXED_AUDIENCES` is the source of truth, and these tests pin it against the type
 * and against the values the UI actually offers.
 */

describe("FIXED_AUDIENCES", () => {
  it("matches the Audience type's fixed members", () => {
    // Types vanish at runtime, so the type is read as text. Crude, and it is the only
    // way to catch someone widening one and not the other.
    const source = readFileSync(join(process.cwd(), "src/lib/send-campaign.ts"), "utf8");
    const line = source.split("\n").find((l) => l.startsWith("export type Audience"))!;
    const inType = [...line.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]).sort();

    expect(inType).toEqual([...FIXED_AUDIENCES].sort());
  });

  it("contains every audience the campaign picker offers", () => {
    // The frontend's AUDIENCE_OPTIONS, restated. It lives in the other repo and the
    // two deploy independently, so this cannot import it - but an audience the UI can
    // produce and the API rejects is exactly the bug this file exists for.
    for (const offered of ["confirmed", "all", "pending", "geo"]) {
      expect(FIXED_AUDIENCES as readonly string[]).toContain(offered);
    }
  });
});

describe("isValidAudience", () => {
  it("accepts each fixed audience", () => {
    for (const a of FIXED_AUDIENCES) expect(isValidAudience(a)).toBe(true);
  });

  it("accepts a well-formed list audience", () => {
    expect(isValidAudience("list:2b2bbd33-00fe-4de5-bc02-d660080d3fc6")).toBe(true);
  });

  it("rejects a malformed list audience", () => {
    // These would pass a naive startsWith("list:") check and then fail at the send,
    // far from the cause.
    expect(isValidAudience("list:")).toBe(false);
    expect(isValidAudience("list:whatever")).toBe(false);
    expect(isValidAudience("list:2b2bbd33")).toBe(false);
  });

  it("rejects anything else, including near-misses", () => {
    expect(isValidAudience("subscribers")).toBe(false);
    expect(isValidAudience("Confirmed")).toBe(false);
    expect(isValidAudience("")).toBe(false);
    expect(isValidAudience(null)).toBe(false);
    expect(isValidAudience(undefined)).toBe(false);
    expect(isValidAudience(42)).toBe(false);
  });
});
