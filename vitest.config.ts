import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "jsdom",
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.ts"],
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 60,
      },
    },
  },
  resolve: {
    // Resolve .ts before .js so the built main.js never shadows main.ts in tests.
    extensions: [".ts", ".mts", ".mjs", ".js", ".jsx", ".tsx", ".json"],
    alias: {
      "@": path.resolve(__dirname, "./src"),
      obsidian: path.resolve(__dirname, "./tests/mocks/obsidian.ts"),
    },
  },
});
