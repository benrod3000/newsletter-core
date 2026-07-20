/**
 * Sentry instrumentation + activity log subscriber registration.
 * Runs once at cold start for Node.js runtime.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
    // Activate campaign activity log event subscribers
    await import("@/lib/events/activity-log");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    // Edge runtime doesn't support OTEL yet; errors are still captured
    // via the Next.js error boundary and sent from the client.
  }
}
