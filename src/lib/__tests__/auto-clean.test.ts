import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Auto-clean is the only scheduled job that destroys customer data, so these
 * assert the refusals rather than the happy path.
 *
 * The guard exists because of a timing hazard rather than a coding mistake:
 * `cold` is the default health score for a subscriber with no engagement
 * events, and the scoring job had been timing out and leaving most subscribers
 * unscored. Repairing the scoring job therefore turns "nobody is cold" into
 * "almost everyone is cold", and this job would delete them. No human error is
 * required for that; it happens on a cron.
 */

type Row = Record<string, unknown>;

const state = {
  workspaces: [{ id: "ws-1" }] as Row[],
  totalSubscribers: 1000,
  scoredSubscribers: 1000,
  eventCount: 500,
  candidates: [] as Row[],
  recentEvents: [] as Row[],
  auditError: null as null | { message: string },
  deleted: [] as Row[],
};

/**
 * Minimal supabase-js stand-in. Each `.from()` returns a thenable builder, so
 * both `await q` and `.then()` resolve to the shape the code expects.
 */
function makeClient() {
  return {
    from(table: string) {
      const builder: Record<string, unknown> = {};
      const self = () => builder;
      let isHeadCount = false;
      let countsScoredOnly = false;
      let isDelete = false;

      Object.assign(builder, {
        select: (_cols: string, opts?: { head?: boolean; count?: string }) => {
          if (opts?.head) isHeadCount = true;
          return builder;
        },
        eq: () => builder,
        in: () => builder,
        gt: () => builder,
        lt: () => builder,
        gte: () => builder,
        not: () => {
          countsScoredOnly = true;
          return builder;
        },
        order: () => builder,
        limit: () => resolve(),
        delete: () => {
          isDelete = true;
          return builder;
        },
        insert: () => Promise.resolve({ data: null, error: state.auditError }),
        then: (onOk: (v: unknown) => unknown) => resolve().then(onOk),
      });

      function resolve() {
        if (isDelete) {
          state.deleted = state.candidates.slice();
          return Promise.resolve({ data: state.deleted, error: null });
        }
        if (isHeadCount) {
          if (table === "campaign_events") return Promise.resolve({ count: state.eventCount, error: null });
          return Promise.resolve({
            count: countsScoredOnly ? state.scoredSubscribers : state.totalSubscribers,
            error: null,
          });
        }
        if (table === "clients") return Promise.resolve({ data: state.workspaces, error: null });
        if (table === "campaign_events") return Promise.resolve({ data: state.recentEvents, error: null });
        if (table === "subscribers") return Promise.resolve({ data: state.candidates, error: null });
        return Promise.resolve({ data: [], error: null });
      }

      return builder;
    },
  };
}

vi.mock("@/lib/supabase", () => ({ getSupabaseClient: () => makeClient() }));
vi.mock("@/lib/audit-log", () => ({
  logAudit: vi.fn().mockResolvedValue(undefined),
  AUDIT_ACTIONS: { SUBSCRIBER_DELETED: "subscriber_deleted" },
}));

const { runAutoClean } = await import("../automations/auto-clean");

beforeEach(() => {
  state.workspaces = [{ id: "ws-1" }];
  state.totalSubscribers = 1000;
  state.scoredSubscribers = 1000;
  state.eventCount = 500;
  state.candidates = [{ id: "sub-1", email: "a@b.com", created_at: "2020-01-01T00:00:00Z" }];
  state.recentEvents = [];
  state.auditError = null;
  state.deleted = [];
});

describe("runAutoClean", () => {
  it("deletes a long-disengaged subscriber when everything checks out", async () => {
    const result = await runAutoClean();
    expect(result.deleted).toBe(1);
  });

  it("refuses to delete when most of the workspace is unscored", async () => {
    // The exact situation the scoring timeout produced: 29% scored.
    state.scoredSubscribers = 290;

    const result = await runAutoClean();

    expect(result.deleted).toBe(0);
    expect(result.skipped[0].reason).toContain("scored");
  });

  it("refuses to delete a workspace with no engagement history at all", async () => {
    // With no campaign ever sent there are no opens or clicks, so every
    // subscriber looks equally disengaged and "cold" means nothing.
    state.eventCount = 0;

    const result = await runAutoClean();

    expect(result.deleted).toBe(0);
    expect(result.skipped[0].reason).toContain("engagement history");
  });

  it("spares a subscriber who engaged inside the window", async () => {
    state.recentEvents = [{ subscriber_id: "sub-1" }];

    const result = await runAutoClean();

    expect(result.deleted).toBe(0);
  });

  it("deletes nothing if the GDPR audit record cannot be written", async () => {
    // The previous version wrote an audit row that could never succeed, never
    // checked the result, and deleted anyway.
    state.auditError = { message: "insert failed" };

    const result = await runAutoClean();

    expect(result.deleted).toBe(0);
    expect(result.skipped[0].reason).toContain("audit");
  });

  it("does nothing when there are no candidates", async () => {
    state.candidates = [];
    expect((await runAutoClean()).deleted).toBe(0);
  });
});
