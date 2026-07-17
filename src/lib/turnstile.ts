/**
 * Verify a Cloudflare Turnstile token on the server side.
 * Docs: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
 */
export async function verifyTurnstileToken(token: string): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    if (process.env.NODE_ENV === "production") return false;
    console.warn("[turnstile] TURNSTILE_SECRET_KEY not set — skipping verification");
    return true; // fail open in dev only
  }

  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret, response: token }),
    });
    const data = await res.json();
    return data.success === true;
  } catch (err) {
    console.error("[turnstile] Verification error:", err);
    return false;
  }
}
