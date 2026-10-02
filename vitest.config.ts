import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      // "server-only" throws outside an RSC bundler; stub it so server modules are unit-testable.
      "server-only": path.resolve(__dirname, "tests/stubs/server-only.ts"),
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: { environment: "node", include: ["tests/unit/**/*.test.ts"] },
});
