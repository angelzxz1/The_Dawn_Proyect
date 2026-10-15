// Naming, coloring and processing clips from the clip menu and the keys:
// rename, color, consolidate, reverse, normalize and fade presets.

import { test, expect } from "./fixtures";
import type { Locator, Page } from "@playwright/test";
import type { Studio } from "./studio";
import { toneWav } from "./wav";

const menuItem = (page: Page, name: string | RegExp) => page.getByRole("button", { name, exact: typeof name === "string" });

async function openMenu(clip: Locator) {
  await clip.click({ button: "right", position: { x: 30, y: 50 } });
}

/** The clip's border: its color. */
const colorOf = (clip: Locator) => clip.evaluate((el) => getComputedStyle(el).borderTopColor);

/** Where a clip's notes are (each one's left, % of the clip), in order. */
const noteSpots = (clip: Locator) =>
  clip.locator(".h-\\[2px\\]").evaluateAll((els) => els.map((el) => Math.round(parseFloat((el as HTMLElement).style.left) * 100) / 100).sort((a, b) => a - b));

async function importTone(studio: Studio, track = "Audio 1") {
  await studio.header(track).locator('input[type="file"][accept="audio/*"]').setInputFiles({ name: "tone.wav", mimeType: "audio/wav", buffer: toneWav(8) });
  await expect(studio.clipsOn(track)).toHaveCount(1);
  return studio.clipsOn(track).first();
}

test.describe("in the Beat template", () => {
  test.beforeEach(async ({ studio }) => {
    await studio.open("Beat");
  });

  test("rename a clip from its menu, with F2, or not (Esc); the name is saved", async ({ page, studio }) => {
    const clip = studio.clipsOn("Bass").first();
    const shown = (await clip.textContent())!;
    await openMenu(clip);
    await menuItem(page, "Rename… (F2)").click();
    const field = clip.getByRole("textbox", { name: "Clip name" });
    await expect(field).toBeFocused();
    await field.fill("Bassline");
    await field.press("Enter");
    await expect(clip).toContainText("Bassline");
    await expect.poll(async () => (await studio.autosavedClips()).map((c) => c.name)).toContain("Bassline");

    // F2 renames the selected clip; Esc keeps the name it had.
    await clip.click({ position: { x: 30, y: 50 } });
    await page.keyboard.press("F2");
    await field.fill("Nope");
    await field.press("Escape");
    await expect(clip).toContainText("Bassline");

    // An empty name gives back what it showed by itself.
    await page.keyboard.press("F2");
    await field.fill("");
    await field.press("Enter");
    await expect(clip).toHaveText(shown);
    await studio.undo();
    await expect(clip).toContainText("Bassline");
  });

  test("color the selected clips; Track color gives them back their track's", async ({ page, studio }) => {
    const [first, second] = [studio.clipsOn("808 Drums").nth(0), studio.clipsOn("808 Drums").nth(1)];
    const track = await colorOf(first);
    await first.click({ position: { x: 30, y: 50 } });
    await second.click({ position: { x: 30, y: 50 }, modifiers: ["ControlOrMeta"] });
    await openMenu(second);
    await page.getByRole("group", { name: "Color" }).getByRole("button", { name: "Color 3" }).click();
    // The palette's third color, #8ee27d.
    await expect.poll(() => colorOf(first)).toBe("rgb(142, 226, 125)");
    await expect.poll(() => colorOf(second)).toBe("rgb(142, 226, 125)");
    expect(await colorOf(studio.clipsOn("808 Drums").nth(2))).toBe(track);

    await openMenu(second);
    await expect(page.getByRole("button", { name: "Color 3" })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("group", { name: "Color" }).getByRole("button", { name: "Track color" }).click();
    await expect.poll(() => colorOf(first)).toBe(track);
  });

  test("Ctrl+J joins the selected clips on a track, and what's between them, into one", async ({ page, studio }) => {
    const drums = studio.clipsOn("808 Drums");
    await expect(drums).toHaveCount(3);
    const [intro, chorus] = [(await drums.nth(0).boundingBox())!, (await drums.nth(2).boundingBox())!];
    await drums.nth(0).click({ position: { x: 30, y: 50 } });
    await drums.nth(1).click({ position: { x: 30, y: 50 }, modifiers: ["ControlOrMeta"] });
    await page.keyboard.press("ControlOrMeta+j");
    await expect(drums).toHaveCount(2);
    // From the intro's start to the verse's end, where the chorus starts; selected.
    const joined = studio.lane("808 Drums").locator("[data-clip-id].ring-2");
    await expect(joined).toHaveCount(1);
    const box = (await joined.boundingBox())!;
    expect(box.x).toBeCloseTo(intro.x, 0);
    expect(box.x + box.width).toBeCloseTo(chorus.x, 0);
    await studio.undo();
    await expect(drums).toHaveCount(3);
  });

  test("Ctrl+J with a time selection: one clip per track over it", async ({ page, studio }) => {
    const lane = (await studio.lane("Bass").boundingBox())!;
    const bass = (await studio.clipsOn("Bass").first().boundingBox())!;
    const bar = (bass.x - lane.x) / 2;
    const pad = (await studio.lane("Pad").boundingBox())!;
    // Bars 2-5 on the Bass and Pad lanes (their clips start at bar 3).
    await page.mouse.move(lane.x + bar + 3, lane.y + lane.height / 2);
    await page.mouse.down();
    await page.mouse.move(lane.x + 4 * bar + 3, pad.y + pad.height / 2, { steps: 8 });
    await page.mouse.up();
    await page.keyboard.press("ControlOrMeta+j");
    await expect(studio.clipsOn("Bass")).toHaveCount(2);
    await expect(studio.clipsOn("Pad")).toHaveCount(2);
    const starts = await studio.clipsOn("Bass").evaluateAll((els) => els.map((el) => el.getBoundingClientRect().x).sort((a, b) => a - b));
    expect(starts.map((x) => Math.round((x - lane.x) / bar + 1))).toEqual([2, 5]);
  });

  test("Reverse turns a MIDI clip's notes around; twice gives them back", async ({ page, studio }) => {
    const lead = studio.clipsOn("Lead").first();
    const before = await noteSpots(lead);
    await openMenu(lead);
    await menuItem(page, "Reverse").click();
    await expect.poll(() => noteSpots(lead)).not.toEqual(before);
    await openMenu(lead);
    await menuItem(page, "Reverse").click();
    await expect.poll(() => noteSpots(lead)).toEqual(before);
  });
});

test.describe("an audio clip", () => {
  test.beforeEach(async ({ studio }) => {
    await studio.open("Empty Project");
  });

  test("double-clicking it names it", async ({ studio }) => {
    const clip = await importTone(studio);
    await clip.dblclick({ position: { x: 60, y: 50 } });
    const field = clip.getByRole("textbox", { name: "Clip name" });
    await field.fill("Lead vocal");
    await field.press("Enter");
    await expect(clip).toContainText("Lead vocal");
  });

  test("Normalize brings its peak to full scale with the clip's gain", async ({ page, studio }) => {
    const clip = await importTone(studio);
    await openMenu(clip);
    await menuItem(page, "Normalize").click();
    // The tone peaks at 8000 / 32768 of full scale: +12.2 dB brings it up.
    await clip.hover();
    await expect(clip.getByTitle(/^Drag to adjust this clip's gain/)).toHaveText("+12.2dB");
    await studio.undo();
    await expect(clip.getByTitle(/^Drag to adjust this clip's gain/)).toHaveText("+0.0dB");
  });

  test("fade presets set its fades, and show which one it has", async ({ page, studio }) => {
    const clip = await importTone(studio);
    const fades = () => page.getByRole("group", { name: "Fades" });
    await openMenu(clip);
    await expect(fades().getByRole("button", { name: "None" })).toHaveAttribute("aria-pressed", "true");
    await fades().getByRole("button", { name: "Beat" }).click();
    await expect(clip.locator("polygon")).toHaveCount(2);
    await openMenu(clip);
    await expect(fades().getByRole("button", { name: "Beat" })).toHaveAttribute("aria-pressed", "true");
    await fades().getByRole("button", { name: "None" }).click();
    await expect(clip.locator("polygon")).toHaveCount(0);
  });

  test("Reverse makes it play a reversed copy of its file, which is saved", async ({ page, studio }) => {
    const clip = await importTone(studio);
    await openMenu(clip);
    await menuItem(page, "Reverse").click();
    await expect(clip).toContainText("tone reversed.wav");
    await expect.poll(async () => (await studio.autosavedClips()).map((c) => [c.fileName, c.audio])).toEqual([["tone reversed.wav", true]]);
    const [saved] = await studio.autosavedClips();
    const audio = (await studio.autosavedAudio(saved.id))!;
    expect(audio.seconds).toBeCloseTo(8, 1);
    expect(audio.peak).toBeCloseTo(8000 / 32768, 2);
    await studio.undo();
    await expect(clip).toContainText("tone.wav");
  });

  test("Consolidate renders the selected clips into one new file", async ({ page, studio }) => {
    const clip = await importTone(studio);
    await clip.click({ position: { x: 30, y: 50 } });
    await page.keyboard.press("ControlOrMeta+d");
    const clips = studio.clipsOn("Audio 1");
    await expect(clips).toHaveCount(2);
    await clips.nth(0).click({ position: { x: 30, y: 50 }, modifiers: ["ControlOrMeta"] });
    await openMenu(clips.nth(0));
    await menuItem(page, "Consolidate (Ctrl+J)").click();
    await expect(clips).toHaveCount(1);
    await expect(clips.first()).toContainText("tone consolidated.wav");

    // The new file: both 8 s clips, one after the other, as loud as the tone.
    await expect.poll(async () => (await studio.autosavedClips()).filter((c) => c.audio).length).toBe(1);
    const [saved] = await studio.autosavedClips();
    const audio = (await studio.autosavedAudio(saved.id))!;
    expect(audio.seconds).toBeCloseTo(16, 1);
    expect(audio.peak).toBeCloseTo(8000 / 32768, 2);
  });
});
