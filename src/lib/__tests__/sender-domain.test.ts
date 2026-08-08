import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { NextRequest } from "next/server";

/**
 * A provider key can be valid and sending still be impossible.
 *
 * Resend rejects any message whose From domain is not verified in the account
 * owning the key. Measured on this project: a valid full-access key,
 * sender_email set to ben@brod3000.com, and zero verified domains - so every
 * send would have been rejected at the provider, while this endpoint reported
 * a green "Verified against this workspace's own Resend key".
 *
 * That is the third layer of the same false-green. The key alone was not
 * enough (a missing sender email still blocked sending), and the sender email
 * alone is not enough either.
 */

const chain = {
  select: vi.fn(),
  eq: vi.fn(),
  maybeSingle: vi.fn(),
};

vi.mock("@/lib/supabase", () => ({ getSupabaseClient: () => ({ from: () => chain }) }));
vi.mock("@/lib/db-token", () => ({ getWorkspaceScopedClient: () => ({ from: () => chain }) }));

const sessionMock = vi.fn();
vi.mock("@/lib/client-context", () => ({ getClientContextFromJWT: () => sessionMock() }));

const WS = "11111111-1111-4111-8111-111111111111";
const USER = "55555555-5555-4555-8555-555555555555";
const params = { params: Promise.resolve({ workspaceId: WS }) };

const request = () =>
  ({ url: `https://x/api/clients/${WS}/provider-status`, headers: new Headers() }) as unknown as NextRequest;

/** Workspace row as provider-status selects it. */
function workspace(overrides: Record<string, unknown> = {}) {
  return {
    email_provider: "resend",
    sender_email: "ben@brod3000.com",
    resend_api_key: "re_live_test",
    sendgrid_api_key: null,
    ses_access_key: null,
    ses_secret_key: null,
    ses_region: null,
    ses_from_email: null,
    ...overrides,
  };
}

/** Domains the fake Resend account holds. */
let domains: Array<{ name: string; status: string }> = [];
let domainsStatus = 200;
const originalFetch = globalThis.fetch;

beforeEach(() => {
  vi.clearAllMocks();
  domains = [];
  domainsStatus = 200;

  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  chain.maybeSingle
    .mockResolvedValueOnce({ data: { id: USER, email: "a@b.com", role: "owner", is_active: true }, error: null })
    .mockResolvedValue({ data: workspace(), error: null });

  sessionMock.mockReturnValue({ workspaceId: WS, userId: USER, email: "a@b.com", role: "owner" });

  globalThis.fetch = (async (url: string) => {
    if (String(url).includes("/domains")) {
      return new Response(JSON.stringify({ data: domains }), { status: domainsStatus });
    }
    // The key-validity probe.
    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  }) as unknown as typeof fetch;
});

const get = async () => {
  const { GET } = await import("../../../app/api/clients/[workspaceId]/provider-status/route");
  return (await GET(request(), params)).json();
};

describe("provider-status checks the sender domain, not just the key", () => {
  it("reports not-configured when the sending domain is not in the account", async () => {
    // The exact production state: valid key, sender set, no domains.
    domains = [];

    const body = await get();

    expect(body.configured).toBe(false);
    expect(body.sender_verified).toBe(false);
    expect(body.missing_fields).toContain("Verified sending domain");
    expect(body.details).toContain("brod3000.com");
  });

  it("says what to do about it, rather than only that it is wrong", async () => {
    domains = [];
    const body = await get();
    expect(body.details.toLowerCase()).toContain("dns");
  });

  it("reports pending while a domain is added but unverified", async () => {
    domains = [{ name: "brod3000.com", status: "pending" }];

    const body = await get();

    expect(body.configured).toBe(false);
    expect(body.details).toContain("not verified yet");
  });

  it("stays configured once the domain is verified", async () => {
    domains = [{ name: "brod3000.com", status: "verified" }];

    const body = await get();

    expect(body.configured).toBe(true);
    expect(body.missing_fields).not.toContain("Verified sending domain");
  });

  it("matches the domain case-insensitively", async () => {
    domains = [{ name: "BROD3000.COM", status: "verified" }];
    expect((await get()).configured).toBe(true);
  });

  it("does not invent a problem when the key cannot list domains", async () => {
    // A send-only key answers 401 here and is a perfectly good sending key.
    domainsStatus = 401;

    const body = await get();

    expect(body.missing_fields).not.toContain("Verified sending domain");
  });
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});
