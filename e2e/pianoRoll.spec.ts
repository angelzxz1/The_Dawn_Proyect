// The piano roll's view: the overview strip that scrolls and zooms it,
// following the playhead, and the keys staying in line with the notes.

import { test as base, expect } from "./fixtures";
import type { Page } from "@playwright/test";
import type { Studio } from "./studio";

// With scrollbars that take room, as on Windows: headless Chrome normally
// hides them, which would hide a scrollbar pushing the grid out of line.
const test = base.extend<object, object>({
  launchOptions: [async ({ launchOptions }, use) => use({ ...launchOptions, ignoreDefaultArgs: ["--hide-scrollbars"] }), { scope: "worker" }],
});

test.beforeEach(async ({ studio }) => {
  await studio.open("Beat");
});

/** Opens a track's first clip in the piano roll. */
async function openClip(page: Page, studio: Studio, track: string) {
  await studio.clipsOn(track).first().dblclick({ position: { x: 30, y: 50 } });
  const roll = page.getByRole("dialog", { name: `Piano Roll — ${track}` });
  await expect(roll).toBeVisible();
  const grid = page.locator("#piano-roll-grid");
  return {
    roll,
    grid,
    overview: roll.getByRole("scrollbar", { name: "Scroll and zoom the notes" }),
    ruler: roll.getByTitle(/^Click to place the insert marker/).locator(".."),
    scroll: () => grid.evaluate((el) => ({ left: el.scrollLeft, width: el.scrollWidth, view: el.clientWidth })),
  };
}

test("the keys stay in line with the notes, beside the grid's scrollbar", async ({ page, studio }) => {
  const { roll, grid, ruler } = await openClip(page, studio, "Bass");
  // A scrollbar up the side, none along the bottom.
  expect(await grid.evaluate((el) => (el as HTMLElement).offsetWidth - el.clientWidth)).toBeGreaterThan(0);
  expect(await grid.evaluate((el) => (el as HTMLElement).offsetHeight - el.clientHeight)).toBe(0);

  // Scrolled to the bottom, the lowest key ends where the grid does: no
  // scrollbar along the grid's bottom pushes them apart.
  await grid.evaluate((el) => (el.scrollTop = el.scrollHeight));
  const gridBox = (await grid.boundingBox())!;
  await expect
    .poll(async () => {
      const key = (await roll.getByTitle("C1", { exact: true }).boundingBox())!;
      return Math.round(key.y + key.height - (gridBox.y + gridBox.height));
    })
    .toBe(0);

  // Scrolled to the end, the ruler is too.
  await roll.getByTitle("Zoom in").click();
  await grid.evaluate((el) => (el.scrollLeft = el.scrollWidth));
  await expect.poll(() => ruler.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
  expect(await ruler.evaluate((el) => el.scrollLeft)).toBe(await grid.evaluate((el) => el.scrollLeft));
});

test("drag the overview's box to scroll, its edge to zoom; double-click shows the whole clip", async ({ page, studio }) => {
  const { overview, ruler, scroll } = await openClip(page, studio, "Bass");
  const box = overview.getByTitle("Drag to scroll", { exact: true });
  expect((await scroll()).left).toBe(0);

  await studio.drag(box, 150);
  await expect.poll(async () => (await scroll()).left).toBeGreaterThan(0);
  expect(await ruler.evaluate((el) => el.scrollLeft)).toBe((await scroll()).left);

  // Dragging the right edge in zooms in, and the box's left edge stays put.
  const before = await scroll();
  const boxLeft = (await box.boundingBox())!.x;
  await studio.drag(overview.getByTitle("Drag to zoom").nth(1), -60);
  await expect.poll(async () => (await scroll()).width).toBeGreaterThan(before.width);
  expect(Math.abs((await box.boundingBox())!.x - boxLeft)).toBeLessThan(2);

  await overview.dblclick({ position: { x: 5, y: 5 } });
  await expect.poll(async () => (await scroll()).width).toBeLessThanOrEqual((await scroll()).view + 1);
});

test("with Follow on, the view turns a page as the playhead runs off it; off, it stays put", async ({ page, studio }) => {
  // The drums' first clip starts at bar 1, where playing starts.
  const { roll, scroll } = await openClip(page, studio, "808 Drums");
  await roll.getByTitle("Zoom in").click();
  await roll.getByTitle("Zoom in").click();
  const follow = roll.getByRole("button", { name: "Follow" });
  await expect(follow).toHaveAttribute("aria-pressed", "true");

  await page.keyboard.press("Space");
  await expect.poll(async () => (await scroll()).left, { timeout: 6000 }).toBeGreaterThan(0);
  await page.keyboard.press("Space");

  await follow.click();
  await expect(follow).toHaveAttribute("aria-pressed", "false");
  await page.locator("#piano-roll-grid").evaluate((el) => (el.scrollLeft = 0));
  await page.keyboard.press("Space");
  await page.waitForTimeout(3500);
  expect((await scroll()).left).toBe(0);
  await page.keyboard.press("Space");
});

test("the Draw and Select buttons, and B, switch the mode", async ({ page, studio }) => {
  const { roll } = await openClip(page, studio, "Bass");
  const draw = roll.getByRole("button", { name: "Draw" });
  const select = roll.getByRole("button", { name: "Select" });
  await expect(draw).toHaveAttribute("aria-pressed", "true");
  await select.click();
  await expect(select).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("b");
  await expect(draw).toHaveAttribute("aria-pressed", "true");
});
