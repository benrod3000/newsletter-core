import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";
import { getClientContextFromJWT } from "@/lib/client-context";
import { generateTOTPSecret, getTOTPUri } from "@/lib/totp";

/**
 * POST /api/auth/totp/setup
 * Generate a new TOTP secret and return the provisioning URI.
 * Requires a valid JWT.
 */
export async function POST(req: NextRequest) {
  const ctx = getClientContextFromJWT(req);
  if (!ctx) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Not authenticated" } }, { status: 401 });
  }

  const secret = generateTOTPSecret();
  const uri = getTOTPUri(secret, ctx.email);

  return NextResponse.json({ secret, uri }, { status: 200 });
}
