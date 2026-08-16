import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Who an automation is allowed to touch.
 *
 * These assert the filters present on the two subscriber queries in the automation
 * processor. That is a blunt instrument - it reads the source rather than running
 * it - and it is used deliberately, because the alternative is mocking a nine-stage
 * PostgREST builder inside a cron handler to prove a `.eq()` is present. The
 * property worth defending is exactly "these filters exist", so the test says that.
 *
 * Both were found after the fact, and both are the same shape: a guard that was
 * unnecessary while unsubscribe deleted rows, and became necessary the moment an
 * opt-out became a durable record on a surviving row.
 *
 * - `send_email` selected on confirmed + suppressed but not consent, so it would
 *   mail people that campaign_audience() refuses to send to - most obviously a
 *   one-time lead magnet requester who was promised a file and nothing else.
 * - `add_to_list` did not filter suppression at all, so an automation could put an
 *   unsubscribed person back on a list and make them reachable again.
 */

const SOURCE = readFileSync(
  join(process.cwd(), "app/api/admin/automations/process/route.ts"),
  "utf8"
);

/** The chained filters applied to a `.from("subscribers")` query, in order. */
function filtersForSubscriberQuery(source: string, nth: number): string[] {
  const parts = source.split('.from("subscribers")');
  const body = parts[nth + 1] ?? "";
  // Stop at the end of the builder chain.
  const chain = body.slice(0, body.indexOf(".limit("));
  return [...chain.matchAll(/\.eq\("([a-z_]+)",\s*([a-z0-9_.]+)\)/g)].map(
    (m) => `${m[1]}=${m[2]}`
  );
}

describe("automation recipient filters", () => {
  it("has exactly three subscriber queries, so none is missed", () => {
    // This assertion earned its place immediately: it was written expecting two and
    // found three. The third is the on_schedule send, which had the same consent gap
    // as the first and mails the whole workspace rather than recent signups.
    //
    // If a fourth is added, this fails and whoever adds it has to state its filters
    // here rather than inheriting whatever the nearest query happened to use.
    expect(SOURCE.split('.from("subscribers")').length - 1).toBe(3);
  });

  it("only emails confirmed, unsuppressed, consented subscribers", () => {
    const filters = filtersForSubscriberQuery(SOURCE, 0);
    expect(filters).toContain("confirmed=true");
    expect(filters).toContain("suppressed=false");
    expect(filters).toContain("consent_email_marketing=true");
  });

  it("never adds a suppressed subscriber to a list", () => {
    const filters = filtersForSubscriberQuery(SOURCE, 1);
    expect(filters).toContain("confirmed=true");
    expect(filters).toContain("suppressed=false");
  });

  it("applies the same three filters to the scheduled send", () => {
    // The widest of the three: no recency window, so it reaches everyone.
    const filters = filtersForSubscriberQuery(SOURCE, 2);
    expect(filters).toContain("confirmed=true");
    expect(filters).toContain("suppressed=false");
    expect(filters).toContain("consent_email_marketing=true");
  });
});
