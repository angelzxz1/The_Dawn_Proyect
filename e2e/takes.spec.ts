// Takes and comping: recording over a take keeps it, a loop recording makes
// a take each time round, and the takes' parts are put together in the
// track (the comp) by clicking and dragging on them.

import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";
import type { Studio } from "./studio";

const takeLanes = (page: Page) => page.getByRole("group", { name: /^Take \d+ lane$/ });
const takeLane = (page: Page, n: number) => page.getByRole("group", { name: `Take ${n} lane`, exact: true });
/** The parts of a take that the track plays. */
const compParts = (page: Page, n: number) => takeLane(page, n).locator("[data-comp-part]");

/** Records the (fake) microphone onto Audio 1 for about `ms`, from the marker. */
async function record(page: Page, studio: Studio, ms: number) {
  const button = page.getByTitle("Record microphone input onto Audio 1");
  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "true");
  await page.waitForTimeout(ms);
  await page.getByTitle("Stop").click();
  await expect(button).toHaveAttribute("aria-pressed", "false");
  await expect(studio.clipsOn("Audio 1").first()).toBeVisible();
}

test.describe("audio", () => {
  test.beforeEach(async ({ studio }) => {
    await studio.open("Empty Project");
    await studio.header("Audio 1").getByTitle("Arm this channel for recording and note input").click();
  });

  test("recording over a take keeps it as a take; clicking a take's clip puts it in the track", async ({ page, studio }) => {
    await record(page, studio, 800);
    await expect(studio.clipsOn("Audio 1")).toHaveCount(1);
    await expect(takeLanes(page)).toHaveCount(0);

    // Again, much longer, from the same place: the first is kept, the new
    // one plays.
    await record(page, studio, 2500);
    await expect(takeLanes(page)).toHaveCount(2);
    await expect(studio.clipsOn("Audio 1")).toHaveCount(1);
    await expect(compParts(page, 2)).toHaveCount(1);
    await expect(compParts(page, 1)).toHaveCount(0);

    // Take 1 back where it was; the rest of take 2 after it.
    await takeLane(page, 1).click({ position: { x: 20, y: 30 } });
    await expect(compParts(page, 1)).toHaveCount(1);
    await expect(compParts(page, 2)).toHaveCount(1);
    await expect(studio.clipsOn("Audio 1")).toHaveCount(2);

    await studio.undo();
    await expect(compParts(page, 1)).toHaveCount(0);
    await expect(studio.clipsOn("Audio 1")).toHaveCount(1);
  });

  test("dragging across a take puts that part of it in the track", async ({ page, studio }) => {
    await record(page, studio, 800);
    await record(page, studio, 2500);
    await page.getByLabel("Snap").selectOption("off");
    // A part from inside take 1, with take 2 on both sides of it.
    const lane = (await takeLane(page, 1).boundingBox())!;
    await page.mouse.move(lane.x + 15, lane.y + 30);
    await page.mouse.down();
    await page.mouse.move(lane.x + 40, lane.y + 30, { steps: 6 });
    await page.mouse.up();
    await expect(compParts(page, 1)).toHaveCount(1);
    await expect(compParts(page, 2)).toHaveCount(2);
    await expect(studio.clipsOn("Audio 1")).toHaveCount(3);
  });

  test("a take can be deleted (what plays stays), and the takes hidden and shown", async ({ page, studio }) => {
    await record(page, studio, 800);
    await record(page, studio, 2500);
    await page.getByRole("button", { name: "Delete Take 2" }).click();
    await expect(takeLanes(page)).toHaveCount(1);
    await expect(studio.clipsOn("Audio 1")).toHaveCount(1);

    await studio.header("Audio 1").getByTitle(/^Hide the 1 take/).click();
    await expect(takeLanes(page)).toHaveCount(0);
    await studio.header("Audio 1").getByTitle(/^Show the 1 take/).click();
    await expect(takeLanes(page)).toHaveCount(1);

    await studio.undo();
    await expect(takeLanes(page)).toHaveCount(2);
  });

  test("with the loop on, recording goes round it, a take each time round, kept with one file", async ({ page, studio }) => {
    // A one-bar loop (2 s at 120 bpm) from the start, and record from there
    // for a little over two times round.
    await page.getByLabel("Start", { exact: true }).fill("1.1.1");
    await page.getByLabel("Start", { exact: true }).press("Enter");
    await page.getByLabel("Length", { exact: true }).fill("1.0.0");
    await page.getByLabel("Length", { exact: true }).press("Enter");
    await page.keyboard.press("ControlOrMeta+l");
    await expect(page.getByTitle("Loop the arrangement between the loop brace's ends (Ctrl+L)")).toHaveAttribute("aria-pressed", "true");
    await record(page, studio, 5000);

    // A take for each time round: the first two, and the third if it ran
    // for a beat (0.5 s) or more.
    await expect.poll(async () => (await studio.autosavedClips()).some((c) => c.lane)).toBe(true);
    const seconds = (await studio.autosavedClips())[0].durationSeconds!;
    const last = seconds - 2 * Math.floor(seconds / 2);
    const expected = Math.ceil(seconds / 2) - (last > 0 && last < 0.5 ? 1 : 0);
    expect(expected).toBeGreaterThanOrEqual(2);
    await expect(takeLanes(page)).toHaveCount(expected);
    // The track plays the latest time round, wherever it went.
    await expect(compParts(page, expected)).toHaveCount(1);
    await expect(compParts(page, 1)).toHaveCount(0);

    // Saved, they all share the one recording.
    expect((await studio.autosavedClips()).filter((c) => c.lane)).toHaveLength(expected);
    expect((await studio.autosavedClips()).every((c) => c.audio)).toBe(true);
    expect(await studio.autosavedFileCount()).toBe(1);

    // And they come back.
    await page.reload();
    await expect(takeLanes(page)).toHaveCount(expected);
    await expect(compParts(page, expected)).toHaveCount(1);
  });
});

test.describe("MIDI", () => {
  test.beforeEach(async ({ page, studio }) => {
    await studio.open("Empty Project");
    // The computer keyboard plays a track that has an instrument.
    await studio.select("MIDI 1");
    await page.getByRole("group", { name: "Instrument" }).getByRole("button", { name: "Synth", exact: true }).click();
    await studio.header("MIDI 1").getByTitle("Arm this channel for recording and note input").click();
  });

  /** Records MIDI 1 from the marker, playing `keys` at their times (ms from
   * pressing Record), for `ms` in all. */
  async function recordMidi(page: Page, keys: [string, number][], ms: number) {
    const button = page.getByTitle("Record MIDI onto MIDI 1");
    await button.click();
    await expect(button).toHaveAttribute("aria-pressed", "true");
    const start = Date.now();
    for (const [key, at] of keys) {
      await page.waitForTimeout(Math.max(0, at - (Date.now() - start)));
      await page.keyboard.down(key);
      await page.waitForTimeout(120);
      await page.keyboard.up(key);
    }
    await page.waitForTimeout(Math.max(0, ms - (Date.now() - start)));
    await page.getByTitle("Stop").click();
    await expect(button).toHaveAttribute("aria-pressed", "false");
  }

  test("recording over a MIDI clip keeps it as a take; with overdub on, it adds to it", async ({ page, studio }) => {
    // A bar, then two bars (its last note is in the second) over it.
    await recordMidi(page, [["z", 200], ["x", 450], ["c", 700]], 900);
    await expect(studio.clipsOn("MIDI 1")).toHaveText([/3 notes/]);
    await recordMidi(page, [["z", 200], ["x", 2400]], 2600);
    await expect(takeLanes(page)).toHaveCount(2);
    await expect(studio.clipsOn("MIDI 1")).toHaveText([/2 notes/]);

    await page.getByRole("button", { name: "MIDI overdub" }).click();
    await expect(page.getByRole("button", { name: "MIDI overdub" })).toHaveAttribute("aria-pressed", "true");
    await recordMidi(page, [["c", 200], ["v", 400]], 600);
    await expect(studio.clipsOn("MIDI 1")).toHaveCount(2);
    await expect(takeLanes(page)).toHaveCount(2);
  });

  test("a MIDI loop recording makes a take of each time round something was played in", async ({ page }) => {
    await page.getByLabel("Start", { exact: true }).fill("1.1.1");
    await page.getByLabel("Start", { exact: true }).press("Enter");
    await page.getByLabel("Length", { exact: true }).fill("1.0.0");
    await page.getByLabel("Length", { exact: true }).press("Enter");
    await page.keyboard.press("ControlOrMeta+l");
    // One note the first time round (2 s), none the second, one the third.
    await recordMidi(page, [["z", 600], ["x", 4500]], 4900);
    await expect(takeLanes(page)).toHaveCount(2);
    await expect(takeLane(page, 1).locator("[data-take-clip]")).toContainText("Take 1");
  });
});

