import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { logError } from "./logger";

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
  // Vercel Cron sends: Authorization: Bearer <CRON_SECRET>
  const authHeader = req.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const header = authHeader.slice(7);
  // Constant-time comparison
  const headerBuf = Buffer.from(header);
  const secretBuf = Buffer.from(secret);
  if (headerBuf.length !== secretBuf.length || !crypto.timingSafeEqual(headerBuf, secretBuf)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  return null;
}
