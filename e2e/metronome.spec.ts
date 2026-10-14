// The metronome, checked by ear: what reaches the speakers is tapped and
// each click timed to the sample (speakers.ts). Clicks are made on the
// audio thread, so they should land within a sample or two of the beat.

import { test as base, expect } from "./fixtures";
import { gaps, listen, wireSpeakers, type Ear } from "./speakers";
import type { Page } from "@playwright/test";

/** Within 1.5 ms. */
const onBeat = (gap: number, beat: number) => Math.abs(gap - beat) < 0.0015;

/** An empty project at 120 BPM with the metronome on, listened to. */
const test = base.extend<{ ear: Ear }>({
  ear: async ({ page, studio }, use) => {
    await wireSpeakers(page);
    await studio.open("Empty Project");
    await page.getByTitle("Metronome", { exact: true }).click();
    // Play once so the audio is running, then listen.
    await page.keyboard.press("Space");
    await expect(page.getByTitle("Pause (Space)")).toBeVisible();
    await page.keyboard.press("Space");
    await use(await listen(page));
  },
});

/** Waits until `count` clicks have been heard since `from`. */
async function heard(ear: Ear, from: number, count: number) {
  await expect.poll(async () => (await ear.clicks(from)).length, { timeout: 15_000 }).toBeGreaterThanOrEqual(count);
  return ear.clicks(from);
}

async function play(page: Page) {
  await page.keyboard.press("Space");
  await expect(page.getByTitle("Pause (Space)")).toBeVisible();
}

test("clicks every beat at 120 BPM, higher on the first beat of each bar", async ({ page, ear }) => {
  const start = await ear.now();
  await play(page);
  // The first click may be caught partway through; it's left out.
  const clicks = (await heard(ear, start, 10)).slice(1);
  expect(gaps(clicks).every((g) => onBeat(g, 0.5)), `gaps ${gaps(clicks).map((g) => g.toFixed(4))}`).toBe(true);
  const accents = clicks.map((c) => c.crossings > 15);
  const first = accents.indexOf(true);
  expect(accents.map((a, i) => a === ((i - first) % 4 === 0)).every(Boolean), accents.map((a) => (a ? "A" : ".")).join("")).toBe(true);
});

test("follows a tempo change, being switched off and on, and a jump while playing", async ({ page, studio, ear }) => {
  await play(page);
  await heard(ear, await ear.now(), 2);

  await test.step("tempo to 90: a click every 2/3 s", async () => {
    await studio.bpm.fill("90");
    await studio.bpm.press("Enter");
    const from = (await ear.now()) + 0.8;
    const clicks = await heard(ear, from, 4);
    expect(gaps(clicks).every((g) => onBeat(g, 2 / 3)), `gaps ${gaps(clicks).map((g) => g.toFixed(4))}`).toBe(true);
  });

  await test.step("off: silent", async () => {
    await page.getByTitle("Metronome", { exact: true }).click();
    const from = (await ear.now()) + 0.2;
    await page.waitForTimeout(2000);
    expect(await ear.clicks(from)).toHaveLength(0);
  });

  await test.step("back on: clicks again, on the grid", async () => {
    await page.getByTitle("Metronome", { exact: true }).click();
    const clicks = await heard(ear, await ear.now(), 3);
    expect(gaps(clicks).every((g) => onBeat(g, 2 / 3))).toBe(true);
  });

  await test.step("a jump: carries on evenly from the new place", async () => {
    await page.getByTitle(/^Click or drag to move the playhead/).click({ position: { x: 300, y: 10 } });
    const clicks = await heard(ear, (await ear.now()) + 0.2, 3);
    expect(gaps(clicks).every((g) => onBeat(g, 2 / 3)), `gaps ${gaps(clicks).map((g) => g.toFixed(4))}`).toBe(true);
  });
});

test("keeps time while the page is too busy to run anything", async ({ page, ear }) => {
  const start = await ear.now();
  await play(page);
  // Freeze the page for 0.7 s of every second, like a heavy project
  // loading or a background tab.
  await page.evaluate(() => {
    const busy = setInterval(() => {
      const end = performance.now() + 700;
      while (performance.now() < end);
    }, 1000);
    setTimeout(() => clearInterval(busy), 6000);
  });
  const clicks = (await heard(ear, start, 13)).slice(1);
  expect(gaps(clicks).every((g) => onBeat(g, 0.5)), `gaps ${gaps(clicks).map((g) => g.toFixed(4))}`).toBe(true);
});

test("stops when playing stops", async ({ page, ear }) => {
  await play(page);
  await heard(ear, await ear.now(), 2);
  await page.getByTitle("Stop").click();
  const from = (await ear.now()) + 0.15;
  await page.waitForTimeout(1500);
  expect(await ear.clicks(from)).toHaveLength(0);
});

test("counts in before recording, louder, even with the metronome off", async ({ page, studio, ear }) => {
  // Its level while playing, to compare.
  const start = await ear.now();
  await play(page);
  const playing = await heard(ear, start, 3);
  await page.getByTitle("Stop").click();

  await page.getByTitle("Metronome", { exact: true }).click();
  await page.getByTitle(/^Bars of audible pre-roll/).selectOption("1");
  await studio.header("MIDI 1").getByTitle("Arm this channel for recording and note input").click();
  const from = await ear.now();
  await page.getByTitle(/^Record MIDI/).click();
  const countIn = await heard(ear, from, 4);
  await page.waitForTimeout(1500);
  await page.getByTitle("Stop").click();

  // One bar of 4/4 at 120 BPM, then nothing (the metronome is off).
  const all = await ear.clicks(from);
  expect(all).toHaveLength(4);
  expect(gaps(countIn).every((g) => onBeat(g, 0.5))).toBe(true);
  expect(Math.min(...countIn.map((c) => c.peak))).toBeGreaterThan(Math.max(...playing.map((c) => c.peak)));
});

test("the Click level sets how loud the clicks are", async ({ page, ear }) => {
  /** The loudest click over a few beats of playing. */
  const loudest = async () => {
    const from = await ear.now();
    await play(page);
    const clicks = (await heard(ear, from, 4)).slice(1);
    await page.getByTitle("Stop").click();
    return Math.max(...clicks.map((c) => c.peak));
  };
  const standard = await loudest();
  // Loud enough to hear over a mix with drums: about -6 dBFS.
  expect(standard).toBeGreaterThan(0.4);

  await page.getByRole("slider", { name: "Click", exact: true }).click();
  const field = page.getByTitle("Metronome and count-in level").getByRole("textbox");
  await field.fill("-12");
  await field.press("Enter");
  const quieter = await loudest();
  expect(quieter / standard).toBeCloseTo(10 ** (-12 / 20), 1);
});
