import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * First route-handler test. The pattern here — mock the auth context and the
 * Supabase client, then drive the exported handler directly — is what the rest
 * of the API surface should follow.
 */

const deleteChain = {
  delete: vi.fn(),
  in: vi.fn(),
  eq: vi.fn(),
  select: vi.fn(),
};

const fromMock = vi.fn(() => deleteChain);

vi.mock("@/lib/supabase", () => ({
  getSupabaseClient: () => ({ from: fromMock }),
}));

const contextMock = vi.fn();

vi.mock("@/lib/client-context", () => ({
  getClientContextFromJWT: () => contextMock(),
  assertWorkspaceAccess: (ctx: unknown, ws: string) =>
    !!ctx && (ctx as { workspaceId: string }).workspaceId === ws,
  canEditAsClient: (ctx: unknown) => (ctx as { role: string }).role !== "viewer",
}));

const WS = "11111111-1111-4111-8111-111111111111";
const ID_A = "22222222-2222-4222-8222-222222222222";
const ID_B = "33333333-3333-4333-8333-333333333333";

function request(body: unknown) {
  return { json: async () => body } as unknown as Parameters<
    typeof import("../../../app/api/clients/[workspaceId]/subscribers/route").DELETE
  >[0];
}

const params = { params: Promise.resolve({ workspaceId: WS }) };

beforeEach(() => {
  vi.clearAllMocks();
  // Chain: .delete().in().eq().select()
  deleteChain.delete.mockReturnValue(deleteChain);
  deleteChain.in.mockReturnValue(deleteChain);
  deleteChain.eq.mockReturnValue(deleteChain);
  deleteChain.select.mockResolvedValue({ data: [{ id: ID_A }], error: null });
  contextMock.mockReturnValue({ workspaceId: WS, role: "owner" });
});

describe("DELETE /api/clients/[workspaceId]/subscribers", () => {
  it("reports the count the database actually deleted, not the count requested", async () => {
    const { DELETE } = await import(
      "../../../app/api/clients/[workspaceId]/subscribers/route"
    );

    // Two ids requested; only one belongs to this workspace.
    const res = await DELETE(request({ ids: [ID_A, ID_B] }), params);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.deleted).toBe(1);
  });

  it("scopes the delete to the caller's workspace", async () => {
    const { DELETE } = await import(
      "../../../app/api/clients/[workspaceId]/subscribers/route"
    );

    await DELETE(request({ ids: [ID_A] }), params);

    expect(deleteChain.in).toHaveBeenCalledWith("id", [ID_A]);
    expect(deleteChain.eq).toHaveBeenCalledWith("client_id", WS);
  });

  it("rejects ids that are not UUIDs", async () => {
    const { DELETE } = await import(
      "../../../app/api/clients/[workspaceId]/subscribers/route"
    );

    // Previously interpolated raw into a PostgREST or=(id.eq.…) filter.
    const res = await DELETE(request({ ids: ["x&client_id=neq.0"] }), params);

    expect(res.status).toBe(400);
    expect(deleteChain.delete).not.toHaveBeenCalled();
  });

  it("rejects a non-array ids value", async () => {
    const { DELETE } = await import(
      "../../../app/api/clients/[workspaceId]/subscribers/route"
    );

    expect((await DELETE(request({ ids: "all" }), params)).status).toBe(400);
    expect((await DELETE(request({}), params)).status).toBe(400);
  });

  it("rejects more than 500 ids", async () => {
    const { DELETE } = await import(
      "../../../app/api/clients/[workspaceId]/subscribers/route"
    );

    const res = await DELETE(request({ ids: Array(501).fill(ID_A) }), params);
    expect(res.status).toBe(400);
  });

  it("rejects a viewer", async () => {
    contextMock.mockReturnValue({ workspaceId: WS, role: "viewer" });
    const { DELETE } = await import(
      "../../../app/api/clients/[workspaceId]/subscribers/route"
    );

    const res = await DELETE(request({ ids: [ID_A] }), params);
    expect(res.status).toBe(403);
  });

  it("rejects a caller from another workspace", async () => {
    contextMock.mockReturnValue({ workspaceId: "other-workspace", role: "owner" });
    const { DELETE } = await import(
      "../../../app/api/clients/[workspaceId]/subscribers/route"
    );

    const res = await DELETE(request({ ids: [ID_A] }), params);
    expect(res.status).toBe(401);
  });

  it("returns 500 when the delete fails", async () => {
    deleteChain.select.mockResolvedValue({ data: null, error: { message: "boom" } });
    const { DELETE } = await import(
      "../../../app/api/clients/[workspaceId]/subscribers/route"
    );

    const res = await DELETE(request({ ids: [ID_A] }), params);
    expect(res.status).toBe(500);
  });
});
