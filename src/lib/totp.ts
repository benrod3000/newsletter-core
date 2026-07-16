import * as otplib from "otplib";
import crypto from "crypto";

const TOTP_ISSUER = "Veloce";

/**
 * Generate a new TOTP secret for a user
 */
export function generateTOTPSecret(): string {
  return otplib.generateSecret();
}

/**
 * Generate the otpauth:// URI for QR code rendering
 */
export function getTOTPUri(secret: string, email: string): string {
  return otplib.generateURI({ issuer: TOTP_ISSUER, label: email, secret });
}

/**
 * Verify a TOTP code against a secret
 */
export function verifyTOTP(code: string, secret: string): boolean {
  try {
    const result = otplib.verifySync({ token: code, secret });
    return result.valid === true;
  } catch {
    return false;
  }
}

/**
 * Generate recovery codes (8 codes, 10 chars each)
 */
export function generateRecoveryCodes(): string[] {
  const codes: string[] = [];
  for (let i = 0; i < 8; i++) {
    codes.push(crypto.randomBytes(5).toString("hex").toUpperCase());
  }
  return codes;
}
