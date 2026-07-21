import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Integration tests need a running server — exclude them from `npm test`
    exclude: ["src/**/*.integration.test.ts"],
  },
});
