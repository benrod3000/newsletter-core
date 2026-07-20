/**
 * Standardized API response helpers.
 *
 * Every route should use apiSuccess() for data and apiError() for errors.
 * No raw { error: "string" } or inconsistent response shapes.
 *
 * Response shape:
 *   Success: { data: ... }
 *   Error:   { error: { code: string, message: string, details?: any } }
 *
 * All responses include CORS headers automatically.
 */

import { NextResponse } from "next/server";

const DEFAULT_CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
};

/** Standard success response */
export function apiSuccess<T = unknown>(data: T, status = 200, extraHeaders?: Record<string, string>) {
  return NextResponse.json({ data }, { status, headers: { ...DEFAULT_CORS, ...extraHeaders } });
}

/** Standard error response */
export function apiError(
  status: number,
  code: string,
  message: string,
  details?: Record<string, unknown>,
  extraHeaders?: Record<string, string>
) {
  const body: Record<string, unknown> = {
    error: { code, message },
  };
  if (details) (body.error as Record<string, unknown>).details = details;
  return NextResponse.json(body, { status, headers: { ...DEFAULT_CORS, ...extraHeaders } });
}

/** 401 Unauthorized — standard response used by all auth-protected routes */
export function apiUnauthorized() {
  return apiError(401, "UNAUTHORIZED", "Authentication required");
}

/** 403 Forbidden — insufficient permissions */
export function apiForbidden(message = "Insufficient permissions") {
  return apiError(403, "FORBIDDEN", message);
}

/** 404 Not Found */
export function apiNotFound(resource = "Resource") {
  return apiError(404, "NOT_FOUND", `${resource} not found`);
}

/** 500 Internal Server Error */
export function apiInternalError(message = "Internal server error") {
  return apiError(500, "INTERNAL_ERROR", message);
}
