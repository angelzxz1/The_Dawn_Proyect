// The fonts come with the site (src/fonts/, scripts/fonts.mjs): every piece
// of text is drawn in a font that loaded - not in a fallback because a
// family name didn't match - and none of it comes from elsewhere.

import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

/** Families any text is set in, first choice, that didn't load. */
async function fontsNotLoaded(page: Page) {
  return page.evaluate(async () => {
    await document.fonts.ready;
    const loaded = new Set([...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family.replace(/["']/g, "").toLowerCase()));
    const used = new Set<string>();
    for (const el of document.querySelectorAll("body *")) {
      const hasText = [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent!.trim());
      if (hasText && el.checkVisibility()) used.add(getComputedStyle(el).fontFamily.split(",")[0].replace(/["']/g, "").trim());
    }
    const system = /^(serif|sans-serif|monospace|system-ui|ui-\w+|-apple-system|Arial|Helvetica|Georgia)$/i;
    return { used: [...used].sort(), missing: [...used].filter((f) => !system.test(f) && !loaded.has(f.toLowerCase())) };
  });
}

for (const path of ["/", "/features", "/faq"]) {
  test(`${path}: its text is set in the site's fonts`, async ({ page }) => {
    const fontRequests: string[] = [];
    page.on("request", (r) => {
      if (r.resourceType() === "font") fontRequests.push(r.url());
    });
    await page.goto(path);
    const { used, missing } = await fontsNotLoaded(page);
    expect(missing, `used: ${used.join(", ")}`).toEqual([]);
    expect(used.length).toBeGreaterThan(1);
    expect(fontRequests.filter((url) => !url.startsWith(new URL(page.url()).origin))).toEqual([]);
  });
}

test("the studio and an effect window are set in their fonts", async ({ page, studio }) => {
  await studio.open("Beat");
  await studio.select("Lead");
  await studio.addEffect("Compressor");
  await studio.openLastEffect();
  const { used, missing } = await fontsNotLoaded(page);
  expect(missing, `used: ${used.join(", ")}`).toEqual([]);
});
