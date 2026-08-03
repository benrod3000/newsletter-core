import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

/**
 * CSV formula injection on the subscriber export.
 *
 * Subscribers choose their own first name, and the export is opened in a
 * spreadsheet by an operator. A name beginning `=`, `+`, `-` or `@` is treated
 * as a formula rather than text, so quoting alone does not help - the
 * spreadsheet strips the quotes and evaluates the contents.
 *
 * These assert on the produced CSV body rather than the escape function, so the
 * test still means something if the escaping moves.
 */

const chain = {
  select: vi.fn(),
  eq: vi.fn(),
  gt: vi.fn(),
  order: vi.fn(),
  limit: vi.fn(),
  maybeSingle: vi.fn(),
  insert: vi.fn(),
};

let exportRows: Array<Record<string, unknown>> = [];

vi.mock("@/lib/supabase", () => ({
  getSupabaseClient: () => ({ from: () => chain }),
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

const params = { params: Promise.resolve({ workspaceId: WS }) };
const request = () =>
  ({ url: `https://x/api/clients/${WS}/subscribers/export`, headers: new Headers() }) as unknown as NextRequest;

beforeEach(() => {
  vi.clearAllMocks();
  exportRows = [];

  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  chain.gt.mockReturnValue(chain);
  chain.order.mockReturnValue(chain);
  chain.insert.mockResolvedValue({ data: null, error: null });
  // The export's page fetch resolves here; membership lookup uses maybeSingle.
  chain.limit.mockImplementation(() => Promise.resolve({ data: exportRows, error: null }));
  chain.maybeSingle.mockResolvedValue({
    data: { id: USER, email: "a@b.com", role: "owner", is_active: true },
    error: null,
  });

  sessionMock.mockReturnValue({ workspaceId: WS, userId: USER, email: "a@b.com", role: "owner" });
});

function subscriber(overrides: Record<string, unknown>) {
  return {
    id: "id-1", email: "a@b.com", first_name: null, last_name: null,
    phone_number: null, date_of_birth: null, country: null, region: null,
    city: null, timezone: null, locale: null, utm_source: null,
    utm_medium: null, utm_campaign: null, consent_email_marketing: true,
    consent_analytics_tracking: false, confirmed: true, suppressed: false,
    suppressed_reason: null, created_at: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

const importGet = async () =>
  (await import("../../../app/api/clients/[workspaceId]/subscribers/export/route")).GET;

async function csvFor(overrides: Record<string, unknown>): Promise<string> {
  exportRows = [subscriber(overrides)];
  const GET = await importGet();
  return await (await GET(request(), params)).text();
}

describe("subscriber CSV export escaping", () => {
  it.each([
    ["=HYPERLINK(\"http://evil\",\"click\")", "="],
    ["+cmd|'/c calc'!A0", "+"],
    ["-2+3", "-"],
    ["@SUM(1:9)", "@"],
  ])("neutralises a leading %s", async (payload, prefix) => {
    const csv = await csvFor({ first_name: payload });

    // No cell may start with the dangerous character, quoted or bare.
    expect(csv).not.toMatch(new RegExp(`(^|,)"?\\${prefix}`, "m"));
    // and the value is prefixed rather than dropped.
    expect(csv).toContain(`'${prefix}`);
  });

  it("still quotes values containing a comma", async () => {
    const csv = await csvFor({ last_name: "Smith, Jr." });

    expect(csv).toContain('"Smith, Jr."');
  });

  it("escapes embedded double quotes by doubling them", async () => {
    const csv = await csvFor({ last_name: 'He said "hi"' });

    expect(csv).toContain('"He said ""hi"""');
  });

  it("does not mangle an ordinary value", async () => {
    const csv = await csvFor({ first_name: "Ada" });

    expect(csv).toContain("Ada");
    expect(csv).not.toContain("'Ada");
  });

  it("keeps a leading-hyphen value readable rather than dropping it", async () => {
    // Prefixing must neutralise, not discard: the operator still needs the data.
    const csv = await csvFor({ first_name: "-Ada" });

    expect(csv).toContain("'-Ada");
  });
});
