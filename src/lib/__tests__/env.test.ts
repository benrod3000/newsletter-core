import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { assertRequiredEnv, resolveRedisCredentials } from "../env";

/**
 * Regression cover for a live outage of sorts: rate limiting was inactive in
 * production because Vercel's Upstash integration provisions KV_REST_API_* and
 * the limiter read only UPSTASH_REDIS_REST_*. Nothing failed, the limiter just
 * silently allowed everything.
 */

const REQUIRED = [
  "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_ANON_KEY",
  "SUPABASE_JWT_SECRET", "JWT_SECRET", "ADMIN_HMAC_SECRET", "CRON_SECRET",
];

describe("Redis credential detection", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  const saved = { ...process.env };

  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const k of REQUIRED) process.env[k] = "x";
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
  });

  afterEach(() => {
    warn.mockRestore();
    process.env = { ...saved };
  });

  const warnings = () => warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes("[env]"));

  /**
   * Only the Redis warnings. These assertions counted every [env] warning, so
   * adding an unrelated one elsewhere in RECOMMENDED broke four tests that have
   * nothing to do with it. Filtering keeps them about Redis.
   */
  const redisWarnings = () => warnings().filter((m) => m.includes("REDIS"));

  it("warns when neither prefix is set", () => {
    assertRequiredEnv();
    expect(redisWarnings()).toHaveLength(2);
    expect(redisWarnings()[0]).toContain("KV_REST_API_URL / UPSTASH_REDIS_REST_URL");
  });

  it("is satisfied by the Vercel integration's KV_ names", () => {
    process.env.KV_REST_API_URL = "https://x.upstash.io";
    process.env.KV_REST_API_TOKEN = "t";
    assertRequiredEnv();
    expect(redisWarnings()).toHaveLength(0);
  });

  it("is still satisfied by the original UPSTASH_ names", () => {
    process.env.UPSTASH_REDIS_REST_URL = "https://x.upstash.io";
    process.env.UPSTASH_REDIS_REST_TOKEN = "t";
    assertRequiredEnv();
    expect(redisWarnings()).toHaveLength(0);
  });

  it("warns about only the half that is missing", () => {
    process.env.KV_REST_API_URL = "https://x.upstash.io";
    assertRequiredEnv();
    expect(redisWarnings()).toHaveLength(1);
    expect(warnings()[0]).toContain("TOKEN");
  });
});

describe("resolveRedisCredentials", () => {
  const saved = { ...process.env };

  beforeEach(() => {
    for (const k of ["KV_REST_API_URL", "KV_REST_API_TOKEN",
                     "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"]) {
      delete process.env[k];
    }
  });
  afterEach(() => { process.env = { ...saved }; });

  it("returns nothing when unconfigured, so the limiter stays inactive", () => {
    expect(resolveRedisCredentials()).toEqual({ url: undefined, token: undefined });
  });

  it("reads the Vercel integration's KV_ names", () => {
    process.env.KV_REST_API_URL = "https://kv.upstash.io";
    process.env.KV_REST_API_TOKEN = "kv-token";
    expect(resolveRedisCredentials()).toEqual({ url: "https://kv.upstash.io", token: "kv-token" });
  });

  it("reads the UPSTASH_ names", () => {
    process.env.UPSTASH_REDIS_REST_URL = "https://up.upstash.io";
    process.env.UPSTASH_REDIS_REST_TOKEN = "up-token";
    expect(resolveRedisCredentials()).toEqual({ url: "https://up.upstash.io", token: "up-token" });
  });

  it("prefers KV_ when both conventions are present", () => {
    process.env.KV_REST_API_URL = "https://kv.upstash.io";
    process.env.KV_REST_API_TOKEN = "kv-token";
    process.env.UPSTASH_REDIS_REST_URL = "https://up.upstash.io";
    process.env.UPSTASH_REDIS_REST_TOKEN = "up-token";
    expect(resolveRedisCredentials().url).toBe("https://kv.upstash.io");
  });

  it("mixes conventions rather than requiring a matching pair", () => {
    process.env.KV_REST_API_URL = "https://kv.upstash.io";
    process.env.UPSTASH_REDIS_REST_TOKEN = "up-token";
    expect(resolveRedisCredentials()).toEqual({ url: "https://kv.upstash.io", token: "up-token" });
  });
});
