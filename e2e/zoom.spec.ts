// Zooming the arrangement: Ctrl/Cmd+wheel (and a trackpad pinch, which
// comes as one) around the pointer, the buttons and keys, zoom to fit;
// and making tracks taller or shorter. An empty project starts at 70 px a
// second, 120 BPM: bar 3 is at 4 s.

import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";
import type { Studio } from "./studio";

const ruler = (page: Page) => page.getByTitle(/^Click or drag to move the playhead/);
const lanes = (page: Page) => page.locator("#arrangement-lanes");

/** Where bar `n`'s line is on screen (px from the lanes' left). */
async function barOnScreen(page: Page, n: number): Promise<number> {
  const mark = ruler(page).locator("div", { has: page.getByText(String(n), { exact: true }) }).first();
  const [box, view] = await Promise.all([mark.boundingBox(), lanes(page).boundingBox()]);
  return box!.x - view!.x;
}

/** How wide a bar is drawn (px). */
async function barWidth(page: Page): Promise<number> {
  return (await barOnScreen(page, 3)) - (await barOnScreen(page, 2));
}

test("Ctrl+wheel zooms around the pointer; the buttons and the = and - keys zoom too", async ({ page, studio }) => {
  await studio.open("Empty Project");
  expect(await barWidth(page)).toBeCloseTo(140, 0);
  const view = (await lanes(page).boundingBox())!;
  // The pointer on bar 3 (4 s): zooming in keeps it there.
  await page.mouse.move(view.x + 280, view.y + 40);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -100);
  await page.keyboard.up("Control");
  await expect.poll(() => barWidth(page)).toBeGreaterThan(190);
  expect(Math.abs((await barOnScreen(page, 3)) - 280)).toBeLessThan(2);

  const before = await barWidth(page);
  await page.keyboard.press("=");
  await expect.poll(() => barWidth(page)).toBeCloseTo(before * 1.25, 0);
  await page.keyboard.press("-");
  await page.keyboard.press("-");
  await expect.poll(() => barWidth(page)).toBeCloseTo(before / 1.25, 0);
  await page.getByTitle(/^Zoom in/).click();
  await expect.poll(() => barWidth(page)).toBeCloseTo(before, 0);
  // Wheel without Ctrl still scrolls, and doesn't zoom.
  await page.mouse.wheel(0, 100);
  expect(await barWidth(page)).toBeCloseTo(before, 0);
});

test("zoom to fit: the time selection, else the whole song", async ({ page, studio }) => {
  await studio.open("Empty Project");
  const view = (await lanes(page).boundingBox())!;
  // Select bars 2 to 3 (2 s to 6 s) on MIDI 1.
  const lane = (await studio.lane("MIDI 1").boundingBox())!;
  await page.mouse.move(lane.x + 150, lane.y + 40);
  await page.mouse.down();
  await page.mouse.move(lane.x + 410, lane.y + 40, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator("[data-time-selection]").first()).toBeVisible();
  await page.keyboard.press("Shift+Z");
  // The two bars fill the view, a little room either side.
  await expect.poll(() => barOnScreen(page, 2)).toBeLessThan(60);
  expect(await barOnScreen(page, 2)).toBeGreaterThan(10);
  expect(view.width - (await barOnScreen(page, 4))).toBeLessThan(60);
  expect(view.width - (await barOnScreen(page, 4))).toBeGreaterThan(10);

  // With no selection: the whole song (four bars, empty).
  await page.keyboard.press("Escape");
  await page.getByTitle(/^Zoom to fit/).click();
  await expect.poll(() => barOnScreen(page, 1)).toBeLessThan(60);
  expect(view.width - (await barOnScreen(page, 5))).toBeLessThan(60);
});

test("zoomed far out, the ruler shows every few bars", async ({ page, studio }) => {
  await studio.open("Empty Project");
  // 70 px a second down to 2, a step at a time.
  for (let i = 0; i < 16; i++) await page.keyboard.press("-");
  // At its widest: bar 1 and then every 8th or so.
  await expect(ruler(page).getByText("2", { exact: true })).toHaveCount(0);
  await expect(ruler(page).getByText("1", { exact: true })).toBeVisible();
  await expect(page.getByTitle(/^Zoom out/)).toBeDisabled();
});

const height = async (studio: Studio, track: string) => (await studio.lane(track).boundingBox())!.height;

async function dragEdge(page: Page, studio: Studio, track: string, dy: number, alt = false) {
  const edge = studio.header(track).getByRole("separator", { name: "Track height" });
  const box = (await edge.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  if (alt) await page.keyboard.down("Alt");
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + dy, { steps: 6 });
  await page.mouse.up();
  if (alt) await page.keyboard.up("Alt");
}

test("drag a track's bottom edge to resize it (Alt: every track), double-click it for the standard height; kept after a reload", async ({ page, studio }) => {
  await studio.open("Empty Project");
  expect(await height(studio, "MIDI 1")).toBeCloseTo(118, 0);
  await dragEdge(page, studio, "MIDI 1", 80);
  await expect.poll(() => height(studio, "MIDI 1")).toBeCloseTo(198, 0);
  expect(await height(studio, "MIDI 2")).toBeCloseTo(118, 0);

  // Every track, as short as MIDI 2 is dragged to: the header keeps the
  // rows that fit.
  await dragEdge(page, studio, "MIDI 2", -50, true);
  for (const track of ["MIDI 1", "MIDI 2", "Audio 1"]) await expect.poll(() => height(studio, track)).toBeCloseTo(68, 0);
  await expect(studio.header("MIDI 1").getByRole("slider", { name: "Vol" })).toHaveCount(0);
  await expect(studio.header("MIDI 1").getByTitle("Mute", { exact: true })).toBeVisible();

  await studio.header("MIDI 1").getByRole("separator", { name: "Track height" }).dblclick();
  await expect.poll(() => height(studio, "MIDI 1")).toBeCloseTo(118, 0);

  await expect.poll(() => studio.autosavedHeights()).toEqual({ "MIDI 1": undefined, "MIDI 2": 68, "Audio 1": 68 });
  await page.reload();
  await expect(studio.trackNames.first()).toBeVisible();
  await expect.poll(() => height(studio, "MIDI 1")).toBeCloseTo(118, 0);
  expect(await height(studio, "MIDI 2")).toBeCloseTo(68, 0);
});

test("Alt+wheel makes every track taller or shorter", async ({ page, studio }) => {
  await studio.open("Empty Project");
  const lane = (await studio.lane("MIDI 1").boundingBox())!;
  await page.mouse.move(lane.x + 100, lane.y + 40);
  await page.keyboard.down("Alt");
  await page.mouse.wheel(0, -100);
  await page.keyboard.up("Alt");
  await expect.poll(() => height(studio, "MIDI 1")).toBeGreaterThan(150);
  expect(await height(studio, "MIDI 2")).toBeCloseTo(await height(studio, "MIDI 1"), 0);
});
