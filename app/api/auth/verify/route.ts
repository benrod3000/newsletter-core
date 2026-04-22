import { NextRequest, NextResponse } from "next/server";
import { getClientContextFromJWT } from "@/lib/client-context";

/**
 * GET /api/auth/verify
 * Verify JWT token and return decoded payload
 * 
 * Authorization: Bearer <token>
 * 
 * Returns: {
 *   valid: boolean;
 *   payload: ClientJWTPayload | null;
 * }
 */
export async function GET(req: NextRequest) {
  const context = getClientContextFromJWT(req);

  if (!context) {
    return NextResponse.json(
      {
        valid: false,
        payload: null,
      },
      { status: 200 }
    );
  }

  return NextResponse.json(
    {
      valid: true,
      payload: context,
    },
    { status: 200 }
  );
}
