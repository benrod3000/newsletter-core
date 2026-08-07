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
  ["SUPABASE_ANON_KEY", "Public API key the workspace-scoped client presents. Identity comes from the minted token, not this key."],
  [
    "SUPABASE_JWT_SECRET",
    "Signs workspace-scoped database tokens. Without it RLS cannot be enforced, so withWorkspace() routes fail closed rather than falling back to unscoped access.",
  ],
  ["JWT_SECRET", "Signs client session tokens. Rotating it invalidates all sessions."],
  ["ADMIN_HMAC_SECRET", "Signs admin context headers. Without it admin headers cannot be verified."],
  ["CRON_SECRET", "Authenticates Vercel cron invocations."],
] as const;

/**
 * The same Upstash database is provisioned under two naming conventions:
 * KV_REST_API_* by Vercel's Marketplace integration, UPSTASH_REDIS_REST_* by
 * Upstash's own dashboard. Both are credentials for the same REST API.
 *
 * These live here, and the limiter imports them, so the startup check and the
 * client can never disagree about which names count. They previously did:
 * installing the Vercel integration set KV_* while the limiter read only
 * UPSTASH_*, so rate limiting stayed inactive in production and the only
 * evidence was a startup warning naming variables nobody had heard of.
 */
export const REDIS_URL_VARS = ["KV_REST_API_URL", "UPSTASH_REDIS_REST_URL"] as const;
export const REDIS_TOKEN_VARS = ["KV_REST_API_TOKEN", "UPSTASH_REDIS_REST_TOKEN"] as const;

/** First value found for each, under either convention. */
export function resolveRedisCredentials(): { url?: string; token?: string } {
  return {
    url: REDIS_URL_VARS.map((name) => process.env[name]).find(Boolean),
    token: REDIS_TOKEN_VARS.map((name) => process.env[name]).find(Boolean),
  };
}

/**
 * Recommended rather than required: absent, a feature quietly does nothing
 * instead of the app failing to boot. Each entry lists every name that
 * satisfies it.
 */
/**
 * Platform email: password resets and the signup welcome.
 *
 * Recommended rather than required on purpose. A missing reset sender is
 * serious - account recovery does not work without it - but it should not stop
 * the application booting, which would take down every workspace that is
 * sending campaigns perfectly well through its own provider.
 *
 * It is here at all because this was previously silent: the send threw, the
 * caller swallowed it, and the endpoint reported success. Nothing anywhere said
 * that password reset had never worked.
 */
const TRANSACTIONAL_KEY_VARS = ["RESEND_API_KEY", "SENDGRID_API_KEY"] as const;
const TRANSACTIONAL_FROM_VARS = ["TRANSACTIONAL_FROM_EMAIL", "SENDGRID_FROM_EMAIL"] as const;

const RECOMMENDED: readonly (readonly [readonly string[], string])[] = [
  [REDIS_URL_VARS, "Rate limiting is inactive without a Redis REST URL."],
  [REDIS_TOKEN_VARS, "Rate limiting is inactive without a Redis REST token."],
  [
    TRANSACTIONAL_KEY_VARS,
    "Password reset and signup emails cannot be sent without a platform email API key.",
  ],
  [
    TRANSACTIONAL_FROM_VARS,
    "Password reset and signup emails cannot be sent without a from address.",
  ],
] as const;

export function assertRequiredEnv(): void {
  const missingRequired = REQUIRED.filter(([name]) => !process.env[name]);
  const missingRecommended = RECOMMENDED.filter(
    ([names]) => !names.some((name) => process.env[name])
  );

  for (const [names, why] of missingRecommended) {
    console.warn(`[env] none of ${names.join(" / ")} is set - ${why}`);
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
