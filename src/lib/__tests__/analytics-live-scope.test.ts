import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Workspace scoping on the live pulse.
 *
 * This route runs as service-role, so RLS does not apply, and it selects subscriber
 * email addresses. It had no workspace filter at all: the ten most recent opens and
 * clicks from *any* workspace were returned, addresses included, with the campaign
 * title falling back to "Unknown" for a foreign campaign while the address stayed in
 * the payload.
 *
 * No exposure happened, because only one workspace has ever had engagement data. It
 * would have begun with the second, silently, in a component that polls.
 *
 * A second fault hid the first: `&in=(event_type,open,click)` is not PostgREST syntax,
 * so the request errored and the route returned an empty list. Anyone "fixing" the
 * pulse by correcting that filter alone would have switched the leak on.
 *
 * Read from source, like the other route-shape tests here - the property worth
 * defending is that the filter is present, and asserting it through a mocked query
 * builder would mostly exercise the mock.
 */

const RAW = readFileSync(
  join(process.cwd(), "app/api/clients/[workspaceId]/analytics/live/route.ts"),
  "utf8"
);

/*
 * Comments stripped before asserting.
 *
 * Two assertions below say a string must be *absent*, and the docblock in that route
 * quotes both of them while explaining what used to be wrong. Reading the raw file
 * therefore failed on its own documentation - the test was describing the comment, not
 * the code.
 */
const SOURCE = RAW.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

describe("analytics/live", () => {
  it("scopes the event query to the workspace", () => {
    const query = SOURCE.slice(SOURCE.indexOf('from("campaign_events")'));
    expect(query.slice(0, 400)).toContain('eq("workspace_id", workspaceId)');
  });

  it("scopes the campaign title lookup too", () => {
    // Titles are joined back onto events by id. Without this filter an id from
    // another tenant would resolve to that tenant's campaign name.
    const query = SOURCE.slice(SOURCE.indexOf('from("campaigns")'));
    expect(query.slice(0, 400)).toContain('eq("workspace_id", workspaceId)');
  });

  it("filters event types with valid PostgREST syntax", () => {
    expect(SOURCE).toContain('in("event_type", ["open", "click"])');
    // The malformed original, which silently returned nothing.
    expect(SOURCE).not.toContain("&in=(event_type");
  });

  it("does not require the workspace to have campaigns", () => {
    // It used to read campaigns first and return early when there were none, so a
    // workspace whose only engagement is capture-form clicks saw an empty pulse
    // forever. Those events have no campaign at all.
    const eventsAt = SOURCE.indexOf('from("campaign_events")');
    const campaignsAt = SOURCE.indexOf('from("campaigns")');
    expect(eventsAt).toBeLessThan(campaignsAt);
  });

  it("labels an event with no campaign rather than calling it Unknown", () => {
    expect(SOURCE).toContain("Capture form download");
    expect(SOURCE).not.toContain('"Unknown"');
  });
});
