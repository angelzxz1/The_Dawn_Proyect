// The section lane: adding and naming markers, jumping to them (click,
// Shift+arrows), looping a section, and undo. An empty project is 120 BPM
// in 4/4, at 70 px a second: a bar is 2 s (140 px).

import { test, expect } from "./fixtures";
import type { Studio } from "./studio";

const BAR = 140;

const section = (studio: Studio, name: RegExp) => studio.markerLane.getByRole("button", { name });

/** Double-clicks the section lane at x (px) and names the new marker. */
async function addSection(studio: Studio, x: number, name?: string) {
  await studio.markerLane.dblclick({ position: { x, y: 8 } });
  const field = studio.page.getByLabel("Section name");
  if (name !== undefined) await field.fill(name);
  await field.press("Enter");
}

test("double-click the section lane to add a marker on the nearest bar, named like a song; it saves and undoes", async ({ studio }) => {
  await studio.open("Empty Project");
  await addSection(studio, 0.1 * BAR);
  await expect(section(studio, /^Intro, from 1\.1\.1/)).toBeVisible();
  // Just short of bar 3: the marker goes on bar 3, as the next part.
  await addSection(studio, 1.9 * BAR);
  await expect(section(studio, /^Verse, from 3\.1\.1/)).toBeVisible();
  await addSection(studio, 4 * BAR, "Hook");
  await expect(section(studio, /^Hook, from 5\.1\.1/)).toBeVisible();
  await expect.poll(async () => (await studio.autosavedTiming())?.markers).toEqual([
    { beat: 0, name: "Intro" },
    { beat: 8, name: "Verse" },
    { beat: 16, name: "Hook" },
  ]);

  await studio.undo();
  await expect(section(studio, /^Hook/)).toHaveCount(0);
  await expect(section(studio, /^Verse/)).toBeVisible();
});

test("click a marker to jump there; Shift+arrows go from one to the next; Shift+M adds one at the playhead", async ({ page, studio }) => {
  await studio.open("Empty Project");
  await addSection(studio, 2 * BAR);
  await addSection(studio, 6 * BAR);
  await section(studio, /^Verse/).click();
  await expect.poll(() => studio.playheadX()).toBeCloseTo(6 * BAR);
  await page.keyboard.press("Shift+ArrowLeft");
  await expect.poll(() => studio.playheadX()).toBeCloseTo(2 * BAR);
  // Nothing before the first: the playhead stays.
  await page.keyboard.press("Shift+ArrowLeft");
  await page.keyboard.press("Shift+ArrowRight");
  await expect.poll(() => studio.playheadX()).toBeCloseTo(6 * BAR);

  // A little past bar 4: Shift+M marks bar 4.
  await page.getByTitle(/^Click or drag to move the playhead/).click({ position: { x: 3 * BAR + 20, y: 10 } });
  await page.keyboard.press("Shift+M");
  await expect(section(studio, /^Chorus, from 4\.1\.1/)).toBeVisible();
});

test("right-click a marker to loop its section, rename it or remove it", async ({ page, studio }) => {
  await studio.open("Empty Project");
  await addSection(studio, 0);
  await addSection(studio, 2 * BAR);
  await addSection(studio, 6 * BAR);

  await section(studio, /^Verse/).click({ button: "right" });
  await page.getByRole("button", { name: "Loop Verse" }).click();
  await expect(page.getByLabel("Start", { exact: true })).toHaveValue("3.1.1");
  await expect(page.getByLabel("Length", { exact: true })).toHaveValue("4.0.0");
  await expect(page.getByRole("button", { name: "Loop", exact: true }).first()).toHaveAttribute("aria-pressed", "true");

  await section(studio, /^Verse/).click({ button: "right" });
  await page.getByRole("group", { name: "Name" }).getByRole("button", { name: "Bridge" }).click();
  await expect(section(studio, /^Bridge, from 3\.1\.1/)).toBeVisible();

  await section(studio, /^Bridge/).dblclick();
  await page.getByLabel("Section name").fill("Solo");
  await page.getByLabel("Section name").press("Enter");
  await expect(section(studio, /^Solo, from 3\.1\.1/)).toBeVisible();

  await section(studio, /^Solo/).click({ button: "right" });
  await page.getByRole("button", { name: "Remove marker" }).click();
  await expect(section(studio, /^Solo/)).toHaveCount(0);
  await expect(section(studio, /^Intro|^Chorus/)).toHaveCount(2);
});
