import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

/**
 * Route-handler test for the bulk delete.
 *
 * The route moved from a hand-rolled `getClientContextFromJWT` +
 * `assertWorkspaceAccess` check to withWorkspace(). The real wrapper still runs
 * here - only the two things underneath it are mocked, the membership lookup and
 * the scoped client factory - so the test still covers the authorization path
 * end to end rather than stubbing it out.
 */

/** The scoped client the handler receives: .delete().in().eq().select() */
const deleteChain = {
  delete: vi.fn(),
  in: vi.fn(),
  eq: vi.fn(),
  select: vi.fn(),
};

/** The service-role client withWorkspace uses for the membership lookup. */
const membershipChain = {
  select: vi.fn(),
  eq: vi.fn(),
  maybeSingle: vi.fn(),
};

vi.mock("@/lib/supabase", () => ({
  getSupabaseClient: () => ({ from: () => membershipChain }),
}));

vi.mock("@/lib/db-token", () => ({
  getWorkspaceScopedClient: () => ({ from: () => deleteChain }),
}));

const sessionMock = vi.fn();

vi.mock("@/lib/client-context", () => ({
  getClientContextFromJWT: () => sessionMock(),
}));

const WS = "11111111-1111-4111-8111-111111111111";
const OTHER_WS = "44444444-4444-4444-8444-444444444444";
const USER = "55555555-5555-4555-8555-555555555555";
const ID_A = "22222222-2222-4222-8222-222222222222";
const ID_B = "33333333-3333-4333-8333-333333333333";

function request(body: unknown) {
  return { json: async () => body } as unknown as NextRequest;
}

const params = { params: Promise.resolve({ workspaceId: WS }) };

function membership(role = "owner") {
  return { id: USER, email: "a@b.com", role, is_active: true };
}

beforeEach(() => {
  vi.clearAllMocks();
  deleteChain.delete.mockReturnValue(deleteChain);
  deleteChain.in.mockReturnValue(deleteChain);
  deleteChain.eq.mockReturnValue(deleteChain);
  deleteChain.select.mockResolvedValue({ data: [{ id: ID_A }], error: null });

  membershipChain.select.mockReturnValue(membershipChain);
  membershipChain.eq.mockReturnValue(membershipChain);
  membershipChain.maybeSingle.mockResolvedValue({ data: membership(), error: null });

  sessionMock.mockReturnValue({ workspaceId: WS, userId: USER, email: "a@b.com", role: "owner" });
});

const importDelete = async () =>
  (await import("../../../app/api/clients/[workspaceId]/subscribers/route")).DELETE;

describe("DELETE /api/clients/[workspaceId]/subscribers", () => {
  it("reports the count the database actually deleted, not the count requested", async () => {
    const DELETE = await importDelete();

    // Two ids requested; only one belongs to this workspace.
    const res = await DELETE(request({ ids: [ID_A, ID_B] }), params);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.deleted).toBe(1);
  });

  it("scopes the delete to the caller's workspace", async () => {
    const DELETE = await importDelete();

    await DELETE(request({ ids: [ID_A] }), params);

    expect(deleteChain.in).toHaveBeenCalledWith("id", [ID_A]);
    expect(deleteChain.eq).toHaveBeenCalledWith("workspace_id", WS);
  });

  it("rejects ids that are not UUIDs", async () => {
    const DELETE = await importDelete();

    // Previously interpolated raw into a PostgREST or=(id.eq....) filter.
    const res = await DELETE(request({ ids: ["x&workspace_id=neq.0"] }), params);

    expect(res.status).toBe(400);
    expect(deleteChain.delete).not.toHaveBeenCalled();
  });

  it("rejects a non-array ids value", async () => {
    const DELETE = await importDelete();

    expect((await DELETE(request({ ids: "all" }), params)).status).toBe(400);
    expect((await DELETE(request({}), params)).status).toBe(400);
  });

  it("rejects more than 500 ids", async () => {
    const DELETE = await importDelete();

    const res = await DELETE(request({ ids: Array(501).fill(ID_A) }), params);
    expect(res.status).toBe(400);
  });

  it("rejects a viewer", async () => {
    // Role now comes from the membership row, not the token.
    membershipChain.maybeSingle.mockResolvedValue({ data: membership("viewer"), error: null });
    const DELETE = await importDelete();

    const res = await DELETE(request({ ids: [ID_A] }), params);
    expect(res.status).toBe(403);
    expect(deleteChain.delete).not.toHaveBeenCalled();
  });

  it("rejects a caller with no membership in this workspace", async () => {
    // The session is valid and even names a workspace - just not this one, so no
    // membership row comes back for the workspace in the path.
    sessionMock.mockReturnValue({
      workspaceId: OTHER_WS,
      userId: USER,
      email: "a@b.com",
      role: "owner",
    });
    membershipChain.maybeSingle.mockResolvedValue({ data: null, error: null });
    const DELETE = await importDelete();

    const res = await DELETE(request({ ids: [ID_A] }), params);
    expect(res.status).toBe(401);
    expect(deleteChain.delete).not.toHaveBeenCalled();
  });

  it("returns 500 when the delete fails", async () => {
    deleteChain.select.mockResolvedValue({ data: null, error: { message: "boom" } });
    const DELETE = await importDelete();

    const res = await DELETE(request({ ids: [ID_A] }), params);
    expect(res.status).toBe(500);
  });
});
