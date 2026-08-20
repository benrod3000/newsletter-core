import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

/**
 * That logError actually reports.
 *
 * It did not, for the entire life of the project. The module's own docblock
 * described a two-step setup - install @sentry/nextjs, then wire it in here -
 * and only the first step was ever done. The package was a dependency,
 * sentry.server.config.js called Sentry.init(), instrumentation.ts imported it
 * at cold start, and this function still only wrote to console.
 *
 * Nothing failed. No test broke. Sentry showed zero issues, which reads as "the
 * backend is healthy" and actually meant "the backend has never once reported".
 * With 132 call sites and no queryable runtime logs on the Hobby plan, that made
 * every API failure invisible.
 *
 * It is the exact shape this codebase keeps producing - a control that exists,
 * looks wired, returns successfully, and discards its input - so it gets a test
 * rather than a promise to remember.
 */

const captureException = vi.fn();
const setExtras = vi.fn();
const setExtra = vi.fn();
const setTag = vi.fn();

vi.mock("@sentry/nextjs", () => ({
  captureException: (...args: unknown[]) => captureException(...args),
  withScope: (fn: (scope: unknown) => void) =>
    fn({ setExtras, setExtra, setTag }),
}));

const { logError, logWarn } = await import("../logger");

const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});

beforeEach(() => {
  captureException.mockClear();
  setExtras.mockClear();
  setExtra.mockClear();
  setTag.mockClear();
});

afterAll(() => {
  consoleError.mockRestore();
  consoleWarn.mockRestore();
});

describe("logError", () => {
  it("reports the error to Sentry, not just the console", () => {
    const err = new Error("provider rejected the message");
    logError(err);

    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException).toHaveBeenCalledWith(err);
  });

  it("wraps a non-Error so it arrives with a message instead of grouping as one blob", () => {
    // The common case: supabase-js resolves { data, error } and the error is a
    // plain object. Passed straight to captureException it becomes "Non-Error
    // exception captured", with no stack, and every such report groups
    // together - which is indistinguishable from having no reports.
    logError({ message: "permission denied for table campaigns", code: "42501" });

    expect(captureException).toHaveBeenCalledTimes(1);
    const reported = captureException.mock.calls[0][0] as Error;
    expect(reported).toBeInstanceOf(Error);
    expect(reported.message).toBe("permission denied for table campaigns");
    expect(setExtra).toHaveBeenCalledWith("originalError", expect.objectContaining({ code: "42501" }));
  });

  it("puts context on the scope and tags the fields worth grouping by", () => {
    logError(new Error("boom"), {
      route: "clients.campaigns.send",
      workspaceId: "ws-1",
      campaignId: "c-1",
    });

    expect(setExtras).toHaveBeenCalledWith(
      expect.objectContaining({ campaignId: "c-1" })
    );
    expect(setTag).toHaveBeenCalledWith("route", "clients.campaigns.send");
    expect(setTag).toHaveBeenCalledWith("workspace_id", "ws-1");
    // campaignId is high-cardinality and must stay out of the tag budget.
    expect(setTag).not.toHaveBeenCalledWith("campaignId", expect.anything());
  });

  it("still writes to the console, so a missing DSN does not mean a lost error", () => {
    logError(new Error("boom"));
    expect(consoleError).toHaveBeenCalled();
  });
});

describe("logWarn", () => {
  it("does not report, because routine warnings would drown the error stream", () => {
    logWarn("auto-clean skipped ws-1: only 290/1000 subscribers scored");

    expect(consoleWarn).toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
  });
});
