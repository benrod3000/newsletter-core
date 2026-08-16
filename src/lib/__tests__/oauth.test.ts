import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getGoogleTokens, getGitHubTokens, verifyOAuthState } from "../oauth";

/**
 * OAuth sign-in.
 *
 * This file had no tests, and hid a total outage in plain sight: the tenancy
 * rename replaced `client_id` with `workspace_id` across the codebase and swept up
 * the OAuth *protocol* parameter along with the database column. The token exchange
 * has been missing a required parameter, and both providers have been unusable,
 * since commit 9510450.
 *
 * Nothing could have caught it. The name is a string in a request body, so tsc is
 * happy; the failure is a rejection from Google, at runtime, in a route nobody
 * exercises in CI.
 */

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  process.env.GOOGLE_CLIENT_ID = "google-id";
  process.env.GOOGLE_CLIENT_SECRET = "google-secret";
  process.env.GITHUB_CLIENT_ID = "github-id";
  process.env.GITHUB_CLIENT_SECRET = "github-secret";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown) {
  return Promise.resolve({ json: () => Promise.resolve(body) });
}

describe("token exchange parameters", () => {
  it("sends client_id to Google, the name the spec requires", async () => {
    fetchMock
      .mockReturnValueOnce(jsonResponse({ access_token: "tok" }))
      .mockReturnValueOnce(jsonResponse({ email: "a@b.com", verified_email: true, name: "A", id: "1" }));

    await getGoogleTokens("code-123");

    const body = fetchMock.mock.calls[0][1].body as URLSearchParams;
    expect(body.get("client_id")).toBe("google-id");
    // The rename that broke it. Present under this name, the parameter is ignored
    // and the exchange is rejected for a missing client_id.
    expect(body.get("workspace_id")).toBeNull();
  });

  it("sends client_id to GitHub", async () => {
    fetchMock
      .mockReturnValueOnce(jsonResponse({ access_token: "tok" }))
      .mockReturnValueOnce(jsonResponse({ name: "A", login: "a" }))
      .mockReturnValueOnce(jsonResponse([{ primary: true, verified: true, email: "a@b.com" }]));

    await getGitHubTokens("code-123");

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.client_id).toBe("github-id");
    expect(body.workspace_id).toBeUndefined();
  });

  it("has no stray workspace_id left anywhere in the OAuth module", () => {
    // The rename hit two call sites. This catches a third if one is ever added, and
    // documents that `workspace_id` is simply not an OAuth parameter.
    const source = readFileSync(join(process.cwd(), "src/lib/oauth.ts"), "utf8");
    expect(source).not.toMatch(/workspace_id:\s*process\.env\./);
  });
});

describe("email verification", () => {
  it("refuses a Google account whose email is unverified", async () => {
    // findOrCreateOAuthUser matches an existing account by email alone, so an
    // unverified address is enough to take one over.
    fetchMock
      .mockReturnValueOnce(jsonResponse({ access_token: "tok" }))
      .mockReturnValueOnce(jsonResponse({ email: "victim@example.com", verified_email: false, name: "X", id: "2" }));

    await expect(getGoogleTokens("code")).rejects.toThrow(/verified/i);
  });

  it("refuses a GitHub primary email that is not verified", async () => {
    fetchMock
      .mockReturnValueOnce(jsonResponse({ access_token: "tok" }))
      .mockReturnValueOnce(jsonResponse({ name: "X", login: "x" }))
      .mockReturnValueOnce(jsonResponse([{ primary: true, verified: false, email: "victim@example.com" }]));

    await expect(getGitHubTokens("code")).rejects.toThrow(/verified/i);
  });

  it("does not fall back to the unverified profile email on GitHub", async () => {
    // The old code used `user.email` when no primary was found. That address is
    // whatever the user typed into their public profile.
    fetchMock
      .mockReturnValueOnce(jsonResponse({ access_token: "tok" }))
      .mockReturnValueOnce(jsonResponse({ name: "X", login: "x", email: "public@example.com" }))
      .mockReturnValueOnce(jsonResponse([{ primary: false, verified: true, email: "other@example.com" }]));

    await expect(getGitHubTokens("code")).rejects.toThrow(/verified/i);
  });

  it("accepts a verified primary email", async () => {
    fetchMock
      .mockReturnValueOnce(jsonResponse({ access_token: "tok" }))
      .mockReturnValueOnce(jsonResponse({ name: "X", login: "x" }))
      .mockReturnValueOnce(
        jsonResponse([
          { primary: false, verified: true, email: "alt@example.com" },
          { primary: true, verified: true, email: "main@example.com" },
        ])
      );

    const result = await getGitHubTokens("code");
    expect(result.email).toBe("main@example.com");
  });
});

describe("verifyOAuthState", () => {
  it("rejects a missing state or cookie", () => {
    expect(verifyOAuthState(null, "abc")).toBe(false);
    expect(verifyOAuthState("abc", null)).toBe(false);
  });

  it("rejects a mismatch, and accepts an exact match", () => {
    expect(verifyOAuthState("abc", "abd")).toBe(false);
    expect(verifyOAuthState("abc", "abc")).toBe(true);
  });

  it("does not throw on differing lengths", () => {
    // timingSafeEqual throws on unequal buffers; the length guard is what stops a
    // CSRF check turning into a 500.
    expect(() => verifyOAuthState("short", "muchlongervalue")).not.toThrow();
    expect(verifyOAuthState("short", "muchlongervalue")).toBe(false);
  });
});
