import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

/**
 * Unsubscribe must suppress, never delete.
 *
 * The route used to `DELETE` the subscriber row. That destroyed the only record
 * that the address had objected, so a later CSV import or widget submission
 * recreated it unsuppressed and it was mailed again - and it took every
 * `campaign_event` and note for that person with it.
 *
 * The property under test is narrow and legal: what reaches the database is an
 * update setting `suppressed`, and no delete is issued. It is asserted at the
 * query-builder level because the alternative - trusting a comment - is what let
 * the original behaviour survive this long.
 */

const chain = {
  update: vi.fn(),
  delete: vi.fn(),
  eq: vi.fn(),
  is: vi.fn(),
  select: vi.fn(),
  maybeSingle: vi.fn(),
};

vi.mock("@/lib/supabase", () => ({
  getSupabaseClient: () => ({ from: () => chain }),
}));

vi.mock("@/lib/logger", () => ({ logError: vi.fn(), logInfo: vi.fn() }));

const { POST } = await import("../../../app/api/unsubscribe/route");

const TOKEN = "22222222-2222-4222-8222-222222222222";

/**
 * `.select()` is terminal on the update chain (`update().eq().is().select()`)
 * but chainable on the re-read (`select().eq().maybeSingle()`), so it returns
 * something that is both awaitable and still carries `.eq()`.
 */
function updateMatches(rows: Array<{ id: string }>) {
  chain.update.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  chain.is.mockReturnValue(chain);
  chain.select.mockImplementation(() =>
    Object.assign(Promise.resolve({ data: rows, error: null }), { eq: () => chain })
  );
}

function existingRow(row: { id: string } | null) {
  chain.maybeSingle.mockResolvedValue({ data: row, error: null });
}

function postWithQuery(token: string) {
  return { url: `https://example.com/api/unsubscribe?token=${token}` } as unknown as NextRequest;
}

function postWithBody(token: unknown) {
  return {
    url: "https://example.com/api/unsubscribe",
    json: async () => ({ token }),
  } as unknown as NextRequest;
}

beforeEach(() => {
  Object.values(chain).forEach((fn) => fn.mockReset());
});

describe("unsubscribe", () => {
  it("suppresses rather than deleting", async () => {
    updateMatches([{ id: "sub-1" }]);
    const res = await POST(postWithBody(TOKEN));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, removed: true });

    // The whole point: no delete reaches the database.
    expect(chain.delete).not.toHaveBeenCalled();
    expect(chain.update).toHaveBeenCalledTimes(1);

    const payload = chain.update.mock.calls[0][0];
    expect(payload.suppressed).toBe(true);
    expect(payload.suppressed_reason).toBe("unsubscribe");
    expect(typeof payload.suppressed_at).toBe("string");
    // Consent is withdrawn at the same time, so a consent-gated send cannot
    // reach them either.
    expect(payload.consent_email_marketing).toBe(false);
  });

  it("matches on the token", async () => {
    updateMatches([{ id: "sub-1" }]);
    await POST(postWithBody(TOKEN));
    expect(chain.eq).toHaveBeenCalledWith("unsubscribe_token", TOKEN);
  });

  it("treats a second click as success without rewriting the first objection", async () => {
    // Nothing to update because suppressed_at is already set; the row still
    // exists, so the visitor is correctly told they are unsubscribed.
    updateMatches([]);
    existingRow({ id: "sub-1" });

    const res = await POST(postWithBody(TOKEN));
    expect(await res.json()).toEqual({ ok: true, removed: true });
    expect(chain.is).toHaveBeenCalledWith("suppressed_at", null);
  });

  it("reports an unknown token as not removed", async () => {
    updateMatches([]);
    existingRow(null);

    const res = await POST(postWithBody(TOKEN));
    expect(await res.json()).toEqual({ ok: true, removed: false });
  });

  it("rejects a malformed token without touching the database", async () => {
    const res = await POST(postWithBody("not-a-uuid"));
    expect(await res.json()).toEqual({ ok: true, removed: false });
    expect(chain.update).not.toHaveBeenCalled();
    expect(chain.delete).not.toHaveBeenCalled();
  });

  it("rejects a missing token", async () => {
    const res = await POST(postWithBody(undefined));
    expect(res.status).toBe(400);
  });

  it("answers one-click POSTs with 200 and no body, per RFC 8058", async () => {
    // Gmail and Yahoo POST this URL directly from the List-Unsubscribe header.
    updateMatches([{ id: "sub-1" }]);
    const res = await POST(postWithQuery(TOKEN));

    expect(res.status).toBe(200);
    expect(chain.update).toHaveBeenCalledTimes(1);
    expect(chain.delete).not.toHaveBeenCalled();
  });
});
