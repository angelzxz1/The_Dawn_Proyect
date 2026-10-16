// The instruments: picking one for a MIDI track, their windows, and
// playing notes from the computer keyboard.

import { test, expect } from "./fixtures";

test("pick each instrument for a MIDI track, and undo back through them", async ({ page, studio }) => {
  await studio.open("Empty Project");
  await studio.select("MIDI 1");
  const slot = page.getByRole("group", { name: "Instrument" });
  const pick = (name: string) => slot.getByRole("button", { name, exact: true }).click();
  const picked = (name: string) => expect(slot.getByRole("button", { name, exact: true })).toHaveAttribute("aria-pressed", "true");

  await pick("Synth");
  await picked("Synth");
  await page.getByTitle("Open the synth").first().click();
  await expect(page.getByRole("dialog").filter({ has: page.getByTitle("Close") }).last()).toBeVisible();
  await page.keyboard.press("Escape");

  await pick("Drums");
  await picked("Drums");
  await page.getByTitle("Open the Drum Rack").click();
  await page.keyboard.press("Escape");

  // The piano has no card or window.
  await pick("Piano");
  await picked("Piano");
  await expect(page.getByTitle("Open the Drum Rack")).toHaveCount(0);
  await expect(page.getByTitle("Open the synth")).toHaveCount(0);

  await pick("None");
  await expect(slot.getByText(/No instrument loaded/)).toBeVisible();

  for (const name of ["Piano", "Drums", "Synth"]) {
    await studio.undo();
    await picked(name);
  }
});

test("the Beat's drum rack and synth windows open", async ({ page, studio }) => {
  await studio.open("Beat");
  await studio.select("808 Drums");
  await page.getByTitle("Open the Drum Rack").click();
  const drums = page.getByRole("dialog").last();
  await expect(drums).toContainText("Kick");
  await page.keyboard.press("Escape");
  await expect(drums).toBeHidden();

  await studio.select("Bass");
  await page.getByTitle("Open the synth").first().click();
  await expect(page.getByRole("dialog").last()).toBeVisible();
  await page.keyboard.press("Escape");
});

test("the computer keyboard plays the armed track, and a held key lets go when the octave changes", async ({ page, studio }) => {
  await studio.open("Beat");
  await studio.header("Bass").getByTitle("Arm this channel for recording and note input").click();
  await page.getByRole("button", { name: /Keys/ }).first().click();
  const keys = page.getByRole("dialog", { name: "Bass — keys" });
  await expect(keys).toBeVisible();
  const lit = keys.locator("div.bg-accent");
  await expect(lit).toHaveCount(0);

  await page.keyboard.down("z");
  await expect(lit).toHaveCount(1);
  await keys.getByRole("button", { name: "+", exact: true }).click();
  await expect(lit).toHaveCount(0);
  await page.keyboard.up("z");
  await expect(lit).toHaveCount(0);
});

test("the keys name the chord being played, in E Major until a scale is picked", async ({ page, studio }) => {
  await studio.open("Beat");
  await studio.header("Bass").getByTitle("Arm this channel for recording and note input").click();
  await page.getByRole("button", { name: /Keys/ }).first().click();
  const readout = page.getByRole("dialog", { name: "Bass — keys" }).getByTestId("chord-readout");
  await expect(readout).toHaveText("Chords in E Major");

  // E, G# and B from the Q row.
  await page.keyboard.down("e");
  await page.keyboard.down("6");
  await page.keyboard.down("u");
  await expect(readout.locator("[data-chord-name]")).toHaveText("E");
  await expect(readout.locator("[data-chord-degree]")).toHaveText("I");
  await expect(readout).toContainText("in E Major");
  for (const key of ["e", "6", "u"]) await page.keyboard.up(key);
  await expect(readout).toHaveText("Chords in E Major");

  // With A Minor picked, the same chord is the fifth, raised from the key.
  await page.getByTitle("Highlight scale notes").first().click();
  const toolbar = page.getByTitle("Highlight scale notes").first().locator("..");
  await toolbar.locator("select").first().selectOption("A");
  await toolbar.locator("select").nth(1).selectOption("Natural Minor");
  await expect(readout).toHaveText("Chords in A Natural Minor");
  await page.keyboard.down("e");
  await page.keyboard.down("6");
  await page.keyboard.down("u");
  await expect(readout.locator("[data-chord-degree]")).toHaveText("V");
  await expect(readout).toContainText("outside A Natural Minor");
  for (const key of ["e", "6", "u"]) await page.keyboard.up(key);
});
