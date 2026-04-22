import crypto from "crypto";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-in-production";

export interface ClientJWTPayload {
  workspaceId: string;
  userId: string;
  email: string;
  role: "owner" | "editor" | "viewer";
  iat: number;
  exp: number;
}

/**
 * Create a JWT token for client workspace access
 */
export function createClientJWT(
  workspaceId: string,
  userId: string,
  email: string,
  role: "owner" | "editor" | "viewer",
  expiresInSeconds: number = 86400 * 30 // 30 days
): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: ClientJWTPayload = {
    workspaceId,
    userId,
    email,
    role,
    iat: now,
    exp: now + expiresInSeconds,
  };

  // Simple JWT implementation (base64 header.payload.signature)
  const header = {
    alg: "HS256",
    typ: "JWT",
  };

  const headerB64 = Buffer.from(JSON.stringify(header)).toString("base64url");
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");

  // Create signature
  const hmac = crypto.createHmac("sha256", JWT_SECRET);
  hmac.update(`${headerB64}.${payloadB64}`);
  const signatureB64 = hmac.digest("base64url");

  return `${headerB64}.${payloadB64}.${signatureB64}`;
}

/**
 * Verify and decode a JWT token
 * Returns payload if valid, null if invalid or expired
 */
export function verifyClientJWT(token: string): ClientJWTPayload | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const [headerB64, payloadB64, signatureB64] = parts;

    // Verify signature
    const hmac = crypto.createHmac("sha256", JWT_SECRET);
    hmac.update(`${headerB64}.${payloadB64}`);
    const expectedSignature = hmac.digest("base64url");

    if (signatureB64 !== expectedSignature) return null;

    // Decode payload
    const payloadJson = Buffer.from(payloadB64, "base64url").toString("utf-8");
    const payload = JSON.parse(payloadJson) as ClientJWTPayload;

    // Check expiration
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp < now) return null;

    return payload;
  } catch {
    return null;
  }
}

/**
 * Extract JWT from Authorization header
 * Expects: "Bearer <token>"
 */
export function extractJWTFromHeader(authHeader: string | null): string | null {
  if (!authHeader) return null;
  if (!authHeader.startsWith("Bearer ")) return null;
  return authHeader.substring(7);
}

/**
 * Hash password with bcrypt-style (simple PBKDF2 for now, can upgrade to bcrypt later)
 */
export async function hashPassword(password: string): Promise<string> {
  // Simple PBKDF2 implementation
  // For production, use bcrypt package
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto
    .pbkdf2Sync(password, salt, 10000, 32, "sha256")
    .toString("hex");
  return `${salt}:${hash}`;
}

/**
 * Verify password against hash
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const [salt, storedHash] = hash.split(":");
  const testHash = crypto
    .pbkdf2Sync(password, salt, 10000, 32, "sha256")
    .toString("hex");
  return testHash === storedHash;
}
