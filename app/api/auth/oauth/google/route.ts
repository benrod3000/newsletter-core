import { NextResponse } from "next/server";
import { generateOAuthState } from "@/lib/oauth";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const API_BASE = process.env.API_URL
  || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null)
  || "https://newsletter-core.vercel.app";

/**
 * GET /api/auth/oauth/google
 * Redirect to Google OAuth consent screen
 */
export async function GET() {
  if (!GOOGLE_CLIENT_ID) {
    return NextResponse.json({ error: "Google OAuth not configured" }, { status: 500 });
  }

  const state = generateOAuthState();

  const params = new URLSearchParams({
    workspace_id: GOOGLE_CLIENT_ID,
    redirect_uri: `${API_BASE}/api/auth/oauth/google/callback`,
    response_type: "code",
    scope: "openid email profile",
    access_type: "offline",
    state: state.value,
  });

  const response = NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
  response.headers.set("Set-Cookie", state.cookie);
  return response;
}
