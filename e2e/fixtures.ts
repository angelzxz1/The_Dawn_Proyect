// What every browser test starts from: the studio's first-visit tour
// already seen (unless a test asks for a first visit), nothing loaded from
// outside the site (so no test depends on the network - the piano's
// samples, which come from elsewhere, just don't load), and no error on the
// page: an uncaught exception or a console error fails the test.

import { test as base, expect, type ConsoleMessage } from "@playwright/test";
import { Studio } from "./studio";

export { expect };

interface Fixtures {
  /** The studio, through its UI (studio.ts). */
  studio: Studio;
  /** Errors the test expects; anything else on the console fails it. */
  allowErrors: (pattern: RegExp) => void;
}

interface Options {
  /** Open the app as a first-time visitor: the tour and the demo song. */
  firstVisit: boolean;
}

export const test = base.extend<Fixtures & Options>({
  firstVisit: [false, { option: true }],

  context: async ({ context, baseURL, firstVisit }, use) => {
    const origin = new URL(baseURL!).origin;
    await context.route(
      (url) => url.origin !== origin,
      (route) => route.abort()
    );
    if (!firstVisit) await context.addInitScript(() => localStorage.setItem("dawn.tourDone", "1"));
    await use(context);
  },

  allowErrors: [
    async ({ page, baseURL }, use) => {
      const origin = new URL(baseURL!).origin;
      const allowed: RegExp[] = [];
      const errors: string[] = [];
      // A request to another site, refused above, isn't the app's error.
      const refused = (m: ConsoleMessage) => m.text().startsWith("Failed to load resource") && !m.location().url.startsWith(origin);
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("console", (m) => {
        if (m.type() === "error" && !refused(m)) errors.push(m.text());
      });
      await use((pattern) => allowed.push(pattern));
      expect(errors.filter((e) => !allowed.some((p) => p.test(e))), "errors on the page").toEqual([]);
    },
    { auto: true },
  ],

  studio: async ({ page }, use) => {
    await use(new Studio(page));
  },
});
