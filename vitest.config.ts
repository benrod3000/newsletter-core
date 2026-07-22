import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      // Mirrors the "@/*" -> "./src/*" mapping in tsconfig.json. Without it,
      // any module importing through the alias fails to resolve under vitest,
      // which is what made route handlers untestable.
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Integration tests need a running server — exclude them from `npm test`
    exclude: ["src/**/*.integration.test.ts"],
  },
});
