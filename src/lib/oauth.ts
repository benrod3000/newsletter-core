import { createClientJWT } from "./jwt";
import crypto from "crypto";

const API_BASE = process.env.API_URL
  || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null)
  || "https://newsletter-core.vercel.app";

export const OAUTH_REDIRECT = `${API_BASE}/api/auth/oauth`;

/** OAuth CSRF protection */
export function generateOAuthState(): { value: string; cookie: string } {
  const value = crypto.randomBytes(32).toString("hex");
  return { value, cookie: `oauth_state=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600` };
}

export function verifyOAuthState(state: string | null, cookie: string | null): boolean {
  if (!state || !cookie) return false;
  if (state.length !== cookie.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(state), Buffer.from(cookie));
  } catch {
    return false;
  }
}

/**
 * Exchange Google authorization code for tokens
 */
export async function getGoogleTokens(code: string): Promise<{ access_token: string; email: string; name: string; sub: string }> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      workspace_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: `${OAUTH_REDIRECT}/google/callback`,
      grant_type: "authorization_code",
    }),
  });
  const tokens = await res.json();
  if (!tokens.access_token) throw new Error("Failed to get Google tokens");

  // Fetch user info
  const userRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  const user = await userRes.json();
  return { access_token: tokens.access_token, email: user.email, name: user.name, sub: user.id };
}

/**
 * Exchange GitHub authorization code for tokens
 */
export async function getGitHubTokens(code: string): Promise<{ access_token: string; email: string; name: string; login: string }> {
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      code,
      workspace_id: process.env.GITHUB_CLIENT_ID!,
      client_secret: process.env.GITHUB_CLIENT_SECRET!,
    }),
  });
  const tokens = await res.json();
  if (!tokens.access_token) throw new Error("Failed to get GitHub tokens");

  // Fetch user info
  const [userRes, emailsRes] = await Promise.all([
    fetch("https://api.github.com/user", { headers: { Authorization: `Bearer ${tokens.access_token}` } }),
    fetch("https://api.github.com/user/emails", { headers: { Authorization: `Bearer ${tokens.access_token}` } }),
  ]);
  const user = await userRes.json();
  const emails = await emailsRes.json();
  const primaryEmail = emails.find((e: any) => e.primary)?.email || user.email;

  return { access_token: tokens.access_token, email: primaryEmail, name: user.name || user.login, login: user.login };
}

/**
 * Find or create a workspace user from OAuth email
 * Returns { token, workspaceId, email, role }
 */
export async function findOrCreateOAuthUser(email: string, name: string): Promise<{
  token?: string;
  workspaceId: string;
  email: string;
  role: string;
  requires_totp?: boolean;
  partial_token?: string;
}> {
  const supabaseUrl = process.env.SUPABASE_URL!;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const auth = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` };

  // Check if user exists
  const checkRes = await fetch(
    `${supabaseUrl}/rest/v1/workspace_users?select=id,workspace_id,email,role,totp_enabled&email=eq.${encodeURIComponent(email)}&limit=1`,
    { headers: auth }
  );
  const existing = await checkRes.json();

  if (existing && existing.length > 0) {
    const user = existing[0];
    if (user.totp_enabled) {
      // Audience "totp_pending" - no workspace access until the second factor
      // is exchanged at /api/auth/totp/verify. Deliberately not returned as
      // `token`: callers must not treat this as a session.
      const partialToken = createClientJWT(user.workspace_id, user.id, user.email, user.role, 300, "totp_pending");
      return { requires_totp: true, partial_token: partialToken, workspaceId: user.workspace_id, email: user.email, role: user.role };
    }
    const token = createClientJWT(user.workspace_id, user.id, user.email, user.role);
    return { token, workspaceId: user.workspace_id, email: user.email, role: user.role };
  }

  // Create new workspace + user
  const workspaceRes = await fetch(`${supabaseUrl}/rest/v1/clients`, {
    method: "POST",
    headers: { ...auth, "Prefer": "return=representation" },
    body: JSON.stringify({
      name: `${name}'s Workspace`,
      slug: `${name.toLowerCase().replace(/[^a-z0-9-]+/g, "-")}-${crypto.randomUUID().split("-")[0]}`,
    }),
  });
  const workspace = await workspaceRes.json();
  const workspaceId = workspace.id || workspace[0]?.id;

  const userRes = await fetch(`${supabaseUrl}/rest/v1/workspace_users`, {
    method: "POST",
    headers: { ...auth, "Prefer": "return=representation" },
    body: JSON.stringify({
      workspace_id: workspaceId,
      email,
      password_hash: `oauth:${crypto.randomUUID()}`,
      role: "owner",
      is_active: true,
    }),
  });
  const newUser = await userRes.json();
  const userId = newUser.id || newUser[0]?.id;

  const token = createClientJWT(workspaceId, userId, email, "owner");
  return { token, workspaceId, email, role: "owner" };
}
