/**
 * The client IP, as far as it can be trusted.
 *
 * Every rate limiter in this codebase used to derive the caller from
 * `x-forwarded-for`.split(",")[0] - the *first* entry in the chain. A proxy
 * appends to that header rather than replacing it, so a request that arrives
 * carrying its own X-Forwarded-For puts an attacker-chosen value in exactly
 * that position. Rotating it bought unlimited login attempts, unlimited
 * signups and unlimited tracking writes, and it quietly defeated the login
 * limiter's fail-closed mode as well: the limiter ran, it just counted a
 * different bucket every time.
 *
 * Vercel sets `x-vercel-forwarded-for` at the edge and a client cannot forge
 * it, so it is preferred. Falling back to X-Forwarded-For, the entry to trust
 * is the *last* one - that is the address the nearest trusted proxy observed
 * and appended, and anything to the left of it is client-supplied.
 *
 * Returns "unknown" when no header is present. Callers use that as a bucket
 * key; it is deliberately a single shared bucket rather than a bypass.
 */
export function getClientIp(req: { headers: Headers }): string {
  const vercel = lastEntry(req.headers.get("x-vercel-forwarded-for"));
  if (vercel) return vercel;

  const forwarded = lastEntry(req.headers.get("x-forwarded-for"));
  if (forwarded) return forwarded;

  const real = req.headers.get("x-real-ip")?.trim();
  if (real) return real;

  return "unknown";
}

function lastEntry(header: string | null): string | null {
  if (!header) return null;
  const parts = header
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : null;
}
