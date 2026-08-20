/**
 * Error logging for the API.
 *
 * This module's docblock used to read: "To add Sentry: npm install
 * @sentry/nextjs + add SENTRY_DSN to Vercel env vars. Then replace the catch
 * below with: import * as Sentry from '@sentry/nextjs'". The first half was
 * done - the package is a dependency, `sentry.server.config.js` calls
 * Sentry.init(), and `instrumentation.ts` imports it at cold start. The second
 * half never was.
 *
 * So all 132 `logError()` call sites - every route's catch block, every cron
 * failure, every provider rejection - wrote to `console.error` and nowhere
 * else. On the Hobby plan the runtime logs API is not available, so those lines
 * are only visible by watching the dashboard as they happen. In practice that
 * means backend failures were unobservable: Sentry showed zero issues not
 * because nothing was failing, but because nothing was ever sent.
 *
 * Reporting is still conditional on SENTRY_DSN. Sentry.init() sets
 * `enabled: !!process.env.SENTRY_DSN`, and captureException on a disabled
 * client is a no-op, so local development and any environment without the
 * variable stay silent rather than erroring.
 */
import * as Sentry from "@sentry/nextjs";

/**
 * Log an error, and report it.
 *
 * `context` becomes Sentry `extra` rather than tags: these are high-cardinality
 * values (workspace ids, campaign ids, route names) and tags are indexed, so
 * putting them there would fragment grouping and burn the tag budget. The
 * fields worth grouping on are set as tags explicitly below.
 */
export function logError(err: unknown, context?: Record<string, unknown>) {
  console.error('[error]', err)
  if (context && Object.keys(context).length) console.error('  context:', context)

  Sentry.withScope((scope) => {
    if (context && Object.keys(context).length) {
      scope.setExtras(context)
      // `route` and `scope` are low-cardinality and are what you actually want
      // to group and filter by - "every failure in clients.campaigns.send"
      // is the question this data is collected to answer.
      if (typeof context.route === "string") scope.setTag("route", context.route)
      if (typeof context.scope === "string") scope.setTag("op", context.scope)
      if (typeof context.workspaceId === "string") scope.setTag("workspace_id", context.workspaceId)
    }

    // A non-Error reaches Sentry as "Non-Error exception captured" with no
    // stack and groups every such report together. Most callers here pass a
    // supabase-js error object, which is exactly that shape, so wrap it and
    // keep the original as context.
    if (err instanceof Error) {
      Sentry.captureException(err)
    } else {
      const message =
        typeof err === "object" && err !== null && "message" in err
          ? String((err as { message: unknown }).message)
          : String(err)
      scope.setExtra("originalError", err)
      Sentry.captureException(new Error(message))
    }
  })
}

/** Log an informational message */
export function logInfo(msg: string, context?: Record<string, unknown>) {
  console.log('[info]', msg)
  if (context && Object.keys(context).length) console.log('  context:', context)
}

/**
 * Log a warning.
 *
 * Console only, deliberately. Warnings here are things like "auto-clean skipped
 * this workspace", which are routine and would drown the error stream. Anything
 * that deserves attention should be a logError.
 */
export function logWarn(msg: string, context?: Record<string, unknown>) {
  console.warn('[warn]', msg)
  if (context && Object.keys(context).length) console.warn('  context:', context)
}
