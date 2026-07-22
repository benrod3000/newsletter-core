import { describe, it, expect, beforeAll } from "vitest";
import crypto from "crypto";

const SECRET = "test-jwt-secret";

beforeAll(() => {
  process.env.JWT_SECRET = SECRET;
});

/** Build a request carrying a bearer token, as a workspace route would receive it. */
function requestWithToken(token: string) {
  return {
    headers: { get: (n: string) => (n === "Authorization" ? `Bearer ${token}` : null) },
  } as unknown as Parameters<
    typeof import("../client-context").getClientContextFromJWT
  >[0];
}

describe("TOTP partial token cannot be used as a session", () => {
  it("is rejected by the workspace auth path", async () => {
    const { createClientJWT } = await import("../jwt");
    const { getClientContextFromJWT } = await import("../client-context");

    const partial = createClientJWT("ws-1", "user-1", "a@b.com", "owner", 300, "totp_pending");

    // This is the exact path every /api/clients/[workspaceId]/* route uses.
    expect(getClientContextFromJWT(requestWithToken(partial))).toBeNull();
  });

  it("is rejected by verifyClientJWT directly", async () => {
    const { createClientJWT, verifyClientJWT } = await import("../jwt");
    const partial = createClientJWT("ws-1", "user-1", "a@b.com", "owner", 300, "totp_pending");

    expect(verifyClientJWT(partial)).toBeNull();
  });

  it("is accepted by the TOTP verification path", async () => {
    const { createClientJWT, verifyPendingTOTPJWT } = await import("../jwt");
    const partial = createClientJWT("ws-1", "user-1", "a@b.com", "owner", 300, "totp_pending");

    const payload = verifyPendingTOTPJWT(partial);
    expect(payload).not.toBeNull();
    expect(payload!.userId).toBe("user-1");
  });
});

describe("session tokens", () => {
  it("are accepted by the workspace auth path", async () => {
    const { createClientJWT } = await import("../jwt");
    const { getClientContextFromJWT } = await import("../client-context");

    const session = createClientJWT("ws-1", "user-1", "a@b.com", "editor");
    const ctx = getClientContextFromJWT(requestWithToken(session));

    expect(ctx).not.toBeNull();
    expect(ctx!.workspaceId).toBe("ws-1");
    expect(ctx!.role).toBe("editor");
  });

  it("cannot be replayed at the TOTP verification step", async () => {
    const { createClientJWT, verifyPendingTOTPJWT } = await import("../jwt");
    const session = createClientJWT("ws-1", "user-1", "a@b.com", "owner");

    expect(verifyPendingTOTPJWT(session)).toBeNull();
  });
});

describe("rollout compatibility", () => {
  it("treats a pre-migration token with no aud claim as a full session", async () => {
    const b64 = (s: string) =>
      Buffer.from(s).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

    const headerB64 = b64(JSON.stringify({ alg: "HS256", typ: "JWT" }));
    const payloadB64 = b64(
      JSON.stringify({
        workspaceId: "ws-1",
        userId: "user-1",
        email: "a@b.com",
        role: "owner",
        iat: 0,
        exp: Math.floor(Date.now() / 1000) + 3600,
      })
    );
    const sig = crypto
      .createHmac("sha256", SECRET)
      .update(`${headerB64}.${payloadB64}`)
      .digest("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    const { verifyClientJWT } = await import("../jwt");

    // Existing 30-day sessions must survive the deploy.
    expect(verifyClientJWT(`${headerB64}.${payloadB64}.${sig}`)).not.toBeNull();
  });
});
