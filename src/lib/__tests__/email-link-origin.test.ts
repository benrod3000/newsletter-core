import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Every link in an outbound email must be built from the request host.
 *
 * `NEXT_PUBLIC_APP_URL` and `APP_URL` both point at the **frontend** on this
 * project, and the frontend rewrites `/(.*)` to index.html. So a link built
 * from either answers 200 with text/html rather than reaching a route, and
 * nothing anywhere errors:
 *
 *   - the open pixel returns the React app's HTML  -> no open recorded
 *   - a click link returns the React app           -> the recipient lands on the
 *                                                     dashboard instead of the
 *                                                     destination, no click recorded
 *   - List-Unsubscribe returns a page              -> one-click unsubscribe dead
 *
 * This shipped twice. It was found and fixed for emailed lead-magnet links, and
 * the warning was written into geo-utils.ts - but the unsafe helper was left in
 * place, so every campaign send path went on calling it and the first real
 * newsletter went out with all of the above. The helper is now deleted; this
 * test is what stops it being reintroduced, since the symptom is invisible from
 * the outside and no other test can see it.
 *
 * If you are adding a link a *human* opens in the dashboard - a password reset,
 * "go to dashboard" - APP_URL is correct and belongs in the allowlist below.
 */

const ROOT = process.cwd();

/** Routes whose APP_URL use is a genuine link to the frontend, not an API route. */
const ALLOWED = new Set([
  "app/api/auth/signup/route.ts",
  "app/api/auth/forgot-password/route.ts",
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry === "__tests__") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) out.push(full);
  }
  return out;
}

describe("outbound email links", () => {
  const files = [...walk(join(ROOT, "app")), ...walk(join(ROOT, "src"))];

  it("never build a baseUrl from APP_URL or NEXT_PUBLIC_APP_URL", () => {
    const offenders: string[] = [];

    for (const file of files) {
      const rel = file.slice(ROOT.length + 1);
      if (ALLOWED.has(rel)) continue;

      for (const [i, line] of readFileSync(file, "utf8").split("\n").entries()) {
        // Comments explaining the trap are the point, not a violation.
        const code = line.trim();
        if (code.startsWith("*") || code.startsWith("//") || code.startsWith("/*")) continue;
        if (/process\.env\.(NEXT_PUBLIC_)?APP_URL/.test(code)) {
          offenders.push(`${rel}:${i + 1}  ${code}`);
        }
      }
    }

    expect(offenders, `Use getApiBaseUrl(req) instead:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("does not reintroduce the getBaseUrl helper that preferred APP_URL", () => {
    const geoUtils = readFileSync(join(ROOT, "src/lib/geo-utils.ts"), "utf8");
    const exportsGetBaseUrl = /^export function getBaseUrl\b/m.test(geoUtils);
    expect(exportsGetBaseUrl).toBe(false);
  });
});
