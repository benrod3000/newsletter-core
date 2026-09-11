import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Structural tests over the source, for the same reason the SMS pipeline has
 * them: the defects here were absences, and an absence is invisible to a unit
 * test that does not know to look for it.
 *
 * What this file used to do, in order: consume the one reminder each unconfirmed
 * signup was owed without sending anything, wait five days, then hard-delete the
 * person. The delete also took suppressed rows with it, destroying opt-out
 * records that are the only thing stopping a re-imported address from being
 * mailed again.
 *
 * None of that failed loudly. Every fetch response was discarded while the
 * counters incremented regardless, so the cron reported work it had not done.
 *
 * It was latent only because production has no unconfirmed subscribers. It arms
 * the first time anyone adds a contact by hand, because the dashboard's
 * add-contact route inserts `confirmed: false`.
 */

const ROOT = process.cwd();
const MODULE = "src/lib/automations/confirm-remind.ts";
const ROUTE = "app/api/admin/automations/confirm-remind/run/route.ts";

function code(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("confirm-remind", () => {
  it("actually sends a reminder", () => {
    // The defect that named the file a lie. There was no import and no send call
    // anywhere in it.
    expect(code(MODULE)).toMatch(/sendConfirmationEmail\(/);
  });

  it("marks reminded only after a successful send", () => {
    // The ordering is the correction. `reminded` records that a reminder was
    // DELIVERED, and the selecting query filters on it, so setting it after a
    // failure spends the person's only reminder on nothing and guarantees they
    // are deleted five days later having never heard from us.
    const src = code(MODULE);
    const failureBranch = src.indexOf("if (!result.sent)");
    const marking = src.indexOf("reminded: true");

    expect(failureBranch).toBeGreaterThan(-1);
    expect(marking).toBeGreaterThan(-1);
    expect(failureBranch).toBeLessThan(marking);
  });

  it("never deletes a suppressed subscriber", () => {
    // A suppressed row is an opt-out record. Deleting it means the address can
    // be re-imported and mailed again, because nothing remains to say it opted
    // out. The delete query must carry the same suppression filter the reminder
    // query does.
    const src = code(MODULE);
    const deleteQuery = src.slice(src.indexOf("const doomed"));
    expect(deleteQuery).toMatch(/\.eq\("suppressed",\s*false\)/);
  });

  it("checks every database error instead of counting regardless", () => {
    const src = code(MODULE);
    for (const name of ["pendingError", "markError", "deleteError"]) {
      expect(src, `${name} is not checked`).toMatch(new RegExp(`if \\(${name}\\)`));
    }
  });

  it("deletes in one statement, not one round trip per row", () => {
    // The previous loop issued a DELETE per subscriber. That is the shape that
    // already timed out once in the health-score cron, and it counted every
    // iteration as removed without looking at the response.
    const src = code(MODULE);
    expect(src).toMatch(/\.delete\(\)[\s\S]{0,80}\.in\(/);
  });

  it("pages the deletion candidates rather than taking a capped read", () => {
    // PostgREST caps a response at 1,000 rows whatever the limit asks for, so
    // `limit=1000` silently truncated.
    expect(code(MODULE)).toMatch(/fetchAllRows/);
    expect(code(MODULE)).not.toMatch(/limit=1000/);
  });

  it("bounds how many reminders one run may send", () => {
    expect(code(MODULE)).toMatch(/MAX_REMINDERS_PER_RUN/);
  });
});

describe("the confirm-remind route", () => {
  it("builds links from the request, not from an env var", () => {
    // getBaseUrl prefers NEXT_PUBLIC_APP_URL, which on this project points at
    // the FRONTEND, so a confirmation link built from it 404s. getApiBaseUrl
    // reads the request's own proto and host.
    expect(code(ROUTE)).toMatch(/getApiBaseUrl\(req\)/);
    expect(code(ROUTE)).not.toMatch(/getBaseUrl\(/);
  });

  it("answers 500 when the run failed", () => {
    // A cheerful 200 with an error field nobody reads is how a broken cron stays
    // broken. Same lesson as the health-score route.
    expect(code(ROUTE)).toMatch(/result\.error \? 500 : 200/);
  });

  it("sets a duration budget, now that it sends email", () => {
    expect(code(ROUTE)).toMatch(/maxDuration/);
  });
});
