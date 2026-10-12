import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Two kinds of tests live next to the code in src/:
// - unit tests (*.test.ts), run in Node;
// - component tests (*.test.tsx), which draw a component on its own in
//   Chromium (Vitest's browser mode, through Playwright) with the app's
//   styles, so layout, pointer events and scrolling are the real ones.
// e2e/ holds the browser tests of the whole site, which Playwright runs
// (playwright.config.ts).
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    projects: [
      {
        extends: true,
        test: { name: "unit", include: ["src/**/*.test.ts"] },
      },
      {
        extends: true,
        // Next makes the fonts when it builds the app; here they're stand-ins
        // (src/test/nextFontLocal.ts).
        resolve: {
          alias: { "next/font/local": fileURLToPath(new URL("./src/test/nextFontLocal.ts", import.meta.url)) },
        },
        test: {
          name: "components",
          include: ["src/**/*.test.tsx"],
          setupFiles: ["src/test/componentSetup.ts"],
          browser: {
            enabled: true,
            provider: "playwright",
            headless: true,
            screenshotFailures: false,
            // The studio is laid out for a desktop screen.
            viewport: { width: 1600, height: 1000 },
            instances: [{ browser: "chromium" }],
          },
        },
      },
    ],
  },
});
