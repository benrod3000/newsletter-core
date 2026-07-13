import { NextResponse } from "next/server";

/**
 * Standardized API error response.
 *
 * Usage:
 *   return apiError(400, "VALIDATION_ERROR", "Email is required", { field: "email" })
 *   return apiError(401, "UNAUTHORIZED", "Invalid credentials")
 *   return apiError(500, "INTERNAL_ERROR", "Something went wrong")
 */
export function apiError(
  status: number,
  code: string,
  message: string,
  details?: Record<string, unknown>
) {
  const body: Record<string, unknown> = {
    error: {
      code,
      message,
    },
  };

  if (details) {
    (body.error as Record<string, unknown>).details = details;
  }

  const headers: Record<string, string> = {
    "Access-Control-Allow-Origin": "*",
  };

  return NextResponse.json(body, { status, headers });
}
