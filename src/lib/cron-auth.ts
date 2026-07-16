import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

/**
 * Checks that the incoming request carries the correct CRON_SECRET
 * in the `x-cron-secret` header, using a constant-time comparison.
 *
 * Returns a 401 error response if auth fails, or null if it succeeds.
 * Usage:
 *   const auth = requireCronSecret(req);
 *   if (auth) return auth;
 */
export function requireCronSecret(req: NextRequest): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Server misconfiguration." }, { status: 500 });
  }
  const header = req.headers.get("x-cron-secret");
  if (!header) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  // Constant-time comparison
  const headerBuf = Buffer.from(header);
  const secretBuf = Buffer.from(secret);
  if (headerBuf.length !== secretBuf.length || !crypto.timingSafeEqual(headerBuf, secretBuf)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  return null;
}
