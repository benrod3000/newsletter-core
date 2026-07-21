import { describe, it, expect, beforeEach } from "vitest";

describe("admin header signature verification", () => {
  beforeEach(() => {
    process.env.ADMIN_HMAC_SECRET = "test-secret";
  });

  it("rejects tampered role when signature was for a different role", async () => {
    const { signAdminHeaders, getAdminContextFromHeaders } =
      await import("../admin-context");

    const sig = signAdminHeaders("alice:viewer:");
    const headers = new Headers({
      "x-admin-username": "alice",
      "x-admin-role": "owner",
      "x-admin-signature": sig,
    });

    expect(getAdminContextFromHeaders(headers)).toBeNull();
  });

  it("accepts legitimate admin context with matching signature", async () => {
    const { signAdminHeaders, getAdminContextFromHeaders } =
      await import("../admin-context");

    const sig = signAdminHeaders("alice:owner:");
    const headers = new Headers({
      "x-admin-username": "alice",
      "x-admin-role": "owner",
      "x-admin-signature": sig,
    });

    const ctx = getAdminContextFromHeaders(headers);
    expect(ctx).not.toBeNull();
    expect(ctx!.username).toBe("alice");
    expect(ctx!.role).toBe("owner");
  });

  it("returns a hex signature when HMAC secret is configured", async () => {
    const { signAdminHeaders } = await import("../admin-context");
    const sig = signAdminHeaders("alice:owner:");
    expect(sig).toMatch(/^[a-f0-9]{64}$/); // SHA-256 produces 64 hex chars
  });
});
