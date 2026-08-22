/**
 * Every path that is invoked by a scheduler rather than by a person.
 *
 * These sit under /api/admin, which proxy.ts guards with Basic Auth, but a
 * scheduler sends `Authorization: Bearer <CRON_SECRET>` - not Basic - so the
 * middleware must let them through to the route, where requireCronSecret()
 * checks the bearer token in constant time. Exempting them from Basic Auth does
 * not make them public; it moves the check one layer in.
 *
 * This list was three hand-written conditions in proxy.ts, and
 * /api/admin/campaigns/recover was not among them. So the middleware answered
 * it with a 401 and a WWW-Authenticate header before the handler ever ran:
 *
 *   /api/admin/campaigns/process  -> {"error":"Unauthorized."}   (route, correct)
 *   /api/admin/campaigns/recover  -> Authentication required.    (middleware, wrong)
 *
 * Recovery is the job that finishes a send whose drain ran out of time, so the
 * one cron that exists to stop partial sends being lost had never run - and
 * could not have, since the day it was added. Nothing reported it, because a
 * cron that 401s is indistinguishable from a cron with nothing to do.
 *
 * Kept as data, and cross-checked against vercel.json by
 * src/lib/__tests__/cron-paths.test.ts, so adding a cron to the schedule without
 * adding it here fails a test instead of silently never running.
 */
export const CRON_PATHS = [
  "/api/admin/campaigns/process",
  "/api/admin/campaigns/recover",
  "/api/admin/health-scores/recalculate",
  "/api/admin/automations/process",
  "/api/admin/automations/confirm-remind/run",
  "/api/admin/automations/auto-clean/run",
  "/api/admin/automations/smart-tags/run",
] as const;

export function isCronPath(pathname: string): boolean {
  return (CRON_PATHS as readonly string[]).includes(pathname);
}
