import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The admin housekeeping purges, which delete subscribers irreversibly.
 *
 * Read from source for the same reason as the automation filter tests: the property
 * worth defending is which filters reach the database, and proving that by mocking a
 * multi-stage PostgREST chain would mostly exercise the mock.
 *
 * Two defects sat here, both silent and both destructive.
 *
 * `purge_inactive` decided who had never opened anything from a single unbounded
 * select on `campaign_events`. PostgREST caps that at 1,000 rows with no error, so
 * the "has engaged" set was an arbitrary thousand events - and everyone whose open
 * fell outside it was deleted as inactive. The same query had no workspace filter,
 * so an admin purging one workspace could spend the entire budget on another
 * tenant's events.
 *
 * `purge_suppressed` deleted every suppressed row. Since migration 065 a suppressed
 * row *is* the opt-out record - unsubscribe stopped deleting people specifically so
 * the objection survives a re-import - so that action destroyed the only evidence
 * an address had opted out, making it mailable again on the next CSV.
 */

const SOURCE = readFileSync(
  join(process.cwd(), "app/api/admin/housekeeping/route.ts"),
  "utf8"
);

/** The source of one `if (action === "...")` block. */
function actionBlock(name: string): string {
  const start = SOURCE.indexOf(`if (action === "${name}")`);
  expect(start).toBeGreaterThan(-1);
  const rest = SOURCE.slice(start + 1);
  const next = rest.indexOf('if (action === "');
  return next === -1 ? rest : rest.slice(0, next);
}

describe("purge_suppressed", () => {
  it("never deletes an unsubscribe record", () => {
    const block = actionBlock("purge_suppressed");
    // Both the dry-run count and the delete, or the preview lies about the delete.
    expect(block.match(/neq\("suppressed_reason", "unsubscribe"\)/g)).toHaveLength(2);
  });

  it("still targets suppressed rows", () => {
    const block = actionBlock("purge_suppressed");
    expect(block).toContain('eq("suppressed", true)');
  });
});

describe("purge_inactive", () => {
  it("pages the candidate list instead of taking the first 1,000", () => {
    const block = actionBlock("purge_inactive");
    expect(block).toContain("fetchAllRows");
  });

  it("looks up engagement per candidate, not by fetching every event", () => {
    const block = actionBlock("purge_inactive");
    // `.in(...)` over batches of candidates is bounded; a bare select is not.
    expect(block).toContain('in("subscriber_id", ids)');
    expect(block).not.toMatch(/from\("campaign_events"\)[\s\S]{0,120}\.not\(/);
  });

  it("scopes the engagement lookup to the workspace being purged", () => {
    const block = actionBlock("purge_inactive");
    const lookup = block.slice(block.indexOf('from("campaign_events")'));
    expect(lookup).toContain('eq("workspace_id", clientId)');
  });

  it("refuses to delete when engagement cannot be read", () => {
    // Failing open here means deleting people whose opens we simply could not see.
    const block = actionBlock("purge_inactive");
    expect(block).toContain("Could not verify engagement, nothing deleted");
  });

  it("checks the error on every delete batch", () => {
    // supabase-js resolves errors rather than throwing, so an unchecked batch adds
    // zero to the tally and the endpoint reports partial work as success.
    const block = actionBlock("purge_inactive");
    const loop = block.slice(block.indexOf("const BATCH = 100"));
    expect(loop).toContain("const { count, error }");
    expect(loop).toContain("before failing");
  });
});
