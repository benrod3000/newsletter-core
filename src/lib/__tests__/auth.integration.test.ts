import { describe, it, expect } from "vitest";

/**
 * Integration tests for auth flow.
 * These hit the actual API routes against a running server.
 * Requires NEXT_PUBLIC_APP_URL env to be set to a running instance.
 */

const BASE = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

describe("POST /api/auth/token (login)", () => {
  it("returns 400 for missing body", async () => {
    const res = await fetch(`${BASE}/api/auth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it("returns 401 for invalid credentials", async () => {
    const res = await fetch(`${BASE}/api/auth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "nonexistent@example.com",
        password: "wrongpassword",
      }),
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("INVALID_CREDENTIALS");
  });
});

describe("POST /api/auth/signup", () => {
  it("returns 400 for missing body", async () => {
    const res = await fetch(`${BASE}/api/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });
});
