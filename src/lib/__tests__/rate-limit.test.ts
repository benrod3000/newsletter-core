import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const evalMock = vi.fn();

vi.mock("@upstash/redis", () => ({
  Redis: class {
    eval = evalMock;
  },
}));

// The module builds its Redis client at import time, so env must be set first.
beforeEach(() => {
  vi.resetModules();
  evalMock.mockReset();
  process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
  process.env.UPSTASH_REDIS_REST_TOKEN = "token";
});

afterEach(() => {
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
});

describe("rateLimit - Lua reply parsing", () => {
  it("allows a request when the script returns allowed=1", async () => {
    // Redis returns a Lua table as an ARRAY: [allowed, retryAfter, remaining, max]
    evalMock.mockResolvedValue([1, 0, 4, 5]);
    const { rateLimit } = await import("../rate-limit");

    const result = await rateLimit("ip", 5, 5 / 60);

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(4);
    expect(result.limit).toBe(5);
    expect(result.retryAfter).toBeUndefined();
  });

  it("blocks a request when the script returns allowed=0", async () => {
    evalMock.mockResolvedValue([0, 12, 0, 5]);
    const { rateLimit } = await import("../rate-limit");

    const result = await rateLimit("ip", 5, 5 / 60);

    expect(result.allowed).toBe(false);
    expect(result.retryAfter).toBe(12);
    expect(result.remaining).toBe(0);
  });

  it("does not treat the array reply as an object", async () => {
    // Regression: the old code cast the array to {allowed,...} and read
    // `.allowed`, which is undefined - so `=== 1` was false for every reply
    // and legitimate requests were reported as rate-limited.
    evalMock.mockResolvedValue([1, 0, 99, 100]);
    const { rateLimit } = await import("../rate-limit");

    const result = await rateLimit("ip", 100, 100);

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(99);
  });

  it("falls back when the reply shape is unexpected", async () => {
    evalMock.mockResolvedValue({ allowed: 1 });
    const { rateLimit } = await import("../rate-limit");

    const result = await rateLimit("ip", 5, 5 / 60, "closed");

    expect(result.allowed).toBe(false);
  });
});

describe("rateLimit - failure modes", () => {
  it("allows through on Redis error when failing open", async () => {
    evalMock.mockRejectedValue(new Error("connection refused"));
    const { rateLimit } = await import("../rate-limit");

    const result = await rateLimit("ip", 100, 100, "open");

    expect(result.allowed).toBe(true);
  });

  it("rejects on Redis error when failing closed", async () => {
    evalMock.mockRejectedValue(new Error("connection refused"));
    const { rateLimit } = await import("../rate-limit");

    const result = await rateLimit("ip", 5, 5 / 60, "closed");

    // An auth endpoint must not lose its brute-force ceiling during an outage.
    expect(result.allowed).toBe(false);
    expect(result.retryAfter).toBe(5);
  });

  it("defaults to failing open", async () => {
    evalMock.mockRejectedValue(new Error("boom"));
    const { rateLimit } = await import("../rate-limit");

    expect((await rateLimit("ip", 5, 1)).allowed).toBe(true);
  });
});

describe("rateLimit - Redis not configured", () => {
  it("allows traffic even on fail-closed routes", async () => {
    vi.resetModules();
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;

    const { rateLimit } = await import("../rate-limit");
    const result = await rateLimit("ip", 5, 5 / 60, "closed");

    // An absent limiter is a deployment state, not an outage. Failing closed
    // here would reject every login on a deploy with no Upstash credentials.
    expect(result.allowed).toBe(true);
  });
});
