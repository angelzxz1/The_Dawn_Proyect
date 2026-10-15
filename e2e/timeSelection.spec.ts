// Time selection: a span of time dragged out across lanes with the pointer
// tool, and what the keys and its menu do to it. In the Beat template, at
// the default zoom, with the grid at a bar: the Bass and Pad clips start at
// bar 3, the Lead's at bar 11.

import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";
import type { Studio } from "./studio";
import { toneWav } from "./wav";

const SELECTION = "[data-time-selection]";

/** Where bar 1 is on screen, and how wide a bar is. */
async function grid(studio: Studio) {
  const left = (await studio.lane("Bass").boundingBox())!.x;
  const bass = (await studio.clipsOn("Bass").first().boundingBox())!.x;
  return { left, bar: (bass - left) / 2 };
}
type Grid = Awaited<ReturnType<typeof grid>>;

/** Drags from a bar on one lane to a bar on another (a bar's start, plus a
 * little: the selection snaps to the bar). */
async function selectTime(page: Page, studio: Studio, g: Grid, [fromTrack, fromBar]: [string, number], [toTrack, toBar]: [string, number]) {
  const from = (await studio.lane(fromTrack).boundingBox())!;
  const to = (await studio.lane(toTrack).boundingBox())!;
  await page.mouse.move(g.left + (fromBar - 1) * g.bar + 3, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(g.left + (toBar - 1) * g.bar + 3, to.y + to.height / 2, { steps: 8 });
  await page.mouse.up();
}

/** The bars a track's clips start at, in order. */
function starts(studio: Studio, g: Grid, track: string) {
  return async () => {
    const boxes = await studio.clipsOn(track).evaluateAll((els) => els.map((el) => el.getBoundingClientRect().x));
    return boxes.map((x) => Math.round(((x - g.left) / g.bar + 1) * 10) / 10).sort((a, b) => a - b);
  };
}

/** Where the selection is on a lane, in bars: [start, end]. */
async function selectionOn(studio: Studio, g: Grid, track: string) {
  const box = (await studio.lane(track).locator(SELECTION).boundingBox())!;
  return [box.x, box.x + box.width].map((x) => Math.round(((x - g.left) / g.bar + 1) * 10) / 10);
}

test.beforeEach(async ({ studio }) => {
  await studio.open("Beat");
});

test("a drag on empty lane space selects time on the lanes it crosses; Delete empties it, as one undo step", async ({ page, studio }) => {
  const g = await grid(studio);
  const drums = await studio.clipsOn("808 Drums").count();
  await selectTime(page, studio, g, ["Bass", 2], ["Pad", 5]);
  await expect(studio.lane("Bass").locator(SELECTION)).toBeVisible();
  await expect(studio.lane("Pad").locator(SELECTION)).toBeVisible();
  await expect(studio.lane("808 Drums").locator(SELECTION)).toHaveCount(0);
  await expect(studio.lane("Lead").locator(SELECTION)).toHaveCount(0);
  expect(await selectionOn(studio, g, "Bass")).toEqual([2, 5]);

  await page.keyboard.press("Delete");
  // The clips began at bar 3: what's left begins at bar 5.
  await expect.poll(starts(studio, g, "Bass")).toEqual([5]);
  await expect.poll(starts(studio, g, "Pad")).toEqual([5]);
  await expect(studio.clipsOn("808 Drums")).toHaveCount(drums);

  await studio.undo();
  await expect.poll(starts(studio, g, "Bass")).toEqual([3]);
  await expect.poll(starts(studio, g, "Pad")).toEqual([3]);
});

test("Ctrl+D copies the selection right after itself and selects the copy, so it can go again", async ({ page, studio }) => {
  const g = await grid(studio);
  await selectTime(page, studio, g, ["Bass", 2], ["Bass", 4]);
  await page.keyboard.press("ControlOrMeta+d");
  // Bar 3's part of the clip, copied to bar 5; the clip after the copy
  // goes on from bar 6.
  await expect.poll(starts(studio, g, "Bass")).toEqual([3, 5, 6]);
  expect(await selectionOn(studio, g, "Bass")).toEqual([4, 6]);

  await page.keyboard.press("ControlOrMeta+d");
  await expect.poll(starts(studio, g, "Bass")).toEqual([3, 5, 7, 8]);
  expect(await selectionOn(studio, g, "Bass")).toEqual([6, 8]);
});

test("Ctrl+I inserts silence at the selection; Shift+Delete takes the time out", async ({ page, studio }) => {
  const g = await grid(studio);
  await selectTime(page, studio, g, ["Lead", 1], ["Lead", 3]);
  await page.keyboard.press("ControlOrMeta+i");
  await expect.poll(starts(studio, g, "Lead")).toEqual([13]);
  // Only the selected lanes move.
  await expect.poll(starts(studio, g, "Bass")).toEqual([3]);

  await page.keyboard.press("Shift+Delete");
  await expect.poll(starts(studio, g, "Lead")).toEqual([11]);
});

test("Ctrl+X cuts the selection; Ctrl+V puts it back at the next selection's start, on the same tracks", async ({ page, studio }) => {
  const g = await grid(studio);
  await selectTime(page, studio, g, ["Bass", 2], ["Bass", 5]);
  await page.keyboard.press("ControlOrMeta+x");
  await expect.poll(starts(studio, g, "Bass")).toEqual([5]);

  await selectTime(page, studio, g, ["Bass", 1], ["Bass", 2]);
  await page.keyboard.press("ControlOrMeta+v");
  // What was at bars 3-5 (a bar into the cut), now a bar into bar 1.
  await expect.poll(starts(studio, g, "Bass")).toEqual([2, 5]);
  expect(await selectionOn(studio, g, "Bass")).toEqual([1, 4]);

  await studio.undo();
  await expect.poll(starts(studio, g, "Bass")).toEqual([5]);
});

test("Esc, a click on a lane or picking a clip ends the selection", async ({ page, studio }) => {
  const g = await grid(studio);
  const selection = page.locator(SELECTION);
  await selectTime(page, studio, g, ["Bass", 2], ["Pad", 4]);
  await expect(selection).toHaveCount(2);
  await page.keyboard.press("Escape");
  await expect(selection).toHaveCount(0);

  await selectTime(page, studio, g, ["Bass", 2], ["Pad", 4]);
  await studio.lane("Lead").click({ position: { x: 20, y: 30 } });
  await expect(selection).toHaveCount(0);

  await selectTime(page, studio, g, ["Bass", 2], ["Pad", 4]);
  await studio.clipsOn("Lead").first().click({ position: { x: 20, y: 30 } });
  await expect(selection).toHaveCount(0);
  await expect(studio.clipsOn("Lead").first()).toHaveClass(/ring-2/);
});

test("right-clicking in the selection, on a clip or not, opens what can be done to it", async ({ page, studio }) => {
  const g = await grid(studio);
  await selectTime(page, studio, g, ["Bass", 2], ["Pad", 4]);
  const bass = (await studio.lane("Bass").boundingBox())!;
  // On the Bass clip, inside the selection.
  await page.mouse.click(g.left + 2.5 * g.bar, bass.y + bass.height / 2, { button: "right" });
  await expect(page.getByRole("button", { name: "Delete time (Shift+Delete)" })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.mouse.click(g.left + 1.5 * g.bar, bass.y + bass.height / 2, { button: "right" });
  await expect(page.getByRole("button", { name: "Paste copied time here (Ctrl+V)" })).toBeDisabled();
  await page.getByRole("button", { name: "Insert silence (Ctrl+I)" }).click();
  await expect.poll(starts(studio, g, "Bass")).toEqual([5]);
  await expect.poll(starts(studio, g, "Pad")).toEqual([5]);
  await expect.poll(starts(studio, g, "Lead")).toEqual([11]);
});

test("Ctrl+L loops the selection", async ({ page, studio }) => {
  const g = await grid(studio);
  await selectTime(page, studio, g, ["Bass", 2], ["Bass", 4]);
  await page.keyboard.press("ControlOrMeta+l");
  await expect(page.getByTitle("Loop on (Ctrl+L)")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Start", { exact: true })).toHaveValue("2.1.1");
  await expect(page.getByLabel("Length", { exact: true })).toHaveValue("2.0.0");
});

test("the parts of an audio clip cut by a selection keep their audio", async ({ page, studio }) => {
  await studio.addTrack("Audio");
  await studio.header("Audio 1").locator('input[type="file"][accept="audio/*"]').setInputFiles({ name: "tone.wav", mimeType: "audio/wav", buffer: toneWav(8) });
  await expect(studio.clipsOn("Audio 1")).toHaveCount(1);
  const g = await grid(studio);
  // From the empty start of the Bass lane down to the audio clip.
  await selectTime(page, studio, g, ["Bass", 2], ["Audio 1", 3]);
  await expect(studio.lane("Audio 1").locator(SELECTION)).toBeVisible();
  await page.keyboard.press("ControlOrMeta+x");
  await expect(studio.clipsOn("Audio 1")).toHaveCount(2);

  // Autosave writes each clip's audio with the song.
  const saved = () =>
    page.evaluate(
      () =>
        new Promise<{ clips: string[]; audio: string[] }>((resolve, reject) => {
          const open = indexedDB.open("dawn-project-db");
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const tx = open.result.transaction(["meta", "audioBlobs"]);
            const meta = tx.objectStore("meta").get("current");
            const keys = tx.objectStore("audioBlobs").getAllKeys();
            tx.oncomplete = () => {
              const project = meta.result as { clipsByChannel: Record<string, { id: string; kind: string }[]> } | undefined;
              const clips = Object.values(project?.clipsByChannel ?? {})
                .flat()
                .filter((c) => c.kind === "audio")
                .map((c) => c.id);
              resolve({ clips: clips.sort(), audio: (keys.result as string[]).filter((k) => clips.includes(k)).sort() });
            };
          };
        })
    );
  await expect.poll(async () => {
    const { clips, audio } = await saved();
    return clips.length === 2 && audio.length === 2;
  }).toBe(true);
});
