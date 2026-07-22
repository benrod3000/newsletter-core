import crypto from "crypto";
import { z } from "zod";

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET environment variable is required");
  return secret;
}

function toBase64Url(str: string): string {
  return Buffer.from(str).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(b64: string): string {
  const base64 = b64.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(base64, "base64").toString("utf-8");
}

function hmacDigestBase64Url(data: string): string {
  const hmac = crypto.createHmac("sha256", getJwtSecret());
  hmac.update(data);
  return hmac.digest("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Runtime shape of a decoded JWT payload.
 *
 * A verified signature only proves *we* minted the token — it says nothing about
 * the payload's shape. Validating here keeps `ClientContext` an enforced
 * guarantee rather than an unchecked `as` cast, so every downstream
 * authorization check can rely on `role` and `workspaceId` being present.
 *
 * Identifiers are validated as non-empty strings rather than UUIDs on purpose:
 * tightening the format would invalidate live sessions for any workspace whose
 * id isn't a UUID. Shape is the security property here; format is not.
 */
const clientJWTPayloadSchema = z.object({
  workspaceId: z.string().min(1),
  userId: z.string().min(1),
  email: z.string().min(1),
  role: z.enum(["owner", "editor", "viewer"]),
  iat: z.number().int(),
  exp: z.number().int(),
});

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

  const headerB64 = toBase64Url(JSON.stringify(header));
  const payloadB64 = toBase64Url(JSON.stringify(payload));

  const signatureB64 = hmacDigestBase64Url(`${headerB64}.${payloadB64}`);

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
    const expectedSignature = hmacDigestBase64Url(`${headerB64}.${payloadB64}`);
    const sigBuf = Buffer.from(signatureB64);
    const expBuf = Buffer.from(expectedSignature);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null;

    // Decode and validate payload shape — a valid signature is not a valid payload
    const parsed = clientJWTPayloadSchema.safeParse(JSON.parse(fromBase64Url(payloadB64)));
    if (!parsed.success) return null;
    const payload = parsed.data;

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
 * Hash password with PBKDF2 (600,000 iterations, 32-byte key, SHA-256)
 * Salt is stored as hex:hash, prefixed with iteration count for auto-upgrade
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto
    .pbkdf2Sync(password, salt, 600_000, 32, "sha256")
    .toString("hex");
  return `600000:${salt}:${hash}`;
}

/**
 * Verify password against stored hash
 * Supports legacy 10000-iteration hashes and auto-upgrades
 */
export async function verifyPassword(password: string, hash: string): Promise<{ valid: boolean; rehash?: string }> {
  const parts = hash.split(":");
  let iterations: number;
  let salt: string;
  let storedHash: string;

  if (parts.length === 2) {
    // Legacy format: salt:hash (10000 iterations)
    iterations = 10_000;
    [salt, storedHash] = parts;
  } else if (parts.length === 3) {
    // Current format: iterations:salt:hash
    iterations = parseInt(parts[0], 10);
    salt = parts[1];
    storedHash = parts[2];
  } else {
    return { valid: false };
  }

  const testBuf = crypto
    .pbkdf2Sync(password, salt, iterations, 32, "sha256");

  const expectedBuf = Buffer.from(storedHash, "hex");
  if (testBuf.length !== expectedBuf.length) return { valid: false };

  const valid = crypto.timingSafeEqual(testBuf, expectedBuf);

  if (valid && iterations < 600_000) {
    // Auto-upgrade: rehash with current iteration count
    const newSalt = crypto.randomBytes(16).toString("hex");
    const newHash = crypto
      .pbkdf2Sync(password, newSalt, 600_000, 32, "sha256")
      .toString("hex");
    return { valid: true, rehash: `600000:${newSalt}:${newHash}` };
  }

  return { valid };
}
