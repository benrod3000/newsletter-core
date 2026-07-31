/**
 * Redis-backed rate limiter using a sliding-window token bucket.
 * Works across all Vercel regions and serverless instances.
 *
 * Uses Upstash Redis REST API - no TCP, no persistent connection.
 * Falls back to permissive mode if Redis is unavailable (no crash).
 */

import { Redis } from "@upstash/redis";
import { logError, logWarn } from "./logger";
import { resolveRedisCredentials } from "./env";

/**
 * Credential names come from env.ts so the startup warning and this client
 * cannot disagree about which variables count. See the note there: KV_URL and
 * REDIS_URL show up alongside these but are TCP connection strings, and this
 * client speaks REST only.
 */
const { url: redisUrl, token: redisToken } = resolveRedisCredentials();

const redis = redisUrl && redisToken
  ? new Redis({ url: redisUrl, token: redisToken })
  : null;

const TTL_SECONDS = 3600; // buckets expire after 1h of inactivity

export interface RateLimitResult {
  allowed: boolean;
  retryAfter?: number;
  remaining: number;
  limit: number;
}

/**
 * What to do when the limiter itself cannot run (Redis missing or erroring).
 *
 * - "open"   - allow the request. Correct for tracking pixels and other paths
 *              where a dropped event costs more than an unmetered request.
 * - "closed" - reject the request. Correct for authentication, where a Redis
 *              outage would otherwise silently remove the brute-force ceiling.
 */
export type FailureMode = "open" | "closed";

export async function rateLimit(
  ip: string,
  maxTokens: number,
  refillRate: number,
  onFailure: FailureMode = "open"
): Promise<RateLimitResult> {
  const fallback: RateLimitResult =
    onFailure === "closed"
      ? { allowed: false, retryAfter: 5, remaining: 0, limit: maxTokens }
      : { allowed: true, remaining: maxTokens, limit: maxTokens };

  // No Redis configured is a deployment state, not an attack condition: always
  // allow, and rely on the startup warning in src/lib/env.ts to surface it.
  // Failing closed here would reject every login on a deploy that simply has no
  // Upstash credentials yet. `onFailure` governs the error path below, where the
  // limiter was expected to work and did not.
  if (!redis) {
    logWarn("rate-limit: Redis not configured; limiter inactive", { onFailure });
    return { allowed: true, remaining: maxTokens, limit: maxTokens };
  }

  const key = `rate-limit:${ip}:${maxTokens}`;
  const now = Date.now();

  try {
    // Lua script does: get bucket → refill → deduct → return result - atomically
    const raw = await redis.eval(
      `
      local key = KEYS[1]
      local max = tonumber(ARGV[1])
      local refill = tonumber(ARGV[2])
      local now = tonumber(ARGV[3])
      local ttl = tonumber(ARGV[4])

      local data = redis.call("GET", key)
      local tokens, lastRefill

      if data then
        local parsed = cjson.decode(data)
        tokens = parsed[1]
        lastRefill = parsed[2]
      else
        tokens = max
        lastRefill = now
      end

      -- Refill
      local elapsed = (now - lastRefill) / 1000
      tokens = math.min(max, tokens + elapsed * refill)
      lastRefill = now

      local remaining = math.floor(tokens)
      local allowed = 0
      local retryAfter = 0

      if tokens >= 1 then
        tokens = tokens - 1
        allowed = 1
        remaining = math.floor(tokens)
      else
        retryAfter = math.ceil((1 - tokens) / refill)
      end

      redis.call("SET", key, cjson.encode({tokens, lastRefill}), "EX", ttl)
      return {allowed, retryAfter, remaining, max}
      `,
      [key],
      [maxTokens, refillRate, now, TTL_SECONDS]
    );

    // A Lua table `{a, b, c, d}` comes back over RESP as an array, not an object.
    // Reading `.allowed` off it yielded undefined, so `=== 1` was always false
    // and every request was reported as blocked whenever Redis was reachable.
    if (!Array.isArray(raw) || raw.length !== 4) {
      logError(new Error("rate-limit: unexpected Lua reply shape"), { raw, onFailure });
      return fallback;
    }

    const [allowed, retryAfter, remaining, limit] = raw.map(Number) as [
      number,
      number,
      number,
      number,
    ];

    return {
      allowed: allowed === 1,
      retryAfter: retryAfter > 0 ? retryAfter : undefined,
      remaining,
      limit,
    };
  } catch (err) {
    logError(err, { scope: "rate-limit", onFailure });
    return fallback;
  }
}
