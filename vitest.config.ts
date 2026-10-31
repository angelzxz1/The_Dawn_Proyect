import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

// Three kinds of tests live next to the code in src/:
// - unit tests (*.test.ts), run in Node;
// - component tests (*.test.tsx), which draw a component on its own in
//   Chromium (Vitest's browser mode, through Playwright) with the app's
//   styles, so layout, pointer events and scrolling are the real ones;
// - Web Audio tests (*.webaudio.test.ts), which render through the
//   browser's own audio nodes in Chromium (src/test/webAudioParity.ts).
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
        test: { name: "unit", include: ["src/**/*.test.ts"], exclude: [...configDefaults.exclude, "src/**/*.webaudio.test.ts"] },
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
          // Every click and check is a round trip to Chromium, so a test
          // that takes a second alone can take several on a busy machine.
          testTimeout: 30_000,
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
      {
        extends: true,
        test: {
          name: "web-audio",
          include: ["src/**/*.webaudio.test.ts"],
          // UPDATE_ENGINE_FIXTURES=1 rewrites the Rust parity fixtures.
          provide: { updateEngineFixtures: process.env.UPDATE_ENGINE_FIXTURES === "1" },
          browser: {
            enabled: true,
            provider: "playwright",
            headless: true,
            screenshotFailures: false,
            instances: [{ browser: "chromium" }],
          },
        },
      },
    ],
  },
});
