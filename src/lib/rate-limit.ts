/**
 * Simple in-memory rate limiter using token bucket algorithm.
 * Each IP gets `maxTokens` tokens that refill at `refillRate` tokens/second.
 *
 * In serverless (Vercel), this resets per-function-instance — acceptable
 * for basic protection. For production, use Upstash Redis.
 */

interface Bucket {
  tokens: number;
  lastRefill: number;
}

const buckets = new Map<string, Bucket>();

// Clean up stale entries every 5 minutes
const CLEANUP_INTERVAL = 5 * 60 * 1000;
let lastCleanup = Date.now();

function cleanup() {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL) return;
  lastCleanup = now;
  for (const [key, bucket] of buckets) {
    if (now - bucket.lastRefill > 60000) {
      buckets.delete(key);
    }
  }
}

export function rateLimit(
  ip: string,
  maxTokens: number,
  refillRate: number
): { allowed: boolean; retryAfter?: number; remaining: number; limit: number } {
  cleanup();

  const now = Date.now();
  const key = ip;
  let bucket = buckets.get(key);

  if (!bucket) {
    bucket = { tokens: maxTokens, lastRefill: now };
    buckets.set(key, bucket);
  }

  // Refill tokens
  const elapsed = (now - bucket.lastRefill) / 1000; // seconds
  bucket.tokens = Math.min(maxTokens, bucket.tokens + elapsed * refillRate);
  bucket.lastRefill = now;

  const remaining = Math.floor(bucket.tokens);

  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return { allowed: true, remaining: remaining - 1, limit: maxTokens };
  }

  const retryAfter = Math.ceil((1 - bucket.tokens) / refillRate);
  return { allowed: false, retryAfter: Math.max(1, retryAfter), remaining: 0, limit: maxTokens };
}
