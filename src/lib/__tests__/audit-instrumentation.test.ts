import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

/**
 * That sensitive actions actually write an audit row.
 *
 * `audit_logs` and `logAudit()` both existed before this work, with a full
 * AUDIT_ACTIONS vocabulary including SUBSCRIBER_EXPORTED, SUBSCRIBER_IMPORTED
 * and CAMPAIGN_SENT. Only four auth routes ever called it, so production held 17
 * rows and every one of them was `action='login'` - the constants for everything
 * else were defined and unused.
 *
 * Nothing about that was visible from reading the helper, which is why these
 * assert on the insert reaching the table rather than on logAudit being callable.
 */

const inserted: Array<Record<string, unknown>> = [];

const chain = {
  select: vi.fn(),
  eq: vi.fn(),
  gt: vi.fn(),
  in: vi.fn(),
  order: vi.fn(),
  limit: vi.fn(),
  delete: vi.fn(),
  update: vi.fn(),
  single: vi.fn(),
  maybeSingle: vi.fn(),
  insert: vi.fn(),
};

vi.mock("@/lib/supabase", () => ({
  getSupabaseClient: () => ({
    from: (table: string) => {
      if (table === "audit_logs") {
        return {
          insert: (row: Record<string, unknown>) => {
            inserted.push(row);
            return Promise.resolve({ data: null, error: null });
          },
        };
      }
      return chain;
    },
  }),
}));

vi.mock("@/lib/db-token", () => ({
  getWorkspaceScopedClient: () => ({ from: () => chain }),
}));

const sessionMock = vi.fn();
vi.mock("@/lib/client-context", () => ({
  getClientContextFromJWT: () => sessionMock(),
}));

const WS = "11111111-1111-4111-8111-111111111111";
const USER = "55555555-5555-4555-8555-555555555555";
const SUB_A = "22222222-2222-4222-8222-222222222222";

const params = { params: Promise.resolve({ workspaceId: WS }) };

function request(body?: unknown) {
  return {
    url: `https://x/api/clients/${WS}/subscribers`,
    headers: new Headers({ "user-agent": "vitest", "x-forwarded-for": "203.0.113.9" }),
    json: async () => body,
  } as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  inserted.length = 0;

  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  chain.gt.mockReturnValue(chain);
  chain.in.mockReturnValue(chain);
  chain.order.mockReturnValue(chain);
  chain.delete.mockReturnValue(chain);
  chain.update.mockReturnValue(chain);
  chain.limit.mockResolvedValue({ data: [], error: null });
  chain.single.mockResolvedValue({ data: { id: WS }, error: null });
  chain.maybeSingle.mockResolvedValue({
    data: { id: USER, email: "a@b.com", role: "owner", is_active: true },
    error: null,
  });

  sessionMock.mockReturnValue({ workspaceId: WS, userId: USER, email: "a@b.com", role: "owner" });
});

describe("audit instrumentation", () => {
  it("records a bulk subscriber delete, with the ids that were removed", async () => {
    chain.select.mockReturnValueOnce(chain).mockResolvedValueOnce({
      data: [{ id: SUB_A }],
      error: null,
    });

    const { DELETE } = await import("../../../app/api/clients/[workspaceId]/subscribers/route");
    await DELETE(request({ ids: [SUB_A] }), params);

    const entry = inserted.find((r) => r.action === "subscriber_deleted");
    expect(entry).toBeDefined();
    expect(entry?.workspace_id).toBe(WS);
    expect(entry?.user_id).toBe(USER);
    // A count alone cannot tell an owner which contacts went, and they are gone.
    expect((entry?.details as { ids: string[] }).ids).toEqual([SUB_A]);
  });

  it("captures the request IP and user agent rather than leaving them null", async () => {
    chain.select.mockReturnValueOnce(chain).mockResolvedValueOnce({ data: [], error: null });

    const { DELETE } = await import("../../../app/api/clients/[workspaceId]/subscribers/route");
    await DELETE(request({ ids: [SUB_A] }), params);

    const entry = inserted.find((r) => r.action === "subscriber_deleted");
    expect(entry?.ip_address).toBe("203.0.113.9");
    expect(entry?.user_agent).toBe("vitest");
  });

  it("does not fail the audited operation when request metadata is unreadable", async () => {
    chain.select.mockReturnValueOnce(chain).mockResolvedValueOnce({
      data: [{ id: SUB_A }],
      error: null,
    });

    // No headers at all. This threw a TypeError out of extractRequestMeta and
    // turned an already-committed bulk delete into a 500: the rows were gone
    // and the caller was told it failed. Audit logging observes the operation;
    // it does not get to be the reason the operation fails.
    const headerless = {
      url: `https://x/api/clients/${WS}/subscribers`,
      json: async () => ({ ids: [SUB_A] }),
    } as unknown as NextRequest;

    const { DELETE } = await import("../../../app/api/clients/[workspaceId]/subscribers/route");
    const res = await DELETE(headerless, params);

    expect(res.status).toBe(200);
    const entry = inserted.find((r) => r.action === "subscriber_deleted");
    expect(entry?.ip_address).toBe("unknown");
  });

  it("distinguishes a credential change from an ordinary settings change", async () => {
    const { PUT } = await import("../../../app/api/clients/[workspaceId]/branding/route");

    await PUT(request({ resend_api_key: "re_live_abc" }), params);
    expect(inserted.at(-1)?.action).toBe("credentials_changed");

    inserted.length = 0;
    await PUT(request({ sender_name: "Veloce" }), params);
    expect(inserted.at(-1)?.action).toBe("settings_changed");
  });

  it("records which credential fields changed but never their values", async () => {
    const { PUT } = await import("../../../app/api/clients/[workspaceId]/branding/route");

    await PUT(request({ resend_api_key: "re_live_SECRET_VALUE" }), params);

    const entry = inserted.at(-1);
    expect((entry?.details as { credentials: string[] }).credentials).toEqual(["resend_api_key"]);
    // An audit log that quotes the secret has just copied it somewhere with
    // weaker access control than the column it came from.
    expect(JSON.stringify(entry)).not.toContain("re_live_SECRET_VALUE");
  });

  it("records clearing a credential, which is as sensitive as setting one", async () => {
    const { PUT } = await import("../../../app/api/clients/[workspaceId]/branding/route");

    await PUT(request({ resend_api_key: null }), params);

    const entry = inserted.at(-1);
    expect(entry?.action).toBe("credentials_changed");
    expect((entry?.details as { cleared: string[] }).cleared).toEqual(["resend_api_key"]);
  });
});
