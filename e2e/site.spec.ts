// The website: every page loads, and it leads into the studio.

import { test, expect } from "./fixtures";

const PAGES = ["/", "/features", "/how-it-works", "/faq", "/support", "/privacy", "/credits", "/license"];

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
