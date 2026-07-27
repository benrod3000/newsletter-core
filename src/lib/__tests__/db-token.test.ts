import { describe, it, expect, beforeEach, afterEach } from "vitest";
import crypto from "crypto";

const SECRET = "test-supabase-jwt-secret";
const WS = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";

function decode(token: string) {
  const [header, payload, signature] = token.split(".");
  return {
    header: JSON.parse(Buffer.from(header, "base64url").toString()),
    payload: JSON.parse(Buffer.from(payload, "base64url").toString()),
    signature,
    signingInput: `${header}.${payload}`,
  };
}

beforeEach(() => {
  process.env.SUPABASE_JWT_SECRET = SECRET;
});

afterEach(() => {
  delete process.env.SUPABASE_JWT_SECRET;
});

describe("mintWorkspaceDbToken", () => {
  it("claims the authenticated role, which is the whole point", async () => {
    const { mintWorkspaceDbToken } = await import("../db-token");
    const { payload } = decode(mintWorkspaceDbToken(WS, USER));

    // PostgREST reads this claim to pick the Postgres role for the request.
    // `authenticated` has rolbypassrls = false; `service_role` does not. If this
    // ever said service_role, every policy in migration 049 would be bypassed and
    // nothing would visibly break - which is exactly why it is asserted.
    expect(payload.role).toBe("authenticated");
  });

  it("carries the workspace claim that every RLS policy keys on", async () => {
    const { mintWorkspaceDbToken } = await import("../db-token");
    const { payload } = decode(mintWorkspaceDbToken(WS, USER));

    expect(payload.workspace_id).toBe(WS);
    expect(payload.sub).toBe(USER);
  });

  it("is signed with the Supabase secret, not the session secret", async () => {
    process.env.JWT_SECRET = "a-completely-different-session-secret";
    const { mintWorkspaceDbToken } = await import("../db-token");
    const { signature, signingInput } = decode(mintWorkspaceDbToken(WS, USER));

    const expected = crypto
      .createHmac("sha256", SECRET)
      .update(signingInput)
      .digest("base64url");

    expect(signature).toBe(expected);
    delete process.env.JWT_SECRET;
  });

  it("expires quickly - it only has to survive one round trip", async () => {
    const { mintWorkspaceDbToken, DB_TOKEN_TTL_SECONDS } = await import("../db-token");
    const { payload } = decode(mintWorkspaceDbToken(WS, USER));

    expect(payload.exp - payload.iat).toBe(DB_TOKEN_TTL_SECONDS);
    expect(DB_TOKEN_TTL_SECONDS).toBeLessThanOrEqual(300);
  });

  it("throws rather than degrading when the secret is absent", async () => {
    delete process.env.SUPABASE_JWT_SECRET;
    const { mintWorkspaceDbToken } = await import("../db-token");

    // A missing secret must not silently fall back to an unsigned or
    // session-signed token: PostgREST would reject it and the request would fail
    // in a way that looks like a data problem rather than a config problem.
    expect(() => mintWorkspaceDbToken(WS, USER)).toThrow(/SUPABASE_JWT_SECRET/);
  });

  it("produces a distinct token per workspace for the same user", async () => {
    const { mintWorkspaceDbToken } = await import("../db-token");
    const other = "33333333-3333-4333-8333-333333333333";

    expect(decode(mintWorkspaceDbToken(WS, USER)).payload.workspace_id).toBe(WS);
    expect(decode(mintWorkspaceDbToken(other, USER)).payload.workspace_id).toBe(other);
  });
});
