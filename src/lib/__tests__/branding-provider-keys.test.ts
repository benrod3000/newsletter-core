import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

/**
 * Route-handler test for the branding endpoint's secret fields.
 *
 * These three cases are the whole contract, and each one has already been a bug:
 *
 *   "value" -> write it   (per-workspace keys were dropped entirely until 055)
 *   ""      -> unchanged  (otherwise opening Settings and pressing Save wipes
 *                          live sending credentials, because the form
 *                          initialises every secret input to "")
 *   null    -> clear it   (added with 055; without it a saved key could never be
 *                          removed or rotated back to the platform fallback)
 *
 * Following subscribers-bulk-delete.test.ts: the real withWorkspace wrapper runs,
 * only the membership lookup and the client factory underneath it are mocked.
 */

/** Chain for both the membership lookup and the clients read/write. */
const chain = {
  select: vi.fn(),
  update: vi.fn(),
  eq: vi.fn(),
  single: vi.fn(),
  maybeSingle: vi.fn(),
};

vi.mock("@/lib/supabase", () => ({
  getSupabaseClient: () => ({ from: () => chain }),
}));

// withWorkspace mints a scoped client for every request regardless of whether the
// handler uses one. This route deliberately does not - it reads credential
// columns that migration 049 withholds from `authenticated` - but the wrapper
// still constructs it, and the real factory throws without SUPABASE_ANON_KEY.
vi.mock("@/lib/db-token", () => ({
  getWorkspaceScopedClient: () => ({ from: () => chain }),
}));

const sessionMock = vi.fn();

vi.mock("@/lib/client-context", () => ({
  getClientContextFromJWT: () => sessionMock(),
}));

const WS = "11111111-1111-4111-8111-111111111111";
const USER = "55555555-5555-4555-8555-555555555555";

function request(body: unknown) {
  return { json: async () => body } as unknown as NextRequest;
}

const params = { params: Promise.resolve({ workspaceId: WS }) };

beforeEach(() => {
  vi.clearAllMocks();
  chain.select.mockReturnValue(chain);
  chain.update.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  chain.single.mockResolvedValue({ data: { id: WS }, error: null });
  chain.maybeSingle.mockResolvedValue({
    data: { id: USER, email: "a@b.com", role: "owner", is_active: true },
    error: null,
  });
  sessionMock.mockReturnValue({ workspaceId: WS, userId: USER, email: "a@b.com", role: "owner" });
});

const importRoute = async () =>
  await import("../../../app/api/clients/[workspaceId]/branding/route");

/** The object handed to .update(), i.e. what would actually hit the database. */
function updatePayload(): Record<string, unknown> {
  return chain.update.mock.calls.at(-1)?.[0] ?? {};
}

describe("PUT /api/clients/[workspaceId]/branding - provider key persistence", () => {
  it("persists a supplied Resend key", async () => {
    const { PUT } = await importRoute();

    await PUT(request({ resend_api_key: "re_live_abc123" }), params);

    expect(updatePayload().resend_api_key).toBe("re_live_abc123");
  });

  it("persists a supplied SendGrid key", async () => {
    const { PUT } = await importRoute();

    await PUT(request({ sendgrid_api_key: "SG.abc123" }), params);

    expect(updatePayload().sendgrid_api_key).toBe("SG.abc123");
  });

  it("trims surrounding whitespace, which pasting a key reliably introduces", async () => {
    const { PUT } = await importRoute();

    await PUT(request({ resend_api_key: "  re_live_abc123\n" }), params);

    expect(updatePayload().resend_api_key).toBe("re_live_abc123");
  });

  it("leaves a stored key untouched when the field is empty", async () => {
    const { PUT } = await importRoute();

    // Exactly what the Settings form PUTs when the user edits only the sender
    // name: every secret input is present and empty.
    await PUT(
      request({ sender_name: "Veloce", resend_api_key: "", sendgrid_api_key: "" }),
      params
    );

    const payload = updatePayload();
    expect(payload).not.toHaveProperty("resend_api_key");
    expect(payload).not.toHaveProperty("sendgrid_api_key");
    expect(payload.sender_name).toBe("Veloce");
  });

  it("treats a whitespace-only field as empty rather than as a key", async () => {
    const { PUT } = await importRoute();

    await PUT(request({ sender_name: "Veloce", resend_api_key: "   " }), params);

    expect(updatePayload()).not.toHaveProperty("resend_api_key");
  });

  it("clears a stored key on an explicit null", async () => {
    const { PUT } = await importRoute();

    await PUT(request({ resend_api_key: null }), params);

    const payload = updatePayload();
    expect(payload).toHaveProperty("resend_api_key");
    expect(payload.resend_api_key).toBeNull();
  });

  it("never returns a stored key, only whether one is set", async () => {
    chain.maybeSingle
      .mockResolvedValueOnce({
        data: { id: USER, email: "a@b.com", role: "owner", is_active: true },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          id: WS,
          sender_name: "Veloce",
          resend_api_key: "re_live_secret",
          sendgrid_api_key: null,
        },
        error: null,
      });

    const { GET } = await importRoute();
    const body = await (await GET(request({}), params)).json();

    expect(body.data.has_resend_api_key).toBe(true);
    expect(body.data.has_sendgrid_api_key).toBe(false);
    expect(body.data).not.toHaveProperty("resend_api_key");
    expect(JSON.stringify(body)).not.toContain("re_live_secret");
  });
});
