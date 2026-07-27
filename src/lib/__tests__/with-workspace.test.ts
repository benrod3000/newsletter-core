import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import type { WorkspaceHandlerArgs } from "../with-workspace";

type Args = WorkspaceHandlerArgs<{ workspaceId: string; id?: string }>;

/** A handler mock that keeps its argument types, so `.mock.calls` stays typed. */
const okHandler = () => vi.fn(async (_args: Args) => new Response("ok"));

/**
 * Authorization tests for withWorkspace().
 *
 * These cover the decision that used to be spread across 45 route handlers as
 * `if (!ctx || !assertWorkspaceAccess(ctx, workspaceId)) return 401`. That check
 * compared a JWT claim to a path segment and never consulted the database, so a
 * token kept its access until it expired. Several tests below exist specifically
 * to pin down that the database is now the authority.
 */

const membershipChain = {
  select: vi.fn(),
  eq: vi.fn(),
  maybeSingle: vi.fn(),
};

const fromMock = vi.fn(() => membershipChain);

vi.mock("@/lib/supabase", () => ({
  getSupabaseClient: () => ({ from: fromMock }),
}));

const sessionMock = vi.fn();

vi.mock("@/lib/client-context", () => ({
  getClientContextFromJWT: () => sessionMock(),
}));

const scopedClientMock = vi.fn((_ws: string, _user: string) => ({ __scoped: true }));

vi.mock("@/lib/db-token", () => ({
  getWorkspaceScopedClient: (ws: string, user: string) => scopedClientMock(ws, user),
}));

const WS = "11111111-1111-4111-8111-111111111111";
const OTHER_WS = "99999999-9999-4999-8999-999999999999";
const USER = "22222222-2222-4222-8222-222222222222";

const req = {} as NextRequest;
const route = (workspaceId = WS) => ({ params: Promise.resolve({ workspaceId }) });

function membership(over: Record<string, unknown> = {}) {
  return { id: USER, email: "a@b.com", role: "owner", is_active: true, ...over };
}

beforeEach(() => {
  vi.clearAllMocks();
  membershipChain.select.mockReturnValue(membershipChain);
  membershipChain.eq.mockReturnValue(membershipChain);
  membershipChain.maybeSingle.mockResolvedValue({ data: membership(), error: null });
  sessionMock.mockReturnValue({ workspaceId: WS, userId: USER, email: "a@b.com", role: "owner" });
});

describe("withWorkspace - authentication", () => {
  it("rejects a request with no valid session", async () => {
    const { withWorkspace } = await import("../with-workspace");
    sessionMock.mockReturnValue(null);
    const handler = vi.fn();

    const res = await withWorkspace(handler)(req, route());

    expect(res.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });

  it("rejects when the session carries no membership row for this workspace", async () => {
    const { withWorkspace } = await import("../with-workspace");
    membershipChain.maybeSingle.mockResolvedValue({ data: null, error: null });
    const handler = vi.fn();

    const res = await withWorkspace(handler)(req, route());

    expect(res.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });

  it("rejects a deactivated member even though the token is still valid", async () => {
    const { withWorkspace } = await import("../with-workspace");
    membershipChain.maybeSingle.mockResolvedValue({
      data: membership({ is_active: false }),
      error: null,
    });
    const handler = vi.fn();

    const res = await withWorkspace(handler)(req, route());

    expect(res.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });

  it("does not turn a database failure into access", async () => {
    const { withWorkspace } = await import("../with-workspace");
    // supabase-js resolves failures as { error } rather than throwing. If that is
    // not checked explicitly, `data` is null and the code reads as "no membership"
    // - which happens to fail closed here, but only by accident. Assert the
    // distinct 500 so the check cannot be dropped later.
    membershipChain.maybeSingle.mockResolvedValue({
      data: null,
      error: { message: "connection reset" },
    });
    const handler = vi.fn();

    const res = await withWorkspace(handler)(req, route());

    expect(res.status).toBe(500);
    expect(handler).not.toHaveBeenCalled();
  });
});

describe("withWorkspace - the database is the authority, not the token", () => {
  it("looks membership up against the workspace in the PATH, not the token claim", async () => {
    const { withWorkspace } = await import("../with-workspace");
    // Token was minted for WS; the request asks for OTHER_WS.
    sessionMock.mockReturnValue({ workspaceId: WS, userId: USER, email: "a@b.com", role: "owner" });
    membershipChain.maybeSingle.mockResolvedValue({ data: null, error: null });

    const res = await withWorkspace(vi.fn())(req, route(OTHER_WS));

    expect(res.status).toBe(401);
    // The lookup must have been scoped to the requested workspace. If it used the
    // token's claim instead, an agency user could read any workspace by changing
    // the URL.
    expect(membershipChain.eq).toHaveBeenCalledWith("workspace_id", OTHER_WS);
  });

  it("takes the role from workspace_users, ignoring the role in the token", async () => {
    const { withWorkspace } = await import("../with-workspace");
    // Token says owner - a snapshot from login. The database says viewer, because
    // the user was demoted since. The database must win.
    sessionMock.mockReturnValue({ workspaceId: WS, userId: USER, email: "a@b.com", role: "owner" });
    membershipChain.maybeSingle.mockResolvedValue({
      data: membership({ role: "viewer" }),
      error: null,
    });

    const res = await withWorkspace(vi.fn(), { minRole: "editor" })(req, route());

    expect(res.status).toBe(403);
  });

  it("passes the database role through to the handler", async () => {
    const { withWorkspace } = await import("../with-workspace");
    sessionMock.mockReturnValue({ workspaceId: WS, userId: USER, email: "a@b.com", role: "owner" });
    membershipChain.maybeSingle.mockResolvedValue({
      data: membership({ role: "editor" }),
      error: null,
    });
    const handler = okHandler();

    await withWorkspace(handler)(req, route());

    expect(handler.mock.calls[0][0].ctx.role).toBe("editor");
  });
});

describe("withWorkspace - role gating", () => {
  it.each([
    ["viewer", "viewer", 200],
    ["viewer", "editor", 403],
    ["viewer", "owner", 403],
    ["editor", "viewer", 200],
    ["editor", "editor", 200],
    ["editor", "owner", 403],
    ["owner", "viewer", 200],
    ["owner", "editor", 200],
    ["owner", "owner", 200],
  ])("role %s against minRole %s -> %i", async (role, minRole, expected) => {
    const { withWorkspace } = await import("../with-workspace");
    membershipChain.maybeSingle.mockResolvedValue({ data: membership({ role }), error: null });

    const res = await withWorkspace(async () => new Response("ok"), {
      minRole: minRole as "viewer" | "editor" | "owner",
    })(req, route());

    expect(res.status).toBe(expected);
  });

  it("defaults to allowing any active member when minRole is unset", async () => {
    const { withWorkspace } = await import("../with-workspace");
    membershipChain.maybeSingle.mockResolvedValue({
      data: membership({ role: "viewer" }),
      error: null,
    });

    const res = await withWorkspace(async () => new Response("ok"))(req, route());

    expect(res.status).toBe(200);
  });

  it("refuses a role it does not recognise instead of ranking it as lowest", async () => {
    const { withWorkspace } = await import("../with-workspace");
    membershipChain.maybeSingle.mockResolvedValue({
      data: membership({ role: "superadmin" }),
      error: null,
    });

    const res = await withWorkspace(async () => new Response("ok"))(req, route());

    expect(res.status).toBe(500);
  });
});

describe("withWorkspace - what the handler receives", () => {
  it("hands over a workspace-scoped client, not the service-role client", async () => {
    const { withWorkspace } = await import("../with-workspace");
    const handler = okHandler();

    await withWorkspace(handler)(req, route());

    expect(scopedClientMock).toHaveBeenCalledWith(WS, USER);
    expect(handler.mock.calls[0][0].db).toEqual({ __scoped: true });
  });

  it("mints the scoped credential only after membership is confirmed", async () => {
    const { withWorkspace } = await import("../with-workspace");
    membershipChain.maybeSingle.mockResolvedValue({ data: null, error: null });

    await withWorkspace(vi.fn())(req, route());

    // The ordering is the security property: a token for a workspace the caller
    // does not belong to must never come into existence.
    expect(scopedClientMock).not.toHaveBeenCalled();
  });

  it("exposes the route params, so nested dynamic segments still work", async () => {
    const { withWorkspace } = await import("../with-workspace");
    const handler = okHandler();
    const nested = { params: Promise.resolve({ workspaceId: WS, id: "sub-1" }) };

    await withWorkspace(handler)(req, nested);

    expect(handler.mock.calls[0][0].params).toEqual({ workspaceId: WS, id: "sub-1" });
  });

  it("rejects a route with no workspace segment rather than querying for undefined", async () => {
    const { withWorkspace } = await import("../with-workspace");
    const bad = { params: Promise.resolve({} as { workspaceId: string }) };

    const res = await withWorkspace(vi.fn())(req, bad);

    expect(res.status).toBe(400);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("converts a thrown handler error into 500 rather than leaking it", async () => {
    const { withWorkspace } = await import("../with-workspace");
    const handler = vi.fn(async () => {
      throw new Error("boom");
    });

    const res = await withWorkspace(handler)(req, route());

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: { code: "INTERNAL_ERROR", message: "Internal server error" },
    });
  });
});
