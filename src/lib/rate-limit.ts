/**
 * Redis-backed rate limiter using a sliding-window token bucket.
 * Works across all Vercel regions and serverless instances.
 *
 * Uses Upstash Redis REST API — no TCP, no persistent connection.
 * Falls back to permissive mode if Redis is unavailable (no crash).
 */

import { Redis } from "@upstash/redis";

const redis = process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
  ? new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    })
  : null;

const TTL_SECONDS = 3600; // buckets expire after 1h of inactivity

export async function rateLimit(
  ip: string,
  maxTokens: number,
  refillRate: number
): Promise<{ allowed: boolean; retryAfter?: number; remaining: number; limit: number }> {
  // Fallback: allow if Redis isn't configured
  if (!redis) {
    return { allowed: true, remaining: maxTokens, limit: maxTokens };
  }

  const key = `rate-limit:${ip}:${maxTokens}`;
  const now = Date.now();

  try {
    // Lua script does: get bucket → refill → deduct → return result — atomically
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

    const result = raw as unknown as { allowed: number; retryAfter: number; remaining: number; max: number };

    return {
      allowed: result.allowed === 1,
      retryAfter: result.retryAfter > 0 ? result.retryAfter : undefined,
      remaining: result.remaining,
      limit: result.max,
    };
  } catch {
    // Redis unavailable — allow through rather than block traffic
    return { allowed: true, remaining: maxTokens, limit: maxTokens };
  }
}
