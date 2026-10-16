// Recording: audio from another track and from the (fake) microphone, MIDI
// from the computer keyboard, and the latency readout recordings rely on.

import { test, expect } from "./fixtures";
import type { Locator } from "@playwright/test";

test.beforeEach(async ({ studio }) => {
  await studio.open("Beat");
});

/** How many pixels are drawn on the canvases inside an element. */
const inked = (element: Locator) =>
  element.evaluate((el) =>
    [...el.querySelectorAll("canvas")].reduce((sum, canvas) => {
      const data = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
      let drawn = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i] > 0) drawn++;
      return sum + drawn;
    }, 0)
  );

test("record another track: the take is drawn as it comes in, then becomes a clip", async ({ page, studio }) => {
  await studio.addTrack("Audio");
  await studio.select("Audio 1");
  await page.locator('label:has-text("Audio from") select').first().selectOption({ label: "Track: 808 Drums" });
  await studio.header("Audio 1").getByTitle("Arm this channel for recording and note input").click();
  await page.getByTitle(/^Click or drag to move the playhead/).click({ position: { x: 1, y: 10 } });
  await page.getByTitle("Record microphone input onto Audio 1").click();

  const lane = studio.lane("Audio 1");
  await expect.poll(() => inked(lane)).toBeGreaterThan(0);
  const early = await inked(lane);
  await expect.poll(() => inked(lane)).toBeGreaterThan(early);

  await page.getByTitle("Stop").click();
  await expect(studio.clipsOn("Audio 1")).toHaveCount(1);
  await expect.poll(() => inked(studio.clipsOn("Audio 1"))).toBeGreaterThan(0);
  // Its timing is known exactly, so there's no latency to measure.
  await expect(page.getByRole("status", { name: "Recording timing" })).toHaveCount(0);
});

test("record the microphone onto an audio track", async ({ page, studio }) => {
  await studio.addTrack("Audio");
  await studio.header("Audio 1").getByTitle("Arm this channel for recording and note input").click();
  await page.getByTitle("Record microphone input onto Audio 1").click();
  await expect(page.getByTitle("Record microphone input onto Audio 1")).toHaveAttribute("aria-pressed", "true");
  await page.waitForTimeout(1500);
  await page.getByTitle("Stop").click();
  await expect(studio.clipsOn("Audio 1")).toHaveCount(1);
  // The fake microphone plays a beep, so the take isn't silent.
  await expect.poll(() => inked(studio.clipsOn("Audio 1"))).toBeGreaterThan(0);
});

test("after a take from the interface, a note offers to measure the latency", async ({ page, studio }) => {
  await studio.addTrack("Audio");
  await studio.header("Audio 1").getByTitle("Arm this channel for recording and note input").click();
  const record = async () => {
    const button = page.getByTitle("Record microphone input onto Audio 1");
    await button.click();
    await expect(button).toHaveAttribute("aria-pressed", "true");
    await page.waitForTimeout(800);
    await page.getByTitle("Stop").click();
  };
  const note = page.getByRole("status", { name: "Recording timing" });

  // It opens the Audio panel at its Recording section.
  await record();
  await note.getByRole("button", { name: "Measure latency…" }).click();
  await expect(note).toBeHidden();
  const panel = page.getByRole("dialog", { name: "Audio settings" });
  await expect(panel.getByRole("button", { name: "Measure latency", exact: true })).toBeInViewport();
  await page.keyboard.press("Escape");

  // Until it's measured, it comes back after each take - unless told not to.
  await record();
  await note.getByRole("button", { name: "Don't show again" }).click();
  await expect(note).toBeHidden();
  await record();
  // Three takes in the same place: the first, kept as Take 1 when the
  // second went over it, then those two.
  await expect(page.getByRole("group", { name: /^Take \d+ lane$/ })).toHaveCount(3);
  await expect(note).toHaveCount(0);
});

test("record MIDI from the computer keyboard", async ({ page, studio }) => {
  await studio.addTrack("MIDI");
  // The computer keyboard plays a track that has an instrument.
  await studio.select("MIDI 5");
  await page.getByRole("group", { name: "Instrument" }).getByRole("button", { name: "Synth", exact: true }).click();
  await studio.header("MIDI 5").getByTitle("Arm this channel for recording and note input").click();
  await page.getByTitle("Record MIDI onto MIDI 5").click();
  await expect(page.getByTitle("Record MIDI onto MIDI 5")).toHaveAttribute("aria-pressed", "true");
  for (const key of ["z", "x", "c"]) {
    await page.keyboard.down(key);
    await page.waitForTimeout(150);
    await page.keyboard.up(key);
  }
  await page.getByTitle("Stop").click();
  await expect(studio.clipsOn("MIDI 5")).toHaveText([/3 notes/]);
});

test("the audio status panel shows the sample rate and latency", async ({ page }) => {
  await page.getByTitle("Audio engine load and latency").click();
  const panel = page.getByRole("dialog").filter({ hasText: "Latency" });
  await expect(panel).toContainText(/Sample rate\s*\d+(\.\d)? kHz/);
  await expect(panel).toContainText(/Round trip \((measured|estimated)\)\s*\d/);
  await page.keyboard.press("Escape");
});
