/**
 * Sentry instrumentation hook — registers OpenTelemetry instrumentation
 * for Next.js API routes and server-side operations.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    // Edge runtime doesn't support OTEL yet; errors are still captured
    // via the Next.js error boundary and sent from the client.
  }
}
