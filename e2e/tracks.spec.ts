// Each button and gesture on a track's header, checked by what it does.

import { test, expect } from "./fixtures";
import { toneWav } from "./wav";

test.beforeEach(async ({ studio }) => {
  await studio.open("Beat");
});

test("selecting a track shows its FX rack", async ({ studio }) => {
  await studio.select("Pad");
  await studio.select("Bass");
});

test("rename a track, and undo it", async ({ studio }) => {
  await studio.name("Pad").dblclick();
  const input = studio.header("Pad").getByRole("textbox");
  await input.fill("Pads");
  await input.press("Enter");
  await expect(studio.header("Pads")).toBeVisible();
  await studio.undo();
  await expect(studio.header("Pad")).toBeVisible();
});

test("recolor a track", async ({ page, studio }) => {
  const dot = studio.header("Lead").getByTitle("Change track color");
  const color = () => dot.evaluate((el) => getComputedStyle(el).backgroundColor);
  const before = await color();
  await dot.click();
  await page.getByTitle("Color 3", { exact: true }).click();
  await expect.poll(color).not.toBe(before);
});

test("move a track down and back up", async ({ studio }) => {
  await studio.header("Bass").getByTitle("Move track down").click();
  await expect(studio.trackNames).toHaveText(["808 Drums", "Pad", "Bass", "Lead"]);
  await studio.header("Bass").getByTitle("Move track up").click();
  await expect(studio.trackNames).toHaveText(["808 Drums", "Bass", "Pad", "Lead"]);
});

test("fold one track; Alt-click folds or unfolds them all", async ({ studio }) => {
  const height = (track: string) => studio.header(track).evaluate((el) => el.getBoundingClientRect().height);
  const full = await height("Lead");
  await studio.header("Lead").getByTitle(/^Fold/).click();
  await expect.poll(() => height("Lead")).toBeLessThan(full);
  await expect.poll(() => height("Bass")).toBe(full);

  await studio.header("Bass").getByTitle(/^Fold/).click({ modifiers: ["Alt"] });
  for (const track of ["808 Drums", "Bass", "Pad", "Lead"]) await expect.poll(() => height(track)).toBeLessThan(full);
  await studio.header("Bass").getByTitle(/^Unfold/).click({ modifiers: ["Alt"] });
  for (const track of ["808 Drums", "Bass", "Pad", "Lead"]) await expect.poll(() => height(track)).toBe(full);
});

test("mute and solo", async ({ studio }) => {
  const bass = studio.header("Bass");
  await bass.getByTitle("Mute", { exact: true }).click();
  await bass.getByTitle("Solo", { exact: true }).click();
  await expect(bass.getByTitle("Unmute", { exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(bass.getByTitle("Unsolo", { exact: true })).toHaveAttribute("aria-pressed", "true");
  await bass.getByTitle("Unmute", { exact: true }).click();
  await bass.getByTitle("Unsolo", { exact: true }).click();
  await expect(bass.getByTitle("Mute", { exact: true })).toHaveAttribute("aria-pressed", "false");
  await expect(bass.getByTitle("Solo", { exact: true })).toHaveAttribute("aria-pressed", "false");
});

test("arm a track for recording", async ({ page, studio }) => {
  await studio.header("Bass").getByTitle("Arm this channel for recording and note input").click();
  await expect(studio.header("Bass").getByTitle("Record-armed - click to disarm")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTitle("Record MIDI onto Bass")).toBeVisible();
});

test("monitor an audio track", async ({ studio }) => {
  await studio.addTrack("Audio");
  const audio = studio.header("Audio 1");
  await audio.getByTitle(/^Monitor - /).click();
  await audio.getByTitle(/^Monitoring - /).click();
  await expect(audio.getByTitle(/^Monitor - /)).toBeVisible();
});

test("an audio track's input list fills with the inputs when opened", async ({ studio }) => {
  await studio.addTrack("Audio");
  const inputs = studio.header("Audio 1").locator("select").first();
  await inputs.focus();
  // The fake microphone, besides the default.
  await expect.poll(() => inputs.locator("option").count()).toBeGreaterThan(1);
});

test("show and hide a track's automation lane", async ({ page, studio }) => {
  await studio.header("Bass").getByTitle("Show automation lane").click();
  // As wide as the tracks' lanes, so it doesn't stop partway once scrolled.
  const row = page.locator("[data-automation-lane]").locator("..");
  const width = async (l: typeof row) => (await l.boundingBox())!.width;
  expect(await width(row)).toBeCloseTo(await width(studio.lane("Bass")), 0);
  await studio.header("Bass").getByTitle("Hide automation lane").click();
  await expect(studio.header("Bass").getByTitle("Show automation lane")).toBeVisible();
});

test("pick two tracks and group them with Ctrl+G, and undo it", async ({ page, studio }) => {
  await studio.name("Pad").click({ modifiers: ["Control"] });
  await studio.name("Lead").click({ modifiers: ["Control"] });
  await page.keyboard.press("Control+g");
  await expect(studio.trackNames.filter({ hasText: /^Group/ })).toHaveCount(1);
  await studio.undo();
  await expect(studio.trackNames).toHaveText(["808 Drums", "Bass", "Pad", "Lead"]);
});

test("right-clicking a header opens its menu", async ({ page, studio }) => {
  await studio.name("Lead").click({ button: "right" });
  await expect(page.getByRole("button", { name: "Remove track" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Remove track" })).toBeHidden();
});

test("export a track's .mid and import it on another track", async ({ page, studio }, testInfo) => {
  const download = page.waitForEvent("download");
  await studio.header("Bass").getByTitle("Export .mid").click();
  const file = testInfo.outputPath("bass.mid");
  await (await download).saveAs(file);

  await studio.addTrack("MIDI");
  const clips = await studio.clips().count();
  await studio.header("MIDI 5").locator('input[type="file"][accept*=".mid"]').setInputFiles(file);
  await expect(studio.clips()).toHaveCount(clips + 1);
});

test("import an audio file from the header", async ({ studio }) => {
  await studio.addTrack("Audio");
  const clips = await studio.clips().count();
  await studio.header("Audio 1").locator('input[type="file"][accept="audio/*"]').setInputFiles({ name: "tone.wav", mimeType: "audio/wav", buffer: toneWav() });
  await expect(studio.clips("tone")).toHaveCount(1);
  await expect(studio.clips()).toHaveCount(clips + 1);
});

test("clear a track's clips, and undo it", async ({ studio }) => {
  const clips = await studio.clips().count();
  await studio.header("Lead").getByTitle("Clear all clips on this track").click();
  await expect.poll(() => studio.clips().count()).toBeLessThan(clips);
  await studio.undo();
  await expect(studio.clips()).toHaveCount(clips);
});

test("remove a track, and undo it", async ({ studio }) => {
  await studio.header("Lead").getByTitle("Remove channel").click();
  await expect(studio.trackNames).toHaveText(["808 Drums", "Bass", "Pad"]);
  await studio.undo();
  await expect(studio.trackNames).toHaveText(["808 Drums", "Bass", "Pad", "Lead"]);
});

test("the meter shows left and right apart: a track panned right shows only on the right", async ({ page, studio }) => {
  // The drums play from the first bar.
  const drums = studio.header("808 Drums");
  await drums.getByTitle("Solo", { exact: true }).click();
  const bar = (side: string) => drums.locator(`[title="${side}"] > div`).first();
  const level = async (side: string) => 1 - parseFloat((await bar(side).evaluate((el) => (el as HTMLElement).style.clipPath)).slice("inset(".length)) / 100;
  /** The highest each of the drums' meter bars reaches over 2 s of playing,
   * from silence. */
  const peaks = async () => {
    await expect.poll(async () => (await level("Left")) + (await level("Right"))).toBe(0);
    await page.evaluate(() => {
      const w = window as unknown as { __peaks: Record<string, number>; __raf: number };
      w.__peaks = { Left: 0, Right: 0 };
      const header = document.querySelector('[aria-label="Track 808 Drums"]')!;
      const tick = () => {
        for (const side of ["Left", "Right"]) {
          const fill = header.querySelector<HTMLElement>(`[title="${side}"] > div`)!;
          w.__peaks[side] = Math.max(w.__peaks[side], 1 - parseFloat(fill.style.clipPath.slice("inset(".length)) / 100);
        }
        w.__raf = requestAnimationFrame(tick);
      };
      tick();
    });
    await page.getByTitle(/^Click or drag to move the playhead/).click({ position: { x: 1, y: 10 } });
    await page.keyboard.press("Space");
    await page.waitForTimeout(2000);
    await page.getByTitle("Stop").click();
    return page.evaluate(() => {
      const w = window as unknown as { __peaks: Record<string, number>; __raf: number };
      cancelAnimationFrame(w.__raf);
      return w.__peaks;
    });
  };
  const pan = async (value: string) => {
    await drums.getByRole("slider", { name: "Pan" }).click();
    await drums.getByRole("textbox").fill(value);
    await drums.getByRole("textbox").press("Enter");
  };

  await pan("-1");
  const left = await peaks();
  expect(left.Left).toBeGreaterThan(0.005);
  expect(left.Right).toBeLessThan(0.001);

  await pan("1");
  const right = await peaks();
  expect(right.Right).toBeGreaterThan(0.005);
  expect(right.Left).toBeLessThan(0.001);
});
