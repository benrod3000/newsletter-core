import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { NextRequest } from "next/server";

/**
 * forgot-password must answer identically whether or not the address has an
 * account, and whether or not the email actually went out.
 *
 * This is the property most likely to be broken by a well-intentioned change.
 * The natural instinct on discovering that reset emails were silently failing
 * is to start reporting that failure to the caller - which would turn the
 * endpoint into an account enumeration oracle: anyone could test whether a
 * given email has an account here, simply by watching for a different response.
 *
 * The operator sees the failure in Security Activity. The requester must not.
 */

const sendMock = vi.fn();
const auditRows: Array<Record<string, unknown>> = [];

vi.mock("@/lib/email-sender", () => ({
  sendTransactionalEmail: (...args: unknown[]) => sendMock(...args),
}));

vi.mock("@/lib/audit-log", () => ({
  logAudit: async (row: Record<string, unknown>) => {
    auditRows.push(row);
  },
  AUDIT_ACTIONS: {
    PASSWORD_RESET_SENT: "password_reset_sent",
    PASSWORD_RESET_FAILED: "password_reset_failed",
  },
}));

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: async () => ({ allowed: true, retryAfter: 0 }),
}));

vi.mock("@/lib/turnstile", () => ({ verifyTurnstileToken: async () => true }));
vi.mock("@/lib/client-ip", () => ({ getClientIp: () => "203.0.113.9" }));
vi.mock("@/lib/logger", () => ({ logError: vi.fn(), logWarn: vi.fn() }));

/** Whether the fake database should report a matching account. */
let userExists = true;

const originalFetch = globalThis.fetch;

beforeEach(() => {
  vi.clearAllMocks();
  auditRows.length = 0;
  userExists = true;
  sendMock.mockResolvedValue(true);

  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "svc";

  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    if (String(url).includes("workspace_users") && (!init || init.method !== "PATCH")) {
      return new Response(
        JSON.stringify(
          userExists ? [{ id: "user-1", email: "a@b.com", workspace_id: "ws-1" }] : []
        ),
        { status: 200 }
      );
    }
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;
});

function request(email: string) {
  return {
    json: async () => ({ email, turnstile_token: "tok" }),
    headers: new Headers({ "user-agent": "vitest" }),
  } as unknown as NextRequest;
}

const importPost = async () =>
  (await import("../../../app/api/auth/forgot-password/route")).POST;

/** Status plus body, which together are everything a caller can observe. */
async function observable(email: string) {
  const POST = await importPost();
  const res = await POST(request(email));
  return { status: res.status, body: await res.text() };
}

describe("forgot-password does not leak whether an account exists", () => {
  it("answers the same for a known and an unknown address", async () => {
    userExists = true;
    const known = await observable("a@b.com");

    userExists = false;
    const unknown = await observable("nobody@nowhere.com");

    expect(known).toEqual(unknown);
    expect(known.status).toBe(200);
  });

  it("answers the same when the email fails to send", async () => {
    // The regression this guards: surfacing the send failure to the caller.
    userExists = true;
    const ok = await observable("a@b.com");

    sendMock.mockRejectedValue(new Error("Platform email is not configured."));
    const failed = await observable("a@b.com");

    expect(failed).toEqual(ok);
    expect(failed.status).toBe(200);
  });

  it("answers the same when platform email is entirely unconfigured", async () => {
    sendMock.mockRejectedValue(new Error("Platform email is not configured."));

    userExists = true;
    const known = await observable("a@b.com");
    userExists = false;
    const unknown = await observable("nobody@nowhere.com");

    expect(known).toEqual(unknown);
  });

  it("does not attempt a send for an address with no account", async () => {
    userExists = false;
    await observable("nobody@nowhere.com");
    expect(sendMock).not.toHaveBeenCalled();
  });
});

describe("forgot-password records the outcome the caller cannot see", () => {
  it("records a successful send", async () => {
    await observable("a@b.com");
    expect(auditRows.at(-1)?.action).toBe("password_reset_sent");
  });

  it("records a failed send, which is the only place it is visible", async () => {
    sendMock.mockRejectedValue(new Error("Platform email is not configured."));
    await observable("a@b.com");
    expect(auditRows.at(-1)?.action).toBe("password_reset_failed");
  });

  it("records nothing for an address with no account", async () => {
    // Writing a row here would leak existence through the audit log instead.
    userExists = false;
    await observable("nobody@nowhere.com");
    expect(auditRows).toHaveLength(0);
  });
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});
