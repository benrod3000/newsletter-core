import { describe, it, expect } from "vitest";
import { smsSegments } from "../sms/segments";

/**
 * Segment counting is a billing calculation, so the boundaries are the test.
 *
 * The failure this guards against is not "the number is slightly off". It is a
 * single invisible character - a smart apostrophe pasted from a word processor -
 * flipping the whole body from GSM-7 to UCS-2 and cutting capacity from 160 to
 * 70. At 10,000 recipients that is the difference between 10,000 and 30,000
 * billable segments, from a character the author cannot see.
 */

describe("smsSegments", () => {
  it("counts a short GSM-7 body as one segment", () => {
    const info = smsSegments("Sale ends tonight, use code SPRING.");
    expect(info.encoding).toBe("GSM-7");
    expect(info.segments).toBe(1);
    expect(info.nonGsmCharacters).toEqual([]);
  });

  it("fits exactly 160 GSM-7 characters in one segment", () => {
    const info = smsSegments("a".repeat(160));
    expect(info.segments).toBe(1);
    expect(info.remainingInSegment).toBe(0);
  });

  it("splits at 161 into two segments of 153", () => {
    const info = smsSegments("a".repeat(161));
    expect(info.segments).toBe(2);
    expect(info.encodedLength).toBe(161);
  });

  it("bills GSM-7 extended characters as two units each", () => {
    // 159 plain + one brace. The brace costs 2, so this is 161 septets and tips
    // into a second segment despite being 160 characters on screen.
    const info = smsSegments("a".repeat(159) + "{");
    expect(info.encoding).toBe("GSM-7");
    expect(info.encodedLength).toBe(161);
    expect(info.segments).toBe(2);
  });

  it("drops to UCS-2 on a single non-GSM character", () => {
    // The curly apostrophe. Visually identical to ' and it halves the message.
    const info = smsSegments("Don’t miss out");
    expect(info.encoding).toBe("UCS-2");
    expect(info.segments).toBe(1);
    expect(info.nonGsmCharacters).toEqual(["’"]);
  });

  it("shows what forced UCS-2 so the cost can be explained", () => {
    const info = smsSegments("Café – open – today ❤");
    expect(info.encoding).toBe("UCS-2");
    // Deduplicated and in order of first appearance. The e-acute is GSM-7, the
    // dashes and the heart are not.
    expect(info.nonGsmCharacters).toEqual(["–", "❤"]);
  });

  it("fits exactly 70 UCS-2 units in one segment", () => {
    const info = smsSegments("’".repeat(70));
    expect(info.encoding).toBe("UCS-2");
    expect(info.segments).toBe(1);
    expect(info.remainingInSegment).toBe(0);
  });

  it("splits UCS-2 at 71 into two segments of 67", () => {
    const info = smsSegments("’".repeat(71));
    expect(info.segments).toBe(2);
  });

  it("counts an astral emoji as two UCS-2 units", () => {
    // A surrogate pair occupies two code units, so 35 of them fill a segment.
    const info = smsSegments("\u{1F600}".repeat(35));
    expect(info.encoding).toBe("UCS-2");
    expect(info.encodedLength).toBe(70);
    expect(info.segments).toBe(1);

    const overflow = smsSegments("\u{1F600}".repeat(36));
    expect(overflow.encodedLength).toBe(72);
    expect(overflow.segments).toBe(2);
  });

  it("reports the emoji once, not once per surrogate half", () => {
    // Iterating by index rather than code point would push two broken halves
    // into this list and misreport the encoding.
    const info = smsSegments("hi \u{1F600}\u{1F600}");
    expect(info.nonGsmCharacters).toEqual(["\u{1F600}"]);
  });

  it("treats an empty body as one segment rather than zero", () => {
    const info = smsSegments("");
    expect(info.segments).toBe(1);
    expect(info.encodedLength).toBe(0);
  });

  it("does not throw on non-string input", () => {
    // @ts-expect-error deliberately wrong, this runs on operator-supplied data
    expect(smsSegments(null).segments).toBe(1);
  });

  it("counts newlines and carriage returns as GSM-7", () => {
    const info = smsSegments("line one\nline two");
    expect(info.encoding).toBe("GSM-7");
    expect(info.segments).toBe(1);
  });
});
