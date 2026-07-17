import { NextRequest, NextResponse } from "next/server";
import { getGitHubTokens, findOrCreateOAuthUser, verifyOAuthState } from "@/lib/oauth";

const FRONTEND_URL = "https://newsletter.brod3000.com";

/**
 * GET /api/auth/oauth/github/callback
 * Handle GitHub OAuth callback
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const error = searchParams.get("error");
  const state = searchParams.get("state");
  const cookieState = req.cookies.get("oauth_state")?.value ?? null;

  if (!verifyOAuthState(state, cookieState)) {
    return NextResponse.redirect(`${FRONTEND_URL}/login?oauth_error=csrf`);
  }

  if (error || !code) {
    return NextResponse.redirect(`${FRONTEND_URL}/login?oauth_error=${error || "no_code"}`);
  }

  try {
    const userInfo = await getGitHubTokens(code);
    const result = await findOrCreateOAuthUser(userInfo.email, userInfo.name || userInfo.login);

    if (result.requires_totp) {
      return NextResponse.redirect(
        `${FRONTEND_URL}/login?requires_totp=true&partial_token=${result.partial_token}`
      );
    }

    return NextResponse.redirect(
      `${FRONTEND_URL}/oauth/callback#token=${result.token}&workspaceId=${result.workspaceId}&email=${encodeURIComponent(result.email)}&role=${result.role}`
    );
  } catch (err: any) {
    console.error("[oauth/github] Error:", err?.message);
    return NextResponse.redirect(`${FRONTEND_URL}/login?oauth_error=token_exchange_failed`);
  }
}
