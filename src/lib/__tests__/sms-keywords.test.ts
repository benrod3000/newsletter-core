import { describe, it, expect } from "vitest";
import { classifyInboundSms, twiml } from "../sms/keywords";

/**
 * Getting a keyword wrong has two failure modes and both are bad.
 *
 * Missing a real opt-out means someone who typed STOP keeps receiving messages,
 * which is the violation the keyword exists to prevent. Matching too eagerly
 * means "please don't stop sending these" unsubscribes an enthusiastic reader,
 * silently, with no way for them to tell.
 *
 * The webhook previously recognized three keywords and no opt-in at all, so an
 * accidental STOP was permanent: the only other route back was a signup form
 * that refuses to re-add a suppressed contact.
 */

describe("classifyInboundSms", () => {
  it("recognizes the full carrier-required opt-out set", () => {
    for (const word of ["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "REVOKE", "OPTOUT"]) {
      expect(classifyInboundSms(word), word).toBe("opt_out");
    }
  });

  it("recognizes opt-in, so an accidental STOP is reversible", () => {
    for (const word of ["START", "YES", "UNSTOP", "OPTIN"]) {
      expect(classifyInboundSms(word), word).toBe("opt_in");
    }
  });

  it("recognizes help", () => {
    expect(classifyInboundSms("HELP")).toBe("help");
    expect(classifyInboundSms("INFO")).toBe("help");
  });

  it("ignores case", () => {
    expect(classifyInboundSms("stop")).toBe("opt_out");
    expect(classifyInboundSms("Stop")).toBe("opt_out");
    expect(classifyInboundSms("sToP")).toBe("opt_out");
  });

  it("ignores surrounding whitespace", () => {
    expect(classifyInboundSms("  STOP  ")).toBe("opt_out");
    expect(classifyInboundSms("\nSTOP\n")).toBe("opt_out");
  });

  it("ignores trailing punctuation", () => {
    expect(classifyInboundSms("STOP.")).toBe("opt_out");
    expect(classifyInboundSms("Stop!")).toBe("opt_out");
    expect(classifyInboundSms("stop?")).toBe("opt_out");
  });

  it("does not match a keyword inside a sentence", () => {
    // The eager-matching failure. Someone asking you to keep going must not be
    // unsubscribed for using the word.
    expect(classifyInboundSms("please don't stop sending these")).toBe("none");
    expect(classifyInboundSms("I can't wait for the next one, don't ever cancel")).toBe("none");
    expect(classifyInboundSms("where do I start?")).toBe("none");
  });

  it("treats an ordinary reply as nothing to act on", () => {
    expect(classifyInboundSms("thanks!")).toBe("none");
    expect(classifyInboundSms("")).toBe("none");
    expect(classifyInboundSms("   ")).toBe("none");
  });

  it("does not throw on absent or non-string input", () => {
    expect(classifyInboundSms(null)).toBe("none");
    expect(classifyInboundSms(undefined)).toBe("none");
    // @ts-expect-error deliberately wrong: this reads an untrusted request body
    expect(classifyInboundSms(42)).toBe("none");
  });
});

describe("twiml", () => {
  it("escapes XML so a reply cannot break the document", () => {
    // The reply text is ours today, but an unescaped template is a trap waiting
    // for the first person who interpolates part of the inbound message.
    const out = twiml('a & b <c> "d"');
    expect(out).toContain("a &amp; b &lt;c&gt;");
    expect(out).not.toContain("<c>");
  });

  it("produces a single Message response", () => {
    expect(twiml("hello")).toBe(
      '<?xml version="1.0" encoding="UTF-8"?><Response><Message>hello</Message></Response>'
    );
  });
});
