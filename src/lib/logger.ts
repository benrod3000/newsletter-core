/**
 * Lightweight logger with optional Sentry integration.
 * Works out of the box - degrades to console.
 * To add Sentry: npm install @sentry/nextjs + add SENTRY_DSN to Vercel env vars.
 * Then replace the catch below with: import * as Sentry from '@sentry/nextjs'
 */

/** Log an error - always console, also Sentry if configured */
export function logError(err: unknown, context?: Record<string, unknown>) {
  console.error('[error]', err)
  if (context && Object.keys(context).length) console.error('  context:', context)
}

/** Log an informational message */
export function logInfo(msg: string, context?: Record<string, unknown>) {
  console.log('[info]', msg)
  if (context && Object.keys(context).length) console.log('  context:', context)
}

/** Log a warning */
export function logWarn(msg: string, context?: Record<string, unknown>) {
  console.warn('[warn]', msg)
  if (context && Object.keys(context).length) console.warn('  context:', context)
}
