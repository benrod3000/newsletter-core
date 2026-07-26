import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Covers the defect that made large sends lose recipients silently: a drain
 * that stopped early used to write status "complete", which also hid the job
 * from the recovery cron (it looks for status = "sending").
 */

const rpc = vi.fn();
const updates: Array<Record<string, unknown>> = [];

function makeQueryBuilder() {
  const builder: Record<string, unknown> = {};
  builder.update = (values: Record<string, unknown>) => {
    updates.push(values);
    return builder;
  };
  builder.eq = () => Promise.resolve({ data: null, error: null });
  return builder;
}

vi.mock("@/lib/supabase", () => ({
  getSupabaseClient: () => ({
    from: () => makeQueryBuilder(),
    rpc: (name: string, args: Record<string, unknown>) => rpc(name, args),
  }),
}));

vi.mock("@/lib/email/dispatcher", () => ({
  dispatchEmail: vi.fn(async () => ({ success: true, provider: "sandbox", fallbackUsed: false })),
}));

vi.mock("@/lib/events", () => ({ bus: { emit: vi.fn() } }));

const dispatchConfig = { provider: "sandbox", credentials: {}, sandbox: true };

function baseParams(overrides: Record<string, unknown> = {}) {
  return {
    jobId: "job_1",
    workspaceId: "ws_1",
    campaignId: "camp_1",
    subject: "Hello {{first_name}}",
    message: "Hi {{first_name}}",
    messageHtml: "<p>Hi {{first_name}}</p>",
    messageCss: "",
    baseUrl: "https://mail.test",
    fromEmail: "a@b.test",
    fromName: "Veloce",
    dispatchConfig,
    ...overrides,
  } as Parameters<typeof import("../send-queue").drainCampaignJob>[0];
}

function recipient(id: string) {
  return {
    subscriber_id: id, email: `${id}@example.com`, unsubscribe_token: `tok_${id}`,
    first_name: "Sam", last_name: null, date_of_birth: null,
    phone_number: null, country: null, region: null, city: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  updates.length = 0;
});

describe("drainCampaignJob", () => {
  it("marks the job complete only when no recipients remain", async () => {
    rpc.mockImplementation((name: string) => {
      if (name === "claim_campaign_recipients") {
        return Promise.resolve({ data: rpc.mock.calls.filter(c => c[0] === "claim_campaign_recipients").length === 1 ? [recipient("a")] : [], error: null });
      }
      if (name === "campaign_job_progress") {
        return Promise.resolve({ data: [{ pending: 0, sent: 1, failed: 0 }], error: null });
      }
      return Promise.resolve({ data: null, error: null });
    });

    const { drainCampaignJob } = await import("../send-queue");
    const result = await drainCampaignJob(baseParams());

    expect(result.sentCount).toBe(1);
    expect(result.remaining).toBe(0);

    const status = updates.find((u) => "status" in u);
    expect(status?.status).toBe("complete");
    expect(status?.completed_at).not.toBeNull();
  });

  it("leaves the job in 'sending' when recipients are still pending", async () => {
    // Time budget of 0 forces the drain to stop before claiming anything.
    rpc.mockImplementation((name: string) => {
      if (name === "campaign_job_progress") {
        return Promise.resolve({ data: [{ pending: 4200, sent: 800, failed: 0 }], error: null });
      }
      return Promise.resolve({ data: [], error: null });
    });

    const { drainCampaignJob } = await import("../send-queue");
    const result = await drainCampaignJob(baseParams({ timeBudgetMs: 0 }));

    expect(result.interrupted).toBe(true);
    expect(result.remaining).toBe(4200);

    const status = updates.find((u) => "status" in u);
    // Must stay "sending" - this is exactly what campaigns/recover looks for.
    expect(status?.status).toBe("sending");
    expect(status?.completed_at).toBeNull();
  });

  it("reports failure only when nothing was sent", async () => {
    rpc.mockImplementation((name: string) => {
      if (name === "campaign_job_progress") {
        return Promise.resolve({ data: [{ pending: 0, sent: 0, failed: 3 }], error: null });
      }
      return Promise.resolve({ data: [], error: null });
    });

    const { drainCampaignJob } = await import("../send-queue");
    await drainCampaignJob(baseParams());

    expect(updates.find((u) => "status" in u)?.status).toBe("failed");
  });

  it("stops claiming once the queue is drained", async () => {
    rpc.mockImplementation((name: string) => {
      if (name === "campaign_job_progress") {
        return Promise.resolve({ data: [{ pending: 0, sent: 0, failed: 0 }], error: null });
      }
      return Promise.resolve({ data: [], error: null });
    });

    const { drainCampaignJob } = await import("../send-queue");
    await drainCampaignJob(baseParams());

    const claims = rpc.mock.calls.filter((c) => c[0] === "claim_campaign_recipients");
    expect(claims).toHaveLength(1);
  });

  it("does not mark the job complete when claiming errors", async () => {
    rpc.mockImplementation((name: string) => {
      if (name === "claim_campaign_recipients") {
        return Promise.resolve({ data: null, error: { message: "connection lost" } });
      }
      if (name === "campaign_job_progress") {
        return Promise.resolve({ data: [{ pending: 10, sent: 0, failed: 0 }], error: null });
      }
      return Promise.resolve({ data: null, error: null });
    });

    const { drainCampaignJob } = await import("../send-queue");
    const result = await drainCampaignJob(baseParams());

    expect(result.remaining).toBe(10);
    expect(updates.find((u) => "status" in u)?.status).toBe("sending");
  });
});
