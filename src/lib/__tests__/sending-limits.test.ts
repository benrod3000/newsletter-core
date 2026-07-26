import { describe, it, expect, vi, beforeEach } from "vitest";
import { checkSendingLimit, SendingLimitError } from "@/lib/sending-limits";

/**
 * These lock in the behaviour the previous implementation only claimed to have.
 * It called increment_sending_counters(), which did not exist; supabase-js
 * reports that as { error } rather than throwing, so its try/catch fallback was
 * dead code and the counter was never incremented at all.
 */

const rpcMock = vi.fn();
const supabase = { rpc: rpcMock } as unknown as Parameters<typeof checkSendingLimit>[0];

const WS = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("checkSendingLimit", () => {
  it("passes the recipient count to the RPC and returns remaining headroom", async () => {
    rpcMock.mockResolvedValue({ data: [{ allowed: true, reason: null, remaining: 900 }], error: null });

    await expect(checkSendingLimit(supabase, WS, 100)).resolves.toBe(900);
    expect(rpcMock).toHaveBeenCalledWith("increment_sending_counters", {
      p_workspace_id: WS,
      p_count: 100,
    });
  });

  it("returns null when the workspace is uncapped", async () => {
    rpcMock.mockResolvedValue({ data: [{ allowed: true, reason: null, remaining: null }], error: null });
    await expect(checkSendingLimit(supabase, WS, 10)).resolves.toBeNull();
  });

  it("throws with the monthly reason when the cap would be exceeded", async () => {
    rpcMock.mockResolvedValue({
      data: [{ allowed: false, reason: "monthly_limit", remaining: 25 }],
      error: null,
    });

    await expect(checkSendingLimit(supabase, WS, 100)).rejects.toThrow(SendingLimitError);
    await expect(checkSendingLimit(supabase, WS, 100)).rejects.toThrow(/25 more emails this period/);
  });

  it("throws with the lifetime reason when the total cap would be exceeded", async () => {
    rpcMock.mockResolvedValue({
      data: [{ allowed: false, reason: "lifetime_limit", remaining: 0 }],
      error: null,
    });

    const err = await checkSendingLimit(supabase, WS, 5).catch((e) => e);
    expect(err).toBeInstanceOf(SendingLimitError);
    expect(err.reason).toBe("lifetime_limit");
  });

  // The whole point of the rewrite: an error is not silently a pass.
  it("fails closed when the RPC errors", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: "57014", message: "statement timeout" } });

    const err = await checkSendingLimit(supabase, WS, 10).catch((e) => e);
    expect(err).toBeInstanceOf(SendingLimitError);
    expect(err.reason).toBe("check_failed");
  });

  it("fails closed when the RPC returns no row", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    await expect(checkSendingLimit(supabase, WS, 10)).rejects.toThrow(SendingLimitError);
  });

  // Deployment skew only — code live, migration 045 not applied yet.
  it("degrades to unenforced when the function itself is missing", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { code: "PGRST202", message: "Could not find the function" },
    });

    await expect(checkSendingLimit(supabase, WS, 10)).resolves.toBeNull();
  });

  it("does not treat any other error as deployment skew", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: "42501", message: "permission denied" } });
    await expect(checkSendingLimit(supabase, WS, 10)).rejects.toThrow(SendingLimitError);
  });
});
