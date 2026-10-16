// Warping audio clips: a clip that follows the song's tempo, played
// stretched (or repitched) so its beats stay on the song's - checked by
// ear (speakers.ts) on a file with a blip on every beat - its own tempo
// typed or found, and kept with the project.

import { test, expect } from "./fixtures";
import { gaps, listen, wireSpeakers } from "./speakers";
import { beatWav } from "./wav";
import type { Page } from "@playwright/test";
import type { Studio } from "./studio";

const PX = 70;

async function importBeat(studio: Studio, bpm: number, beats: number) {
  await studio.header("Audio 1").locator('input[type="file"][accept="audio/*"]').setInputFiles({ name: "beat.wav", mimeType: "audio/wav", buffer: beatWav(bpm, beats) });
  await expect(studio.clipsOn("Audio 1")).toHaveCount(1);
  return studio.clipsOn("Audio 1").first();
}

async function menuItem(page: Page, clip: ReturnType<Studio["clipsOn"]>, name: string | RegExp) {
  await clip.click({ button: "right", position: { x: 20, y: 50 } });
  await page.getByRole("button", { name }).click();
}

const audioClips = async (studio: Studio) => (await studio.autosavedTiming())?.clips["Audio 1"] ?? [];

/** The gaps between the blips heard from the start, `count` of them. */
async function heardGaps(page: Page, count: number): Promise<number[]> {
  await expect(page.getByText("loading sounds…")).toBeHidden();
  const ear = await listen(page);
  const from = await ear.now();
  await page.keyboard.press("Space");
  await expect(page.getByTitle("Pause (Space)")).toBeVisible();
  await expect.poll(async () => (await ear.clicks(from)).length, { timeout: 15_000 }).toBeGreaterThanOrEqual(count + 1);
  const g = gaps((await ear.clicks(from)).slice(0, count + 1));
  await page.getByTitle("Stop").click();
  return g;
}

test("warp a clip: it follows the tempo, stretched or repitched, its beats on the song's", async ({ page, studio }) => {
  await wireSpeakers(page);
  await studio.open("Empty Project");
  // Eight beats at the song's 120 BPM: 4 s.
  const clip = await importBeat(studio, 120, 8);
  await menuItem(page, clip, "Warp clip: follow the tempo");
  await expect(clip.getByRole("button", { name: "Clip tempo 120 BPM" })).toBeVisible();
  await expect.poll(() => audioClips(studio)).toEqual([expect.objectContaining({ offset: 0, length: expect.closeTo(4), warp: { bpm: 120, mode: "stretch" } })]);

  // Half the tempo: the clip is twice as long, a beat a second.
  await studio.bpm.fill("60");
  await studio.bpm.press("Enter");
  await expect.poll(async () => (await audioClips(studio))[0]?.length).toBeCloseTo(8);
  expect((await clip.boundingBox())!.width).toBeCloseTo(8 * PX, -1);
  // The stretch lines each window up with the one before, so a blip can
  // move by a few milliseconds.
  const stretched = await heardGaps(page, 4);
  expect(stretched.every((g) => Math.abs(g - 1) < 0.02), stretched.join(" ")).toBe(true);

  await menuItem(page, clip, /^Repitch/);
  await expect.poll(async () => (await audioClips(studio))[0]?.warp?.mode).toBe("repitch");
  const repitched = await heardGaps(page, 4);
  expect(repitched.every((g) => Math.abs(g - 1) < 0.003), repitched.join(" ")).toBe(true);

  // Stopping warping plays the file at its own speed again, the clip as
  // long as the file.
  await menuItem(page, clip, "Stop warping clip");
  await expect.poll(() => audioClips(studio)).toEqual([expect.objectContaining({ length: expect.closeTo(4) })]);
  await expect(clip.getByRole("button", { name: /^Clip tempo/ })).toHaveCount(0);
});

test("a clip's own tempo, typed or found: a 100 BPM loop plays at the song's 120", async ({ page, studio }) => {
  await wireSpeakers(page);
  await studio.open("Empty Project");
  // Eight beats at 100 BPM: 4.8 s.
  const clip = await importBeat(studio, 100, 8);
  await menuItem(page, clip, "Detect the clip's tempo");
  await expect(clip.getByRole("button", { name: /^Clip tempo 100(\.\d)? BPM/ })).toBeVisible();
  // At 120 it takes 4 s.
  await expect.poll(async () => (await audioClips(studio))[0]?.length).toBeCloseTo(4, 1);
  const g = await heardGaps(page, 4);
  expect(g.every((x) => Math.abs(x - 0.5) < 0.02), g.join(" ")).toBe(true);

  // Typed: said to be at 200 BPM, its 4.8 s hold 16 beats - 8 s at 120.
  await clip.getByRole("button", { name: /^Clip tempo/ }).click();
  await clip.getByLabel("Clip tempo (BPM)").fill("200");
  await clip.getByLabel("Clip tempo (BPM)").press("Enter");
  await expect(clip.getByRole("button", { name: "Clip tempo 200 BPM" })).toBeVisible();
  await expect.poll(async () => (await audioClips(studio))[0]?.length).toBeCloseTo(8, 1);
  await studio.undo();
  await expect(clip.getByRole("button", { name: /^Clip tempo 100(\.\d)? BPM/ })).toBeVisible();
});

test("a warped clip stays warped after a reload, and on its beats when the tempo changes", async ({ page, studio }) => {
  await studio.open("Empty Project");
  const clip = await importBeat(studio, 120, 8);
  await menuItem(page, clip, "Warp clip: follow the tempo");
  await expect.poll(async () => (await audioClips(studio))[0]?.warp?.bpm).toBe(120);
  await page.reload();
  const again = studio.clipsOn("Audio 1").first();
  await expect(again.getByRole("button", { name: "Clip tempo 120 BPM" })).toBeVisible();
  // A tempo change in the middle: the second half is at 60.
  await studio.tempoLane.dblclick({ position: { x: 2 * PX, y: 8 } });
  await page.getByLabel("Tempo (BPM)").fill("60");
  await page.getByLabel("Tempo (BPM)").press("Enter");
  // Beats 0-4 take 2 s, beats 4-8 take 4.
  await expect.poll(async () => (await audioClips(studio))[0]?.length).toBeCloseTo(6);
});
