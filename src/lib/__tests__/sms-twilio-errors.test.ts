import { describe, it, expect, vi, afterEach } from "vitest";
import { TwilioTransport } from "../sms/twilio";

/**
 * Whether a failure is retryable is the only judgement this transport makes, and
 * it is wrong in an expensive way in both directions.
 *
 * The code being replaced made no judgement at all: every failure went into
 * `failed++` and was dropped. A rate limit that clears in a second and a
 * permanently invalid number were handled identically, and neither was retried.
 *
 * Marking a permanent error retryable burns three attempts per recipient against
 * a provider that is already rate limiting, which makes the rate limiting worse.
 * Marking a transient error permanent silently drops a real person from a
 * campaign they consented to. So each class is pinned individually.
 */

function twilioResponding(status: number, body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    })
  );
}

const transport = new TwilioTransport("AC_test", "token_test", "+15125550100");
const message = { to: "+15125550199", from: "+15125550100", body: "hello" };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("TwilioTransport.send classification", () => {
  it("returns the message sid on success", async () => {
    twilioResponding(201, { sid: "SM123" });
    const result = await transport.send(message);
    expect(result.success).toBe(true);
    expect(result.messageId).toBe("SM123");
  });

  it("treats a 429 as retryable", async () => {
    twilioResponding(429, { code: 20429, message: "Too many requests" });
    const result = await transport.send(message);
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("RATE_LIMITED");
    expect(result.error?.retryable).toBe(true);
  });

  it("treats code 20429 on a non-429 status as retryable too", async () => {
    // Twilio signals the same condition both ways and either can arrive.
    twilioResponding(400, { code: 20429, message: "Too many requests" });
    const result = await transport.send(message);
    expect(result.error?.retryable).toBe(true);
  });

  it("treats a 5xx as retryable", async () => {
    twilioResponding(503, { message: "Service unavailable" });
    const result = await transport.send(message);
    expect(result.error?.code).toBe("PROVIDER_ERROR");
    expect(result.error?.retryable).toBe(true);
  });

  it("treats an invalid number as permanent", async () => {
    twilioResponding(400, { code: 21211, message: "Invalid 'To' number" });
    const result = await transport.send(message);
    expect(result.error?.code).toBe("INVALID_ADDRESS");
    expect(result.error?.retryable).toBe(false);
  });

  it("treats a landline as permanent", async () => {
    twilioResponding(400, { code: 21614, message: "'To' is not SMS capable" });
    const result = await transport.send(message);
    expect(result.error?.retryable).toBe(false);
  });

  it("surfaces a provider-side opt-out distinctly and permanently", async () => {
    // 21610 means the recipient replied STOP directly to the number. Twilio keeps
    // its own opt-out list, so it refuses whatever this database believes. The
    // send path has to act on this specifically: leaving sms_consent true means
    // every future campaign re-attempts someone who has already said no.
    twilioResponding(400, { code: 21610, message: "Attempt to send to unsubscribed recipient" });
    const result = await transport.send(message);
    expect(result.error?.code).toBe("RECIPIENT_OPTED_OUT");
    expect(result.error?.retryable).toBe(false);
  });

  it("distinguishes a misconfigured sender from a bad recipient", async () => {
    // Every recipient will fail this way, so it is not the recipient's fault and
    // marking them bad would be wrong.
    twilioResponding(400, { code: 21606, message: "'From' is not a valid SMS-capable number" });
    const result = await transport.send(message);
    expect(result.error?.code).toBe("INVALID_SENDER");
    expect(result.error?.retryable).toBe(false);
  });

  it("treats bad credentials as permanent, not a transient blip", async () => {
    twilioResponding(401, { code: 20003, message: "Authentication failed" });
    const result = await transport.send(message);
    expect(result.error?.code).toBe("AUTH_FAILED");
    expect(result.error?.retryable).toBe(false);
  });

  it("defaults an unrecognized 4xx to permanent", async () => {
    // Twilio 4xx means it rejected the request; an identical retry earns an
    // identical rejection, three times, for nothing.
    twilioResponding(400, { code: 99999, message: "Something new" });
    const result = await transport.send(message);
    expect(result.error?.retryable).toBe(false);
  });

  it("treats a network failure as retryable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("socket hang up")));
    const result = await transport.send(message);
    expect(result.error?.code).toBe("NETWORK_ERROR");
    expect(result.error?.retryable).toBe(true);
  });

  it("never throws, even when the error body is unparseable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => {
          throw new Error("not json");
        },
      })
    );
    const result = await transport.send(message);
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain("400");
  });

  it("attaches media as repeated MediaUrl fields", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 201, json: async () => ({ sid: "SM1" }) });
    vi.stubGlobal("fetch", fetchMock);

    await transport.send({ ...message, mediaUrls: ["https://a.example/1.png", "https://a.example/2.png"] });

    const body = fetchMock.mock.calls[0][1].body as URLSearchParams;
    expect(body.getAll("MediaUrl")).toEqual(["https://a.example/1.png", "https://a.example/2.png"]);
  });
});

describe("TwilioTransport.health", () => {
  it("fails when the sender number cannot send SMS", async () => {
    // The false green this exists to prevent. Credentials are perfect and the
    // number is real; it just cannot send a text. Checking auth alone would
    // report healthy and every message would fail with 21606.
    twilioResponding(200, { incoming_phone_numbers: [{ capabilities: { sms: false } }] });
    const health = await transport.health();
    expect(health.healthy).toBe(false);
    expect(health.lastError).toContain("cannot send SMS");
  });

  it("fails when the number is not on the account", async () => {
    twilioResponding(200, { incoming_phone_numbers: [] });
    const health = await transport.health();
    expect(health.healthy).toBe(false);
    expect(health.lastError).toContain("not a number on this Twilio account");
  });

  it("names bad credentials specifically", async () => {
    twilioResponding(401, {});
    const health = await transport.health();
    expect(health.healthy).toBe(false);
    expect(health.lastError).toContain("account SID or auth token");
  });

  it("passes when credentials work and the number is SMS capable", async () => {
    twilioResponding(200, { incoming_phone_numbers: [{ capabilities: { sms: true } }] });
    const health = await transport.health();
    expect(health.healthy).toBe(true);
  });
});
