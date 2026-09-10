import { describe, it, expect } from "vitest";
import {
  buildRecipientSms,
  SmsBodyTooLongError,
  DEFAULT_OPT_OUT_NOTICE,
} from "../sms/recipient-sms";
import type { MergeRecipient } from "../campaign-personalization";

/**
 * The opt-out instruction has to be in the body, and merge tags have to actually
 * merge.
 *
 * Both of these have already gone wrong once in this codebase, in the email
 * path, and the fix was this same shape: one builder that everything sending to
 * a subscriber has to go through, so no caller can skip a step. Automations used
 * to assemble their own payload and shipped without an unsubscribe link for
 * weeks, which is a CAN-SPAM violation, and the token needed to build it was
 * already loaded and simply unused.
 *
 * SMS is worse in one respect: there is no List-Unsubscribe header. If the
 * opt-out is not in the body it does not exist anywhere, so the carrier
 * requirement and the legal requirement are the same line of text.
 */

const subscriber: MergeRecipient = {
  id: "sub-1",
  email: "sam@example.com",
  country: "US",
  region: "TX",
  city: "Austin",
  unsubscribe_token: "tok-123",
  first_name: "Sam",
  last_name: "Rivera",
  date_of_birth: null,
  phone_number: "+15125550199",
};

function build(body: string, over: Partial<MergeRecipient> = {}) {
  return buildRecipientSms({
    body,
    subscriber: { ...subscriber, ...over },
    from: "+15125550100",
    baseUrl: "https://api.example.com",
    campaignId: "camp-1",
  });
}

describe("buildRecipientSms", () => {
  it("appends the opt-out notice when the author did not write one", () => {
    const sms = build("Doors open at 7.");
    expect(sms.body).toContain(DEFAULT_OPT_OUT_NOTICE);
  });

  it("does not append a second notice when the body already says STOP", () => {
    const sms = build("Doors open at 7. Reply STOP to opt out.");
    const occurrences = sms.body.toLowerCase().split("stop").length - 1;
    expect(occurrences).toBe(1);
  });

  it("recognizes 'unsubscribe' as an existing opt-out instruction", () => {
    const sms = build("News. Reply UNSUBSCRIBE to stop hearing from us.");
    expect(sms.body).not.toContain(DEFAULT_OPT_OUT_NOTICE);
  });

  it("resolves merge tags rather than sending them literally", () => {
    // The old loop did two .replace() calls, for first_name and name only, so
    // every other tag the composer offered arrived as literal braces to a person.
    const sms = build("Hi {{first_name}}, see you in {{city}}.");
    expect(sms.body).toContain("Hi Sam, see you in Austin.");
    expect(sms.body).not.toContain("{{");
  });

  it("supports the fallback syntax the hand-rolled version had no concept of", () => {
    const sms = build("Hi {{first_name | there}}.", { first_name: null });
    expect(sms.body).toContain("Hi there.");
  });

  it("uses raw values, not HTML-escaped ones", () => {
    // The escaped map is for HTML. Using it here would put "O&#39;Brien" in a
    // text message, which is the same bug the two-map split fixed for email.
    const sms = build("Hi {{last_name}}.", { last_name: "O'Brien" });
    expect(sms.body).toContain("O'Brien");
    expect(sms.body).not.toContain("&#39;");
  });

  it("appends the notice after merging, so merged text cannot suppress it", () => {
    // A merge value containing "stop" must not be mistaken for the author
    // having written an opt-out instruction.
    const sms = build("Hi {{city}}.", { city: "Stopham" });
    expect(sms.body).toContain(DEFAULT_OPT_OUT_NOTICE);
  });

  it("sends to the subscriber's stored E.164 number", () => {
    const sms = build("Hello");
    expect(sms.to).toBe("+15125550199");
  });

  it("reports the segment count so cost is known before sending", () => {
    const sms = build("Hello");
    expect(sms.segments.segments).toBe(1);
    expect(sms.segments.encoding).toBe("GSM-7");
  });

  it("refuses an over-long body instead of truncating it", () => {
    // The old loop did `.slice(0, 1600)`, silently, mid-sentence, after the
    // operator had been shown a recipient count. A message the author did not
    // write is worse than an error they can act on.
    expect(() => build("a".repeat(2000))).toThrow(SmsBodyTooLongError);
  });

  it("throws rather than silently skipping a subscriber with no number", () => {
    // Unreachable if campaign_audience and this builder agree. Reaching it means
    // they do not, and skipping would hide that.
    expect(() => build("Hello", { phone_number: null })).toThrow(/no phone number/);
  });
});
