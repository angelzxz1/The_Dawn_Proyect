// The website: every page loads, and it leads into the studio.

import { test, expect } from "./fixtures";

const PAGES = ["/", "/features", "/how-it-works", "/guides", "/guides/daybreak", "/faq", "/support", "/privacy", "/credits", "/license"];

for (const path of PAGES) {
  test(`${path} loads`, async ({ page }) => {
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    await expect(page.locator("h1").first()).not.toBeEmpty();
  });
}

test("an unknown address shows the not-found page", async ({ page, allowErrors }) => {
  allowErrors(/404/);
  const response = await page.goto("/no-such-page");
  expect(response?.status()).toBe(404);
  await expect(page.locator("h1")).toHaveText("This page isn’t here.");
});

test("Open Dawn leads to the studio", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: /Open Dawn/ }).first().click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole("dialog", { name: "Start" })).toBeVisible();
});

test("no page links to or mentions GitHub: feedback goes to the Discord", async ({ page }) => {
  for (const path of PAGES) {
    await page.goto(path);
    await expect(page.locator('a[href*="github"]'), path).toHaveCount(0);
    expect(await page.locator("body").innerText(), path).not.toMatch(/github/i);
  }
});

test("the studio's About window doesn't mention GitHub either", async ({ page, studio }) => {
  await studio.open();
  await page.getByRole("button", { name: "About", exact: true }).click();
  const about = page.getByRole("dialog", { name: "About The Dawn Project" });
  for (const tab of ["About", "What's new", "Credits", "Privacy", "License"]) {
    await about.getByRole("tab", { name: tab }).click();
    await expect(about.locator('a[href*="github"]'), tab).toHaveCount(0);
    expect(await about.innerText(), tab).not.toMatch(/github/i);
  }
});

test("the credits thank the members, Producers first, before the software", async ({ page }) => {
  await page.goto("/credits");
  const top = async (name: string) => (await page.getByRole("region", { name }).boundingBox())!.y;
  const producers = await top("Producers");
  const supporters = await top("Supporters");
  const software = (await page.getByRole("heading", { name: "Software", exact: true }).boundingBox())!.y;
  expect(producers).toBeLessThan(supporters);
  expect(supporters).toBeLessThan(software);
});
