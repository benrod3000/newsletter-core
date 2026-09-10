import { describe, it, expect } from "vitest";
import { toE164, isE164 } from "../phone";

/**
 * Storing one phone format is what lets the STOP webhook match a number exactly.
 *
 * Before this, the webhook matched with `phone=ilike.*<digits>`, a trailing
 * wildcard, because nothing could say what shape the stored value had. A suffix
 * match silences whoever happens to share those trailing digits, which for an
 * opt-out is the worst possible direction to be wrong in: the person who asked to
 * be left alone keeps receiving messages, and someone who never asked stops.
 *
 * These tests pin the rejects as hard as the accepts. A number this function
 * cannot resolve must come back null rather than as a plausible guess, because a
 * guess is how a stranger gets texted.
 */

describe("toE164", () => {
  it("accepts numbers that already carry a country code", () => {
    expect(toE164("+15125550199")).toBe("+15125550199");
    expect(toE164("+44 20 7946 0958")).toBe("+442079460958");
    expect(toE164("+1 (512) 555-0199")).toBe("+15125550199");
    expect(toE164("  +15125550199  ")).toBe("+15125550199");
  });

  it("treats a leading 00 as the international prefix", () => {
    expect(toE164("0044 20 7946 0958")).toBe("+442079460958");
  });

  it("resolves a bare national number using the subscriber's country", () => {
    expect(toE164("512-555-0199", "US")).toBe("+15125550199");
    expect(toE164("(512) 555 0199", "us")).toBe("+15125550199");
    expect(toE164("15125550199", "US")).toBe("+15125550199");
  });

  it("drops the national trunk prefix outside North America", () => {
    // 020 7946 0958 dials as +44 20 7946 0958. Keeping the 0 would produce a
    // number that does not exist.
    expect(toE164("020 7946 0958", "GB")).toBe("+442079460958");
  });

  it("keeps a leading zero-free North American number intact", () => {
    // North America has no trunk prefix, so there is no 0 to strip. This pins
    // that the GB rule above cannot leak across.
    expect(toE164("5125550199", "CA")).toBe("+15125550199");
  });

  it("refuses a bare national number when the country is unknown", () => {
    // The whole point: no country, no guess.
    expect(toE164("5125550199")).toBeNull();
    expect(toE164("5125550199", null)).toBeNull();
    expect(toE164("5125550199", "ZZ")).toBeNull();
  });

  it("refuses a North American number of the wrong length", () => {
    expect(toE164("512555019", "US")).toBeNull();
    expect(toE164("51255501990", "US")).toBeNull();
  });

  it("refuses a country code beginning with zero", () => {
    expect(toE164("+0442079460958")).toBeNull();
  });

  it("refuses anything outside the E.164 digit range", () => {
    expect(toE164("+1234567")).toBeNull();
    expect(toE164("+1234567890123456")).toBeNull();
  });

  it("refuses numbers carrying anything that is not a digit", () => {
    // "ext 4" cannot be dialled, and dropping it silently invents a number that
    // reaches a different desk.
    expect(toE164("+1 512 555 0199 ext 4")).toBeNull();
    expect(toE164("+1-512-555-019X")).toBeNull();
    expect(toE164("call me")).toBeNull();
  });

  it("refuses empty and non-string input", () => {
    expect(toE164("")).toBeNull();
    expect(toE164("   ")).toBeNull();
    expect(toE164(null)).toBeNull();
    expect(toE164(undefined)).toBeNull();
    expect(toE164(15125550199)).toBeNull();
  });

  it("is idempotent, so a stored value re-normalizes to itself", () => {
    const once = toE164("(512) 555-0199", "US");
    expect(once).toBe("+15125550199");
    expect(toE164(once)).toBe(once);
  });
});

describe("isE164", () => {
  it("recognizes stored values that are already normalized", () => {
    expect(isE164("+15125550199")).toBe(true);
    expect(isE164("+442079460958")).toBe(true);
  });

  it("rejects everything a writer should never have stored", () => {
    expect(isE164("5125550199")).toBe(false);
    expect(isE164("+0442079460958")).toBe(false);
    expect(isE164("+1 512 555 0199")).toBe(false);
    expect(isE164(null)).toBe(false);
    expect(isE164("")).toBe(false);
  });
});
