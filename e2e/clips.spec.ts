// Clips on the timeline: selecting, moving, resizing, fades and gain, the
// right-click menus, and dropping grooves and audio files on a lane.

import { test, expect } from "./fixtures";
import type { Locator } from "@playwright/test";
import { toneWav } from "./wav";

test.beforeEach(async ({ studio }) => {
  await studio.open("Beat");
});

const left = (clip: Locator) => clip.evaluate((el) => (el as HTMLElement).style.left);
const width = (clip: Locator) => clip.evaluate((el) => (el as HTMLElement).style.width);

test("click selects a clip, Ctrl-click adds a second", async ({ studio }) => {
  const first = studio.clips("12 notes").first();
  const second = studio.clips("16 notes").first();
  await first.click({ position: { x: 30, y: 50 } });
  await second.click({ position: { x: 30, y: 50 }, modifiers: ["Control"] });
  await expect(first).toHaveClass(/ring-2/);
  await expect(second).toHaveClass(/ring-2/);
  await expect(studio.clips().and(studio.page.locator(".ring-2"))).toHaveCount(2);
});

test("drag a clip to move it, and undo it", async ({ studio }) => {
  const clip = studio.clips("12 notes").first();
  const before = await left(clip);
  await studio.drag(clip.locator("span").first(), 200);
  await expect.poll(() => left(clip)).not.toBe(before);
  await studio.undo();
  await expect.poll(() => left(clip)).toBe(before);
});

test("drag a clip's right edge to resize it, and undo it", async ({ studio }) => {
  const clip = studio.clips("34 notes").first();
  const before = await width(clip);
  await studio.drag(clip.getByTitle("Drag to resize the clip length"), -150);
  await expect.poll(() => width(clip)).not.toBe(before);
  await studio.undo();
  await expect.poll(() => width(clip)).toBe(before);
});

test("Delete removes the selected clip, and undo brings it back", async ({ page, studio }) => {
  const count = await studio.clips().count();
  await studio.clips("12 notes").first().click({ position: { x: 30, y: 50 } });
  await page.keyboard.press("Delete");
  await expect(studio.clips()).toHaveCount(count - 1);
  await studio.undo();
  await expect(studio.clips()).toHaveCount(count);
});

test("copy a clip from its menu and paste it on an empty spot", async ({ page, studio }) => {
  await studio.clipsOn("Lead").first().click({ button: "right", position: { x: 30, y: 30 } });
  await page.getByRole("button", { name: "Copy clip" }).click();
  // The Lead track is empty for its first two bars.
  await studio.lane("Lead").click({ button: "right", position: { x: 10, y: 30 } });
  await page.getByRole("button", { name: "Paste clip here" }).click();
  await expect(studio.clipsOn("Lead")).toHaveCount(2);
});

test("right-click an empty MIDI lane to add an empty clip", async ({ page, studio }) => {
  await studio.addTrack("MIDI");
  const lane = studio.lane("MIDI 5");
  await lane.scrollIntoViewIfNeeded();
  await lane.click({ button: "right", position: { x: 30, y: 30 } });
  await page.getByRole("button", { name: "Add empty MIDI clip here" }).click();
  await expect(studio.clipsOn("MIDI 5")).toHaveText([/empty/]);
});

test("double-click a clip to open it in the piano roll", async ({ page, studio }) => {
  await studio.clips("12 notes").first().dblclick({ position: { x: 30, y: 50 } });
  const pianoRoll = page.getByRole("dialog", { name: /^Piano Roll — / });
  await expect(pianoRoll).toBeVisible();
  // It opens scrolled to the clip's notes, not to the top of the range.
  const scrolled = () => pianoRoll.evaluate((el) => Math.max(...[...el.querySelectorAll("div")].map((d) => d.scrollTop)));
  await expect.poll(scrolled).toBeGreaterThan(0);
  await pianoRoll.getByTitle("Close").click();
  await expect(pianoRoll).toBeHidden();
});

test("an audio clip's fade-in and gain handles", async ({ studio }) => {
  await studio.addTrack("Audio");
  await studio.header("Audio 1").locator('input[type="file"][accept="audio/*"]').setInputFiles({ name: "tone.wav", mimeType: "audio/wav", buffer: toneWav(8) });
  const clip = studio.clips("tone").first();
  await expect(clip).toBeVisible();
  await clip.hover();

  // The fade is drawn as a shaded triangle over the clip's start.
  await expect(clip.locator("polygon")).toHaveCount(0);
  await studio.drag(clip.getByTitle("Drag to set the fade-in"), 120);
  await expect(clip.locator("polygon")).toHaveCount(1);

  const gain = clip.getByTitle(/^Drag to adjust this clip's gain/);
  await clip.hover();
  const before = await gain.innerText();
  await studio.drag(gain, 0, -40);
  await expect(gain).not.toHaveText(before);
});

test("drop a groove from the browser on a MIDI track", async ({ page, studio }) => {
  await studio.addTrack("MIDI");
  await page.getByRole("tab", { name: /Grooves/ }).click();
  const grooves = page.locator('div[draggable="true"][title*="Drag onto a MIDI track"]');
  if ((await grooves.count()) === 0) await page.locator("button").filter({ hasText: /\d+$/ }).first().click();
  const lane = studio.lane("MIDI 5");
  await lane.scrollIntoViewIfNeeded();
  await grooves.first().dragTo(lane, { targetPosition: { x: 300, y: 30 } });
  await expect(studio.clipsOn("MIDI 5")).toHaveCount(1);
});

test("drop an audio file from the computer on an audio lane", async ({ page, studio }) => {
  await studio.addTrack("Audio");
  const lane = studio.lane("Audio 1");
  await lane.scrollIntoViewIfNeeded();
  const wav = toneWav(0.5).toString("base64");
  // The OS drag carries a file; the browser's own events stand in for it.
  const files = await page.evaluateHandle((data) => {
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], "dropped.wav", { type: "audio/wav" }));
    return transfer;
  }, wav);
  for (const type of ["dragenter", "dragover", "drop"]) await lane.dispatchEvent(type, { dataTransfer: files, clientX: 0, clientY: 0 });
  await expect(studio.clipsOn("Audio 1")).toHaveText([/dropped/]);
});
