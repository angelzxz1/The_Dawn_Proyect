import { defineConfig } from "vitest/config";

// The unit tests live next to the code in src/; e2e/ holds the browser
// tests, which Playwright runs (playwright.config.ts).
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});
