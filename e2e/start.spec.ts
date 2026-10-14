// The start screen: the templates, the first visit's tour, the demo song.

import { existsSync } from "node:fs";
import { test, expect } from "./fixtures";
import { templateTracks, type TemplateName } from "./studio";

const TEMPLATES: TemplateName[] = ["Guitar Demo", "Beat", "Voice + Guitar", "Empty Project"];

for (const template of TEMPLATES) {
  test(`the ${template} template opens with its tracks`, async ({ studio }) => {
    await studio.open(template);
    expect(await studio.trackNames.allInnerTexts()).toEqual(templateTracks(template));
  });
}

test.describe("a first visit", () => {
  test.use({ firstVisit: true });

  test("welcomes, then tours the studio after a template is picked", async ({ page }) => {
    await page.goto("/app");
    const start = page.getByRole("dialog", { name: "Start" });
    await expect(start.getByRole("heading", { name: "Welcome to The Dawn Project" })).toBeVisible();
    await start.getByRole("button", { name: /^Beat/ }).click();
    for (let step = 1; step <= 4; step++) {
      const tour = page.getByRole("dialog", { name: new RegExp(`^Tour, step ${step} of 4`) });
      await expect(tour).toBeVisible();
      await tour.getByRole("button", { name: step < 4 ? "Next" : "Start making music" }).click();
    }
    await expect(page.getByRole("dialog", { name: /^Tour/ })).toBeHidden();
  });
});

test("coming back reopens the project as it was left, without the start screen", async ({ page, studio }) => {
  await studio.open("Beat");
  await expect.poll(() => studio.autosavedTracks()).toEqual(templateTracks("Beat"));
  await page.reload();
  await expect(studio.trackNames).toHaveText(templateTracks("Beat"));
  await expect(page.getByRole("dialog", { name: "Start" })).toHaveCount(0);
});

test("File → New offers the templates again", async ({ page, studio }) => {
  await studio.open("Beat");
  page.on("dialog", (d) => void d.accept());
  await studio.fileMenu(/^New Project/);
  const start = page.getByRole("dialog", { name: "Start" });
  await expect(start.getByRole("heading", { name: "New project" })).toBeVisible();
  await start.getByRole("button", { name: /^Empty Project/ }).click();
  await expect(studio.trackNames).toHaveText(templateTracks("Empty Project"));
});

// Whether there's a demo song is decided when the site is built (from
// public/demo/demo-song.dawnproject, see docs/deploy.md).
const hasDemoSong = existsSync("out/demo/demo-song.dawnproject");

test.describe("the demo song", () => {
  test("isn't offered when the build has none", async ({ page }) => {
    test.skip(hasDemoSong, "this build has a demo song");
    await page.goto("/app");
    const start = page.getByRole("dialog", { name: "Start" });
    await expect(start.getByRole("button", { name: /^Empty Project/ })).toBeVisible();
    await expect(start.getByText("Hear what Dawn can do")).toHaveCount(0);
  });

  test("opens from the start screen", async ({ page }) => {
    test.skip(!hasDemoSong, "this build has no demo song");
    await page.goto("/app");
    await page.getByRole("button", { name: "Listen to the demo song" }).click();
    await expect(page.getByRole("dialog", { name: "Start" })).toBeHidden();
    await expect(page.getByTitle("Pause (Space)")).toBeVisible();
  });
});
