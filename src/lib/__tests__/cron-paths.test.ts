import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { CRON_PATHS, isCronPath } from "../cron-paths";

/**
 * Every scheduled path must be exempt from Basic Auth, and must exist.
 *
 * proxy.ts guards /api/admin with Basic Auth. A scheduler sends
 * `Authorization: Bearer <CRON_SECRET>`, so the middleware has to let cron paths
 * through to the handler, which checks the bearer token itself.
 *
 * That exemption was three hand-written conditions and
 * /api/admin/campaigns/recover was not one of them, so the middleware answered
 * it with a Basic-Auth challenge and the handler never ran. Verified against
 * production: process returned the route's own {"error":"Unauthorized."} for a
 * bad token, recover returned "Authentication required." with a
 * WWW-Authenticate header - a different layer, a different failure.
 *
 * Recovery is what finishes a send whose drain ran out of time. So the single
 * mechanism protecting against partial sends had never executed, and nothing
 * said so: a cron that 401s produces exactly the same silence as a cron with
 * nothing to do.
 *
 * These tests tie the list to vercel.json in both directions, because either
 * kind of drift is invisible at runtime.
 */

const ROOT = process.cwd();

function scheduledPaths(): string[] {
  const vercelJson = JSON.parse(readFileSync(join(ROOT, "vercel.json"), "utf8"));
  return (vercelJson.crons ?? []).map((c: { path: string }) => c.path);
}

describe("cron paths", () => {
  it("exempts every cron declared in vercel.json", () => {
    const missing = scheduledPaths().filter((p) => !isCronPath(p));
    expect(
      missing,
      `Scheduled but still behind Basic Auth, so it cannot run:\n${missing.join("\n")}`
    ).toEqual([]);
  });

  it("does not exempt a path that is not scheduled", () => {
    // The exemption is a hole in the admin guard. It should be exactly the size
    // of the set of things that need it, and no larger.
    const scheduled = new Set(scheduledPaths());
    const extra = CRON_PATHS.filter((p) => !scheduled.has(p));
    expect(
      extra,
      `Exempt from Basic Auth but not scheduled - remove, or add to vercel.json:\n${extra.join("\n")}`
    ).toEqual([]);
  });

  it("points at routes that exist", () => {
    // A typo here fails open in the worst way: the path is not exempt, so the
    // cron 401s, and the list still looks correct.
    const missing = CRON_PATHS.filter(
      (p) => !existsSync(join(ROOT, "app", `${p.replace(/^\//, "")}`, "route.ts"))
    );
    expect(missing, `No route.ts for:\n${missing.join("\n")}`).toEqual([]);
  });

  it("only exempts paths under the admin guard", () => {
    // Exempting something outside /api/admin would be meaningless at best and
    // misleading at worst - it would imply a guard that was never there.
    for (const p of CRON_PATHS) expect(p.startsWith("/api/admin/")).toBe(true);
  });
});
