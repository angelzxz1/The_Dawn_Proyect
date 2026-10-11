import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

// The browser tests (e2e/) run against the built site in out/, served the
// way it's hosted, so they test what ships. Build it first:
//   npm run build && npm run test:e2e

const PORT = 3123;

if (!existsSync("out/app.html")) {
  throw new Error("There's no build in out/ to test. Run `npm run build` first.");
}

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: `http://localhost:${PORT}`,
    // The studio is laid out for a 1080p screen.
    viewport: { width: 1920, height: 1000 },
    // A fake microphone (a tone), allowed without asking; audio may start
    // without a click.
    permissions: ["microphone"],
    launchOptions: {
      args: ["--autoplay-policy=no-user-gesture-required", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
    },
    acceptDownloads: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: `npx --yes serve out -l ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
  },
});
