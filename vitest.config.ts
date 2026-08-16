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
      // Locked to the sustained level (actual ≈ 88 lines / 86 stmts / 86 funcs
      // / 82 branches) with ~6-10 points of headroom, so a small legitimate
      // dip won't fail CI but a real regression will.
      thresholds: {
        statements: 80,
        lines: 82,
        functions: 80,
        branches: 72,
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
