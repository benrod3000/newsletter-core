/**
 * The last-resort from-address for a send whose workspace has none.
 *
 * Every campaign path ended its from-address chain with a literal
 * `"noreply@veloce.app"`. **Veloce does not own veloce.app** - confirmed with Ben
 * on 2026-08-11, and the domain has no MX and resolves to someone else's
 * Cloudflare. So the fallback named a domain this project cannot publish SPF or
 * DKIM for. Any send that reached it would be rejected outright by a receiving
 * server, or accepted and filed as spam, and either way it asserts a From address
 * belonging to a stranger.
 *
 * `TRANSACTIONAL_FROM_EMAIL` is the address the platform already sends password
 * resets from, so it is verified with the provider by definition. The literal is
 * only a floor for local runs where nothing is configured.
 *
 * This is a floor, not a feature: a workspace that reaches it is misconfigured,
 * and its recipients will see an address that is not the sender's. Prefer failing
 * loudly at the call site where that matters.
 */
export const PLATFORM_FALLBACK_FROM_EMAIL =
  process.env.TRANSACTIONAL_FROM_EMAIL || "noreply@brod3000.com";
