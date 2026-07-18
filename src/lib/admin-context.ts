import crypto from "crypto";

export type AdminRole = "owner" | "editor" | "viewer";

export interface AdminContext {
  username: string;
  role: AdminRole;
  clientId: string | null;
}

const HMAC_SECRET = process.env.ADMIN_HMAC_SECRET || "";

/**
 * Sign admin context headers with an HMAC so route handlers can verify
 * the headers were set by the proxy (not injected externally).
 * This provides defense-in-depth against proxy middleware bypasses.
 */
export function signAdminHeaders(payload: string): string {
  if (!HMAC_SECRET) return "";
  return crypto.createHmac("sha256", HMAC_SECRET).update(payload).digest("hex");
}

function verifyAdminSignature(signature: string, username: string, role: string, clientId: string | null): boolean {
  if (!HMAC_SECRET) return true; // not configured — fall back to header trust alone
  if (!signature) return false;
  const expected = signAdminHeaders(`${username}:${role}:${clientId || ""}`);
  if (signature.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

export function getAdminContextFromHeaders(headers: Headers): AdminContext | null {
  const username = headers.get("x-admin-username");
  const roleRaw = headers.get("x-admin-role");
  const clientId = headers.get("x-admin-client-id");

  if (!username || !roleRaw) return null;
  if (roleRaw !== "owner" && roleRaw !== "editor" && roleRaw !== "viewer") return null;

  // Verify HMAC signature if configured
  const signature = headers.get("x-admin-signature") || "";
  if (!verifyAdminSignature(signature, username, roleRaw, clientId || null)) {
    return null;
  }

  return {
    username,
    role: roleRaw,
    clientId: clientId || null,
  };
}

export function canEditCampaigns(ctx: AdminContext) {
  return ctx.role === "owner" || ctx.role === "editor";
}

export function canSendCampaigns(ctx: AdminContext) {
  return ctx.role === "owner" || ctx.role === "editor";
}
