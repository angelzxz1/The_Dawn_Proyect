// The transport: play, pause and stop, tempo, time signature, loop.

import { test, expect } from "./fixtures";

test.beforeEach(async ({ studio }) => {
  await studio.open("Beat");
});

test("the BPM field clamps an out-of-range tempo, and the change undoes", async ({ studio }) => {
  const enter = async (value: string) => {
    await studio.bpm.fill(value);
    await studio.bpm.press("Enter");
  };
  await enter("400");
  await expect(studio.bpm).toHaveValue("300");
  // The same out-of-range value again still shows the clamped one.
  await enter("400");
  await expect(studio.bpm).toHaveValue("300");
  await enter("90");
  await expect(studio.bpm).toHaveValue("90");
  await studio.undo();
  await expect(studio.bpm).toHaveValue("300");
});

test("the time signature refuses 0 beats a bar and takes 3", async ({ page }) => {
  const beats = page.locator('label:has-text("Time sig.") input');
  await beats.fill("0");
  await beats.press("Enter");
  await expect(beats).toHaveValue("4");
  await beats.fill("3");
  await beats.press("Enter");
  await expect(beats).toHaveValue("3");
});

test("Space plays and Stop goes back to where playing started", async ({ page }) => {
  const playhead = () => page.getByTestId("playhead").evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).m41);
  await page.getByTitle(/^Click or drag to move the playhead/).click({ position: { x: 200, y: 10 } });
  await expect.poll(playhead).toBeGreaterThan(0);
  const start = await playhead();

  await page.keyboard.press("Space");
  await expect(page.getByTitle("Pause (Space)")).toBeVisible();
  await expect.poll(playhead).toBeGreaterThan(start + 20);

  await page.getByTitle("Stop").click();
  await expect(page.getByTitle("Play (Space)")).toBeVisible();
  await expect.poll(playhead).toBeCloseTo(start, 0);
});

test("Ctrl+L and the loop button switch the loop", async ({ page }) => {
  const loop = page.getByTitle("Toggle looping the region set by shift-dragging the ruler");
  await expect(loop).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Control+l");
  await expect(loop).toHaveAttribute("aria-pressed", "false");
  await loop.click();
  await expect(loop).toHaveAttribute("aria-pressed", "true");
});

test("the metronome button switches the metronome", async ({ page }) => {
  const metronome = page.getByTitle("Metronome");
  const before = await metronome.getAttribute("aria-pressed");
  await metronome.click();
  await expect(metronome).not.toHaveAttribute("aria-pressed", before!);
});
