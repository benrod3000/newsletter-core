import { NextResponse } from "next/server";

const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID;
const API_BASE = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : "http://localhost:3000";

/**
 * GET /api/auth/oauth/github
 * Redirect to GitHub OAuth consent screen
 */
export async function GET() {
  if (!GITHUB_CLIENT_ID) {
    return NextResponse.json({ error: "GitHub OAuth not configured" }, { status: 500 });
  }

  const params = new URLSearchParams({
    client_id: GITHUB_CLIENT_ID,
    redirect_uri: `${API_BASE}/api/auth/oauth/github/callback`,
    scope: "read:user user:email",
  });

  return NextResponse.redirect(`https://github.com/login/oauth/authorize?${params}`);
}
