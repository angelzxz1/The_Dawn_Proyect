// The project's files: autosave, saving and opening a project file, and
// exporting the song as WAV, MP3 and stems.

import { readFileSync } from "node:fs";
import { unzipSync } from "fflate";
import { test, expect } from "./fixtures";
import { readWav } from "./wav";
import type { Page, TestInfo } from "@playwright/test";
import type { Studio } from "./studio";

const BEAT = ["808 Drums", "Bass", "Pad", "Lead"];

async function renamePad(studio: Studio) {
  await studio.name("Pad").dblclick();
  await studio.header("Pad").getByRole("textbox").fill("Pads");
  await studio.header("Pad").getByRole("textbox").press("Enter");
  await expect(studio.header("Pads")).toBeVisible();
}

test("changes are autosaved and come back after a reload", async ({ page, studio }) => {
  await studio.open("Beat");
  await renamePad(studio);
  await expect.poll(() => studio.autosavedTracks()).toEqual(["808 Drums", "Bass", "Pads", "Lead"]);
  await page.reload();
  await expect(studio.trackNames).toHaveText(["808 Drums", "Bass", "Pads", "Lead"]);
});

test("save a project file, and open it again", async ({ page, studio }, testInfo) => {
  // Without the folder picker (Firefox, Safari), a project is saved as one
  // .dawnproject file.
  await page.addInitScript(() => Object.defineProperty(window, "showDirectoryPicker", { value: undefined, configurable: true }));
  await studio.open("Beat");
  await renamePad(studio);

  await page.keyboard.press("Control+s");
  const saveAs = page.getByRole("dialog", { name: "Save project as" });
  await saveAs.getByRole("textbox", { name: "Project name" }).fill("My Beat");
  const download = page.waitForEvent("download");
  await saveAs.getByRole("button", { name: "Save" }).click();
  const saved = await download;
  expect(saved.suggestedFilename()).toBe("My Beat.dawnproject");
  const file = testInfo.outputPath(saved.suggestedFilename());
  await saved.saveAs(file);

  page.on("dialog", (d) => void d.accept());
  await studio.fileMenu(/^New Project/);
  await page.getByRole("dialog", { name: "Start" }).getByRole("button", { name: /^Empty Project/ }).click();
  await expect(studio.trackNames).toHaveText(["MIDI 1", "MIDI 2", "Audio 1"]);

  const chooser = page.waitForEvent("filechooser");
  await studio.fileMenu(/^Open Project File/);
  await (await chooser).setFiles(file);
  await expect(studio.trackNames).toHaveText(["808 Drums", "Bass", "Pads", "Lead"]);
  await expect(page.getByText("My Beat", { exact: true })).toBeVisible();
});

/** Exports through the Export dialog; returns the downloaded file's path. */
async function exportSong(page: Page, testInfo: TestInfo, options: { what?: RegExp; format: "WAV" | "MP3" }): Promise<string> {
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Export" });
  if (options.what) await dialog.getByRole("radiogroup", { name: "What to export" }).getByRole("radio", { name: options.what }).click();
  await dialog.getByRole("radiogroup", { name: "Format" }).getByRole("radio", { name: options.format }).click();
  // Just the loop (8 bars), to be quick.
  await dialog.getByRole("radiogroup", { name: "Range" }).getByRole("radio", { name: /^Loop/ }).click();
  const download = page.waitForEvent("download", { timeout: 120_000 });
  await dialog.getByRole("button", { name: /^Export / }).last().click();
  const file = await download;
  const path = testInfo.outputPath(file.suggestedFilename());
  await file.saveAs(path);
  return path;
}

// 8 bars of 4/4 at 140 BPM.
const LOOP_SECONDS = (8 * 4 * 60) / 140;

test.describe("export", () => {
  test.describe.configure({ timeout: 150_000 });

  test.beforeEach(async ({ studio }) => {
    await studio.open("Beat");
  });

  test("the mix as WAV", async ({ page }, testInfo) => {
    const wav = readWav(readFileSync(await exportSong(page, testInfo, { format: "WAV" })));
    expect(wav.channels).toBe(2);
    expect(wav.seconds).toBeGreaterThanOrEqual(LOOP_SECONDS - 0.01);
    expect(wav.seconds).toBeLessThan(LOOP_SECONDS + 10);
    // Not silent, and not clipping past full scale.
    expect(wav.peak).toBeGreaterThan(0.05);
    expect(wav.peak).toBeLessThanOrEqual(1);
  });

  test("the mix as MP3", async ({ page }, testInfo) => {
    const mp3 = readFileSync(await exportSong(page, testInfo, { format: "MP3" }));
    const frameSync = mp3[0] === 0xff && (mp3[1] & 0xe0) === 0xe0;
    expect(frameSync || mp3.toString("ascii", 0, 3) === "ID3").toBe(true);
    // At least ~64 kbps for the loop's length.
    expect(mp3.length).toBeGreaterThan((64_000 / 8) * LOOP_SECONDS);
  });

  test("stems: a ZIP with one WAV per track", async ({ page }, testInfo) => {
    const zip = unzipSync(readFileSync(await exportSong(page, testInfo, { what: /^Stems/, format: "WAV" })));
    const names = Object.keys(zip).sort();
    expect(names).toHaveLength(BEAT.length);
    for (const track of BEAT) expect(names.some((n) => n.includes(track))).toBe(true);
    const stems = Object.fromEntries(names.map((n) => [BEAT.find((t) => n.includes(t))!, readWav(Buffer.from(zip[n]))]));
    for (const track of BEAT) expect(stems[track].seconds).toBeCloseTo(stems["808 Drums"].seconds, 2);
    // The lead only comes in after the loop.
    for (const track of ["808 Drums", "Bass", "Pad"]) expect(stems[track].peak, track).toBeGreaterThan(0.01);
    expect(stems.Lead.peak).toBeLessThan(0.001);
  });
});
