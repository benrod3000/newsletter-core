import crypto from "crypto";

export type AdminRole = "owner" | "editor" | "viewer";

export interface AdminContext {
  username: string;
  role: AdminRole;
  clientId: string | null;
}

/**
 * Read at call time rather than module load so a missing secret surfaces as a
 * failed request in every environment, instead of being latched at cold start.
 */
function getHmacSecret(): string {
  const secret = process.env.ADMIN_HMAC_SECRET;
  if (!secret) {
    throw new Error(
      "ADMIN_HMAC_SECRET is required - admin header signing cannot be disabled."
    );
  }
  return secret;
}

/**
 * Sign admin context headers with an HMAC so route handlers can verify
 * the headers were set by the proxy (not injected externally).
 *
 * This is the only thing binding x-admin-username / x-admin-role to an actual
 * authentication having happened, so it must never be optional.
 */
export function signAdminHeaders(payload: string): string {
  return crypto.createHmac("sha256", getHmacSecret()).update(payload).digest("hex");
}

function verifyAdminSignature(signature: string, username: string, role: string, clientId: string | null): boolean {
  if (!signature) return false;
  const expected = signAdminHeaders(`${username}:${role}:${clientId || ""}`);
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length) return false;
  try {
    return crypto.timingSafeEqual(sigBuf, expBuf);
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
