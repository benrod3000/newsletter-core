import { describe, it, expect, beforeAll } from "vitest";
import crypto from "crypto";

const SECRET = "test-jwt-secret";

beforeAll(() => {
  process.env.JWT_SECRET = SECRET;
});

/** Mint a token with an arbitrary payload, correctly signed. */
function signArbitraryPayload(payload: unknown): string {
  const b64 = (s: string) =>
    Buffer.from(s).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  const headerB64 = b64(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payloadB64 = b64(JSON.stringify(payload));
  const sig = crypto
    .createHmac("sha256", SECRET)
    .update(`${headerB64}.${payloadB64}`)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  return `${headerB64}.${payloadB64}.${sig}`;
}

const future = () => Math.floor(Date.now() / 1000) + 3600;

describe("verifyClientJWT payload validation", () => {
  it("accepts a well-formed payload", async () => {
    const { createClientJWT, verifyClientJWT } = await import("../jwt");
    const token = createClientJWT("ws-1", "user-1", "a@b.com", "owner");

    const payload = verifyClientJWT(token);
    expect(payload).not.toBeNull();
    expect(payload!.workspaceId).toBe("ws-1");
    expect(payload!.role).toBe("owner");
  });

  it("rejects a correctly-signed token that is missing role", async () => {
    const { verifyClientJWT } = await import("../jwt");
    const token = signArbitraryPayload({
      workspaceId: "ws-1",
      userId: "user-1",
      email: "a@b.com",
      iat: 0,
      exp: future(),
    });

    // Signature is valid - only the shape check can catch this.
    expect(verifyClientJWT(token)).toBeNull();
  });

  it("rejects a correctly-signed token with an unknown role", async () => {
    const { verifyClientJWT } = await import("../jwt");
    const token = signArbitraryPayload({
      workspaceId: "ws-1",
      userId: "user-1",
      email: "a@b.com",
      role: "superadmin",
      iat: 0,
      exp: future(),
    });

    expect(verifyClientJWT(token)).toBeNull();
  });

  it("rejects a payload whose workspaceId is not a string", async () => {
    const { verifyClientJWT } = await import("../jwt");
    const token = signArbitraryPayload({
      workspaceId: null,
      userId: "user-1",
      email: "a@b.com",
      role: "owner",
      iat: 0,
      exp: future(),
    });

    // Guards against `undefined`/`null` reaching a database filter as a string.
    expect(verifyClientJWT(token)).toBeNull();
  });

  it("rejects a tampered signature", async () => {
    const { createClientJWT, verifyClientJWT } = await import("../jwt");
    const token = createClientJWT("ws-1", "user-1", "a@b.com", "owner");
    const [h, p] = token.split(".");

    expect(verifyClientJWT(`${h}.${p}.wrongsignature`)).toBeNull();
  });

  it("rejects an expired token", async () => {
    const { verifyClientJWT } = await import("../jwt");
    const token = signArbitraryPayload({
      workspaceId: "ws-1",
      userId: "user-1",
      email: "a@b.com",
      role: "owner",
      iat: 0,
      exp: Math.floor(Date.now() / 1000) - 10,
    });

    expect(verifyClientJWT(token)).toBeNull();
  });

  it("rejects a malformed token", async () => {
    const { verifyClientJWT } = await import("../jwt");
    expect(verifyClientJWT("not.a.token")).toBeNull();
    expect(verifyClientJWT("only-one-part")).toBeNull();
  });
});
