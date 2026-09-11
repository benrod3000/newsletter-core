import { describe, it, expect } from "vitest";
import {
  computeTwilioSignature,
  verifyTwilioSignature,
  signedUrlFor,
} from "../sms/twilio-signature";

/**
 * Pinned against Twilio's own published example, not against this
 * implementation's output.
 *
 * That distinction matters. A signature verifier tested only against itself
 * passes just as happily when the algorithm is wrong, and the failure is silent:
 * every real Twilio request gets rejected, inbound STOP stops working, and
 * people who asked to be left alone keep receiving messages. Verifying against
 * the vendor's fixture is the only version of this test that means anything.
 *
 * Vector from https://www.twilio.com/docs/usage/security#validating-requests
 */

const VECTOR = {
  authToken: "12345",
  url: "https://example.com/myapp.php?foo=1&bar=2",
  body: {
    Digits: "1234",
    To: "+18005551212",
    From: "+14158675310",
    Caller: "+14158675310",
    CallSid: "CA1234567890ABCDE",
  },
  signature: "L/OH5YylLD5NRKLltdqwSvS0BnU=",
};

describe("computeTwilioSignature", () => {
  it("reproduces Twilio's published signature", () => {
    expect(computeTwilioSignature(VECTOR.authToken, VECTOR.url, VECTOR.body)).toBe(
      VECTOR.signature
    );
  });

  it("sorts parameters by key, not by insertion order", () => {
    const shuffled = {
      CallSid: "CA1234567890ABCDE",
      From: "+14158675310",
      Digits: "1234",
      Caller: "+14158675310",
      To: "+18005551212",
    };
    expect(computeTwilioSignature(VECTOR.authToken, VECTOR.url, shuffled)).toBe(VECTOR.signature);
  });
});

describe("verifyTwilioSignature", () => {
  it("accepts the genuine signature", () => {
    expect(
      verifyTwilioSignature({
        authToken: VECTOR.authToken,
        url: VECTOR.url,
        body: VECTOR.body,
        signature: VECTOR.signature,
      })
    ).toBe(true);
  });

  it("rejects a tampered parameter", () => {
    // The attack this exists to stop: someone else's number substituted into an
    // otherwise valid opt-out request.
    expect(
      verifyTwilioSignature({
        authToken: VECTOR.authToken,
        url: VECTOR.url,
        body: { ...VECTOR.body, From: "+15125550199" },
        signature: VECTOR.signature,
      })
    ).toBe(false);
  });

  it("rejects the wrong auth token", () => {
    expect(
      verifyTwilioSignature({
        authToken: "wrong",
        url: VECTOR.url,
        body: VECTOR.body,
        signature: VECTOR.signature,
      })
    ).toBe(false);
  });

  it("rejects a different URL", () => {
    expect(
      verifyTwilioSignature({
        authToken: VECTOR.authToken,
        url: "https://example.com/myapp.php?foo=1&bar=3",
        body: VECTOR.body,
        signature: VECTOR.signature,
      })
    ).toBe(false);
  });

  it("rejects a missing signature rather than treating absence as valid", () => {
    expect(
      verifyTwilioSignature({
        authToken: VECTOR.authToken,
        url: VECTOR.url,
        body: VECTOR.body,
        signature: null,
      })
    ).toBe(false);
  });

  it("rejects a missing auth token, so an unconfigured workspace fails closed", () => {
    expect(
      verifyTwilioSignature({
        authToken: "",
        url: VECTOR.url,
        body: VECTOR.body,
        signature: VECTOR.signature,
      })
    ).toBe(false);
  });

  it("does not throw on a signature of the wrong length", () => {
    // timingSafeEqual throws on unequal buffers, so the length is checked first.
    // An exception here would become a 500, which tells an attacker their guess
    // was structurally different from the real thing.
    expect(() =>
      verifyTwilioSignature({
        authToken: VECTOR.authToken,
        url: VECTOR.url,
        body: VECTOR.body,
        signature: "short",
      })
    ).not.toThrow();
  });
});

describe("signedUrlFor", () => {
  it("trusts the forwarded proto, because Twilio signed the public URL", () => {
    // Behind Vercel's proxy the request arrives as http. Signing http when Twilio
    // signed https produces a different digest and rejects every real request.
    const req = new Request("http://internal.local/api/public/sms/webhook", {
      headers: { "x-forwarded-proto": "https", "x-forwarded-host": "newsletter-core.vercel.app" },
    });
    expect(signedUrlFor(req)).toBe("https://newsletter-core.vercel.app/api/public/sms/webhook");
  });

  it("takes the first value when a header carries a proxy chain", () => {
    const req = new Request("http://internal.local/api/public/sms/webhook", {
      headers: { "x-forwarded-proto": "https,http", "x-forwarded-host": "a.example, b.example" },
    });
    expect(signedUrlFor(req)).toBe("https://a.example/api/public/sms/webhook");
  });

  it("preserves the query string, which is part of what was signed", () => {
    const req = new Request("http://internal.local/hook?a=1&b=2", {
      headers: { "x-forwarded-proto": "https", "x-forwarded-host": "x.example" },
    });
    expect(signedUrlFor(req)).toBe("https://x.example/hook?a=1&b=2");
  });
});
