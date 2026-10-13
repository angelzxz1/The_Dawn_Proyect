// The arrangement's edit tools: picking one, and what each does to clips.

import { test, expect } from "./fixtures";
import type { Locator, Page } from "@playwright/test";

const tool = (page: Page, name: string) => page.getByRole("group", { name: "Edit tool" }).getByRole("button", { name, exact: true });

/** Drags with the mouse across `target`, from x to x + dx (px from its left). */
async function dragAcross(page: Page, target: Locator, x: number, dx: number) {
  const box = (await target.boundingBox())!;
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + x, y);
  await page.mouse.down();
  await page.mouse.move(box.x + x + dx, y, { steps: 8 });
  await page.mouse.up();
}

test("Shift+2 picks the split tool, Esc goes back to the pointer", async ({ page, studio }) => {
  await studio.open("Beat");
  await expect(tool(page, "Pointer")).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Shift+2");
  await expect(tool(page, "Split")).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Shift+4");
  await expect(tool(page, "Erase")).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await expect(tool(page, "Pointer")).toHaveAttribute("aria-pressed", "true");
});

test("split: a click on a clip cuts it in two there", async ({ page, studio }) => {
  await studio.open("Beat");
  await tool(page, "Split").click();
  await studio.clipsOn("Bass").first().click({ position: { x: 200, y: 50 } });
  await expect(studio.clipsOn("Bass")).toHaveCount(2);
  await studio.undo();
  await expect(studio.clipsOn("Bass")).toHaveCount(1);
});

test("draw: a drag on an empty MIDI lane draws a clip, a click a one-bar one; not on an audio lane", async ({ page, studio }) => {
  await studio.open("Empty Project");
  await tool(page, "Draw").click();
  await dragAcross(page, studio.lane("MIDI 1"), 20, 300);
  await expect(studio.clipsOn("MIDI 1")).toHaveCount(1);
  await expect(studio.clipsOn("MIDI 1").first()).toHaveClass(/ring-2/);

  await studio.lane("MIDI 2").click({ position: { x: 40, y: 40 } });
  await expect(studio.clipsOn("MIDI 2")).toHaveCount(1);
  // A click draws one bar; the drag drew whole bars (the grid is bars).
  const bar = (await studio.clipsOn("MIDI 2").first().boundingBox())!.width;
  const drawn = (await studio.clipsOn("MIDI 1").first().boundingBox())!.width;
  expect(drawn / bar).toBeGreaterThan(1.5);
  expect(drawn / bar).toBeCloseTo(Math.round(drawn / bar), 1);

  await studio.lane("Audio 1").click({ position: { x: 40, y: 40 } });
  await expect(studio.clipsOn("Audio 1")).toHaveCount(0);
});

test("erase: a click deletes a clip; a drag across clips deletes them all, as one undo step", async ({ page, studio }) => {
  await studio.open("Beat");
  const drums = await studio.clipsOn("808 Drums").count();
  await tool(page, "Erase").click();
  await studio.clipsOn("808 Drums").first().click();
  await expect(studio.clipsOn("808 Drums")).toHaveCount(drums - 1);

  // From the Bass clip down across the Pad's, both at bar 3.
  const bass = (await studio.clipsOn("Bass").first().boundingBox())!;
  const pad = (await studio.clipsOn("Pad").first().boundingBox())!;
  await page.mouse.move(bass.x + 30, bass.y + bass.height / 2);
  await page.mouse.down();
  await page.mouse.move(pad.x + 30, pad.y + pad.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(studio.clipsOn("Bass")).toHaveCount(0);
  await expect(studio.clipsOn("Pad")).toHaveCount(0);

  await studio.undo();
  await expect(studio.clipsOn("Bass")).toHaveCount(1);
  await expect(studio.clipsOn("Pad")).toHaveCount(1);
  await expect(studio.clipsOn("808 Drums")).toHaveCount(drums - 1);
});

test("slip: a drag inside a clip slides its notes, and the clip stays where it is", async ({ page, studio }) => {
  await studio.open("Beat");
  const clip = studio.clipsOn("Bass").first();
  const box = (await clip.boundingBox())!;
  const firstNote = () => clip.locator(".h-\\[2px\\]").first().evaluate((el) => (el as HTMLElement).style.left);
  const before = await firstNote();

  await tool(page, "Slip").click();
  await dragAcross(page, clip, 60, 120);
  await expect.poll(firstNote).not.toBe(before);
  expect((await clip.boundingBox())!.x).toBe(box.x);

  await studio.undo();
  await expect.poll(firstNote).toBe(before);
});
