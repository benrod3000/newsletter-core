import { NextRequest } from "next/server";
import { verifyClientJWT, extractJWTFromHeader, ClientJWTPayload } from "./jwt";

export interface ClientContext extends ClientJWTPayload {}

/**
 * Extract and verify client JWT from Authorization header
 * Returns the decoded JWT payload if valid, null otherwise
 */
export function getClientContextFromJWT(req: NextRequest): ClientContext | null {
  const authHeader = req.headers.get("Authorization");
  const token = extractJWTFromHeader(authHeader);

  if (!token) return null;

  const payload = verifyClientJWT(token);
  return payload || null;
}

/**
 * Verify the client has access to a specific workspace
 */
export function assertWorkspaceAccess(
  context: ClientContext | null,
  workspaceId: string
): boolean {
  if (!context) return false;
  return context.workspaceId === workspaceId;
}

/**
 * Check if client can edit (owner or editor role)
 */
export function canEditAsClient(context: ClientContext): boolean {
  return context.role === "owner" || context.role === "editor";
}

/**
 * Check if client can delete/admin (owner role only)
 */
export function isClientOwner(context: ClientContext): boolean {
  return context.role === "owner";
}
