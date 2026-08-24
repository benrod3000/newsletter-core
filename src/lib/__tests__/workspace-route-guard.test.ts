import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Every workspace-scoped route goes through withWorkspace.
 *
 * There were two authorization models under /api/clients. Twenty-nine routes
 * used withWorkspace, which resolves the membership row on every request and
 * hands the handler a database credential scoped by RLS. Fourteen used
 * getClientContextFromJWT + assertWorkspaceAccess, which is only this:
 *
 *     return context.workspaceId === workspaceId;
 *
 * A comparison against a claim inside a thirty-day token. That is enough to stop
 * one tenant reading another - the claim has to match the path - but it means
 * the role and the membership are whatever they were when the token was minted.
 * Remove someone from a workspace, or demote an editor to viewer, and on those
 * fourteen routes they kept their old access until the token expired. Several of
 * them wrote or sent.
 *
 * They also ran as service_role, which has rolbypassrls, so RLS was not a
 * backstop on a third of the surface.
 *
 * This test is the thing that keeps that closed. A new route written from an old
 * one as a template is the obvious way for the weaker pattern to come back, and
 * the failure is silent: the route works, and only revocation is broken.
 */

const CLIENTS_DIR = join(process.cwd(), "app/api/clients");

function routeFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) routeFiles(full, out);
    else if (entry === "route.ts") out.push(full);
  }
  return out;
}

describe("workspace routes", () => {
  const files = routeFiles(CLIENTS_DIR);

  it("finds the routes at all", () => {
    // Guards against the whole suite passing vacuously if the tree moves.
    expect(files.length).toBeGreaterThan(30);
  });

  it("all use withWorkspace", () => {
    const offenders = files
      .filter((f) => !readFileSync(f, "utf8").includes("withWorkspace"))
      .map((f) => f.slice(process.cwd().length + 1));

    expect(
      offenders,
      "These bypass the membership check, so a removed member keeps access " +
        "until their token expires:\n" + offenders.join("\n")
    ).toEqual([]);
  });

  it("none use the claim-only helper", () => {
    // assertWorkspaceAccess compares a token claim to a path segment and asks
    // the database nothing. It should have no callers left anywhere.
    const offenders = files
      .filter((f) => /assertWorkspaceAccess/.test(readFileSync(f, "utf8")))
      .map((f) => f.slice(process.cwd().length + 1));

    expect(offenders, `Still comparing claims instead of membership:\n${offenders.join("\n")}`)
      .toEqual([]);
  });

  it("declare a minRole on anything that writes", () => {
    // A write defaulting to "viewer" is a viewer who can write. Reads may omit
    // it - viewer is the correct floor there - but a mutation must say so.
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      const writes = /export const (POST|PATCH|PUT|DELETE) = withWorkspace/.test(src);
      if (writes && !src.includes("minRole")) {
        offenders.push(f.slice(process.cwd().length + 1));
      }
    }
    expect(offenders, `Mutating routes with no minRole:\n${offenders.join("\n")}`).toEqual([]);
  });
});
