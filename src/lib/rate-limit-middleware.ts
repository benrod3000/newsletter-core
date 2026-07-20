/**
 * Rate limit middleware helper.
 * Standardized wrapper around the Redis rate limiter.
 *
 * Usage in any route handler:
 *   const rl = await applyRateLimit(req, { max: 10, windowSec: 60 });
 *   if (!rl.allowed) return rateLimitedResponse(rl);
 */

import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";

interface RateLimitConfig {
  max: number;
  windowSec: number;
  /** Optional prefix for the rate limit key (defaults to the route path) */
  keyPrefix?: string;
}

interface RateLimitResult {
  allowed: boolean;
  retryAfter?: number;
  remaining: number;
  limit: number;
  headers: Record<string, string>;
}

/**
 * Apply rate limiting to a request. Returns result with CORS-safe headers.
 */
export async function applyRateLimit(
  req: NextRequest,
  config: RateLimitConfig
): Promise<RateLimitResult> {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || req.headers.get("x-real-ip")
    || "unknown";
  const key = config.keyPrefix || new URL(req.url).pathname;
  const compositeKey = `${key}:${ip}`;

  const refillRate = config.max / config.windowSec; // tokens per second
  const result = await rateLimit(compositeKey, config.max, refillRate);

  const headers: Record<string, string> = {
    "X-RateLimit-Limit": String(result.limit),
    "X-RateLimit-Remaining": String(result.remaining),
    "Access-Control-Allow-Origin": "*",
  };

  if (result.retryAfter) {
    headers["Retry-After"] = String(Math.ceil(result.retryAfter));
  }

  return { ...result, headers };
}

/**
 * Standard 429 response. Use when rate limit is exceeded.
 */
export function rateLimitedResponse(rl: RateLimitResult): NextResponse {
  return NextResponse.json(
    { error: { code: "RATE_LIMITED", message: "Too many requests", retryAfter: rl.retryAfter } },
    { status: 429, headers: rl.headers }
  );
}
