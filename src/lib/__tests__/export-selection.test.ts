import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The `ids` parameter on the subscriber export.
 *
 * Read from source rather than executed, like the other route-shape tests here: the
 * property that matters is which filters and guards reach the query, and mocking a
 * paged PostgREST builder to assert them would mostly exercise the mock.
 *
 * This endpoint returns personal data - names, phone numbers, consent state - for an
 * arbitrary set of ids supplied by the caller. Two things therefore have to hold: the
 * ids are shape-checked before they reach `.in()`, and the workspace filter is still
 * applied alongside them, so a valid uuid from another tenant returns nothing rather
 * than that tenant's contact.
 */

const SOURCE = readFileSync(
  join(process.cwd(), "app/api/clients/[workspaceId]/subscribers/export/route.ts"),
  "utf8"
);

describe("export by selection", () => {
  it("validates every id against a uuid shape", () => {
    expect(SOURCE).toMatch(/UUID\s*=\s*\/\^\[0-9a-fA-F\]\{8\}/);
    expect(SOURCE).toContain("ids.every((v) => UUID.test(v))");
  });

  it("rejects a malformed id rather than dropping it", () => {
    // Dropping the bad one and exporting the rest would answer a question nobody
    // asked, which is worse than failing.
    const guard = SOURCE.slice(SOURCE.indexOf("ids.every"));
    expect(guard).toContain("Invalid contact id in selection");
    expect(guard).toContain("status: 400");
  });

  it("caps how many ids one request may carry", () => {
    expect(SOURCE).toContain("MAX_IDS");
    expect(SOURCE).toMatch(/Too many contacts selected/);
  });

  it("still scopes the query to the workspace when ids are given", () => {
    // The guard that matters for tenancy: an id is not proof of ownership.
    const query = SOURCE.slice(SOURCE.indexOf("fetchAllRows"));
    expect(query).toContain('eq("workspace_id", ctx.workspaceId)');
    expect(query).toContain('in("id", ids)');
  });

  it("treats an absent ids param as a filter export, not an empty selection", () => {
    // `ids === null` must mean "no selection given" and export by filter. Reading it
    // as an empty list would silently export nothing.
    expect(SOURCE).toContain('const rawIds = params.get("ids")');
    expect(SOURCE).toContain("if (rawIds !== null)");
  });
});
