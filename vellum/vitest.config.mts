import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  // tsconfig sets jsx:"preserve" for Next, which would leave JSX untouched;
  // vitest imports .tsx component modules (render smoke tests), so force the
  // automatic runtime in vite's (oxc) transform for tests only.
  oxc: {
    jsx: { runtime: "automatic" },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
