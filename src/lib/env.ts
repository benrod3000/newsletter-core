/**
 * Startup environment validation.
 *
 * Several secrets are security-critical: when they are absent the affected code
 * either throws mid-request or, worse, silently degrades to a weaker check.
 * Validating once at cold start turns "mysterious 500 in production" and
 * "auth quietly stopped verifying" into a loud, early failure.
 *
 * In development the same problems are reported as warnings so a fresh clone
 * still boots without a fully populated .env.local.
 */

const REQUIRED = [
  ["SUPABASE_URL", "Supabase project URL."],
  ["SUPABASE_SERVICE_ROLE_KEY", "Server-side Supabase key. Never expose to the browser."],
  ["JWT_SECRET", "Signs client session tokens. Rotating it invalidates all sessions."],
  ["ADMIN_HMAC_SECRET", "Signs admin context headers. Without it admin headers cannot be verified."],
  ["CRON_SECRET", "Authenticates Vercel cron invocations."],
] as const;

const RECOMMENDED = [
  ["UPSTASH_REDIS_REST_URL", "Rate limiting is inactive without this."],
  ["UPSTASH_REDIS_REST_TOKEN", "Rate limiting is inactive without this."],
] as const;

export function assertRequiredEnv(): void {
  const missingRequired = REQUIRED.filter(([name]) => !process.env[name]);
  const missingRecommended = RECOMMENDED.filter(([name]) => !process.env[name]);

  for (const [name, why] of missingRecommended) {
    console.warn(`[env] ${name} is not set - ${why}`);
  }

  if (missingRequired.length === 0) return;

  const detail = missingRequired.map(([name, why]) => `  - ${name}: ${why}`).join("\n");

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      `Missing required environment variables:\n${detail}\n` +
        `Set these in the Vercel project settings before deploying.`
    );
  }

  console.warn(
    `[env] Missing required environment variables (fatal in production):\n${detail}`
  );
}
