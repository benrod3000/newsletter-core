import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // Allow /embed to be iframed from any origin
        source: "/embed",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors *" },
        ],
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  // Upload source maps on build
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  silent: !process.env.CI,
  widenClientFileUpload: true,
  // Don't upload source maps for node_modules
  reactComponentAnnotation: { enabled: true },
  // Hide source maps in production
  hideSourceMaps: true,
  // Disable tunnel for now
  disableLogger: true,
  // Automatically tree-shake Sentry logger statements
  automaticVercelMonitors: true,
});
