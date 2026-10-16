// The tempo lane: adding, typing, moving and removing tempo changes; the
// ruler, the grid and the metronome following them; MIDI clips staying on
// their beats. An empty project is 120 BPM in 4/4, at 70 px a second: a
// bar is 2 s (140 px) until a change.

import { test, expect } from "./fixtures";
import { gaps, listen, wireSpeakers } from "./speakers";
import type { Page } from "@playwright/test";
import type { Studio } from "./studio";

const PX = 70;

const tool = (page: Page, name: string) => page.getByRole("group", { name: "Edit tool" }).getByRole("button", { name, exact: true });

/** Where the ruler's bar `n` line is (px). */
async function barLine(page: Page, n: number): Promise<number> {
  const ruler = page.getByTitle(/^Click or drag to move the playhead/);
  const mark = ruler.locator("div", { has: page.getByText(String(n), { exact: true }) }).first();
  return parseFloat(await mark.evaluate((el) => (el as HTMLElement).style.left));
}

/** Double-clicks the tempo lane at x (px) and types a tempo there. */
async function addTempo(studio: Studio, x: number, bpm: string) {
  await studio.tempoLane.dblclick({ position: { x, y: 8 } });
  const field = studio.page.getByLabel("Tempo (BPM)");
  await field.fill(bpm);
  await field.press("Enter");
}

const marker = (studio: Studio, name: RegExp) => studio.tempoLane.getByRole("button", { name });

test("double-click the tempo lane to add a change on the nearest bar; the ruler follows it, and it undoes", async ({ page, studio }) => {
  await studio.open("Empty Project");
  expect(await barLine(page, 4)).toBeCloseTo(6 * PX);
  // Just past bar 3 (4 s): the change goes on bar 3.
  await addTempo(studio, 4.1 * PX, "60");
  await expect(marker(studio, /^Tempo 60 BPM from 3\.1\.1/)).toBeVisible();
  await expect(marker(studio, /^Tempo 120 BPM from 1\.1\.1/)).toBeVisible();
  // Bar 3 now lasts 4 s: bar 4 starts at 8 s.
  await expect.poll(() => barLine(page, 4)).toBeCloseTo(8 * PX);
  expect(await barLine(page, 3)).toBeCloseTo(4 * PX);
  await expect.poll(async () => (await studio.autosavedTiming())?.tempoChanges).toEqual([{ beat: 8, bpm: 60 }]);

  await studio.undo();
  await expect(marker(studio, /^Tempo 60 BPM/)).toHaveCount(0);
  await expect.poll(() => barLine(page, 4)).toBeCloseTo(6 * PX);
});

test("a click on a tempo types a new one; the first is the song's tempo, the BPM field's", async ({ studio }) => {
  await studio.open("Empty Project");
  await marker(studio, /^Tempo 120 BPM from 1\.1\.1/).click();
  await studio.page.getByLabel("Tempo (BPM)").fill("90");
  await studio.page.getByLabel("Tempo (BPM)").press("Enter");
  await expect(studio.bpm).toHaveValue("90");

  await addTempo(studio, 4 * PX * (120 / 90), "140");
  await marker(studio, /^Tempo 140 BPM/).click();
  // Escape leaves it as it was.
  await studio.page.getByLabel("Tempo (BPM)").fill("70");
  await studio.page.getByLabel("Tempo (BPM)").press("Escape");
  await expect(marker(studio, /^Tempo 140 BPM from 3\.1\.1/)).toBeVisible();
  await marker(studio, /^Tempo 140 BPM/).click();
  await studio.page.getByLabel("Tempo (BPM)").fill("100");
  await studio.page.getByLabel("Tempo (BPM)").press("Enter");
  await expect(marker(studio, /^Tempo 100 BPM from 3\.1\.1/)).toBeVisible();
  await expect(studio.bpm).toHaveValue("90");
});

test("drag a change along the beats; right-click removes it", async ({ page, studio }) => {
  await studio.open("Empty Project");
  await addTempo(studio, 4 * PX, "60");
  const change = marker(studio, /^Tempo 60 BPM/);
  await expect(change).toHaveAccessibleName(/from 3\.1\.1/);
  // A bar later (2 s at 120): beats snap at this zoom.
  const box = (await change.boundingBox())!;
  await page.mouse.move(box.x + 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 2 + 2 * PX, box.y + box.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect(change).toHaveAccessibleName(/from 4\.1\.1/);
  await expect.poll(async () => (await studio.autosavedTiming())?.tempoChanges).toEqual([{ beat: 12, bpm: 60 }]);
  await expect.poll(() => barLine(page, 5)).toBeCloseTo(10 * PX);

  await change.click({ button: "right" });
  await expect(marker(studio, /^Tempo 60 BPM/)).toHaveCount(0);
  await expect.poll(async () => (await studio.autosavedTiming())?.tempoChanges).toEqual([]);
  // The song's tempo can't be taken out.
  await marker(studio, /^Tempo 120 BPM/).click({ button: "right" });
  await expect(marker(studio, /^Tempo 120 BPM/)).toBeVisible();
});

test("MIDI clips stay on their beats when the tempo changes, and the grid follows the changes", async ({ page, studio }) => {
  await studio.open("Empty Project");
  await tool(page, "Draw").click();
  // One-bar clips on bar 1 and bar 4 (6 s).
  await studio.lane("MIDI 1").click({ position: { x: 10, y: 40 } });
  await studio.lane("MIDI 1").click({ position: { x: 6 * PX + 10, y: 40 } });
  const clips = async () => (await studio.autosavedTiming())?.clips["MIDI 1"].map((c) => [c.offset, c.length]);
  await expect.poll(clips).toEqual([
    [0, 2],
    [6, 2],
  ]);

  // Half the tempo from bar 3: bar 4 starts at 8 s and lasts 4 s.
  await addTempo(studio, 4 * PX, "60");
  await expect.poll(clips).toEqual([
    [0, 2],
    [8, 4],
  ]);

  // A one-bar clip drawn in the slower part is a bar there.
  await studio.lane("MIDI 2").click({ position: { x: 8 * PX + 20, y: 40 } });
  await expect.poll(async () => (await studio.autosavedTiming())?.clips["MIDI 2"].map((c) => [c.offset, c.length])).toEqual([[8, 4]]);

  await studio.undo();
  await studio.undo();
  await expect.poll(clips).toEqual([
    [0, 2],
    [6, 2],
  ]);
});

test("the metronome follows a tempo change", async ({ page, studio }) => {
  await wireSpeakers(page);
  await studio.open("Empty Project");
  // 120 for two bars, then 60.
  await addTempo(studio, 4 * PX, "60");
  await expect(marker(studio, /^Tempo 60 BPM/)).toBeVisible();
  await page.getByTitle("Metronome", { exact: true }).click();
  // Play once so the audio is running, then listen from the start.
  await page.keyboard.press("Space");
  await expect(page.getByTitle("Pause (Space)")).toBeVisible();
  await page.keyboard.press("Space");
  await page.getByTitle("Stop").click();
  const ear = await listen(page);
  const start = await ear.now();
  await page.keyboard.press("Space");
  await expect(page.getByTitle("Pause (Space)")).toBeVisible();
  // Beats every 0.5 s to 4 s (beat 8), then every second.
  await expect.poll(async () => (await ear.clicks(start)).length, { timeout: 15_000 }).toBeGreaterThanOrEqual(11);
  const g = gaps(await ear.clicks(start));
  const on = (gap: number, beat: number) => Math.abs(gap - beat) < 0.0015;
  const shown = g.map((x) => x.toFixed(4)).join(" ");
  // (The first click may be caught partway through, and missed.)
  const slower = g.findIndex((x) => on(x, 1));
  expect(slower, shown).toBeGreaterThanOrEqual(7);
  expect(g.slice(0, slower).every((x) => on(x, 0.5)), shown).toBe(true);
  expect(g.slice(slower, slower + 2).every((x) => on(x, 1)), shown).toBe(true);
});
