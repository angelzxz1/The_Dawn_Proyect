// The effects: every one goes on a track and its window opens; presets,
// and the sidechain's loop check.

import { test, expect } from "./fixtures";
import { EFFECT_LABELS, EFFECT_TYPES } from "../src/effects/registry";
import { FACTORY_CABS } from "../src/effects/ir-loader/cabIrs";

for (const type of EFFECT_TYPES) {
  const label = EFFECT_LABELS[type];
  test(`${label}: added from the browser, its window opens and closes`, async ({ page, studio }) => {
    await studio.open("Empty Project");
    await studio.select("Audio 1");
    await studio.addEffect(label);
    const close = page.getByTitle("Close", { exact: true });
    await studio.openLastEffect();
    await expect(close).toHaveCount(1);
    await close.click();
    await expect(close).toHaveCount(0);
  });
}

test("a preset changes the multiband compressor's curve", async ({ page, studio }) => {
  await studio.open("Empty Project");
  await studio.select("Audio 1");
  await studio.addEffect("Multiband Compressor");
  await studio.openLastEffect();
  const curve = page.locator('svg[aria-label="Transfer curve"] path').first();
  const before = await curve.getAttribute("d");
  await page.getByRole("button", { name: "Next preset" }).last().click();
  await expect(curve).not.toHaveAttribute("d", before!);
});

test("the IR loader loads one of Dawn's cabinets from its browser", async ({ page, studio }) => {
  await studio.open("Empty Project");
  await studio.select("Audio 1");
  await studio.addEffect("IR Loader");
  await studio.openLastEffect();
  const [first, second] = FACTORY_CABS;
  await page.getByRole("button", { name: "Browse cabinets" }).click();
  await page.getByRole("button", { name: new RegExp(`^${second.name}`) }).click();
  // The list closes, and the window shows the cabinet loaded.
  await expect(page.getByRole("button", { name: new RegExp(`^${first.name}`) })).toHaveCount(0);
  await expect(page.getByText(second.name).first()).toBeVisible();
});

test("a sidechain source that would make a loop is marked, until the routing changes", async ({ page, studio }) => {
  await studio.open("Beat");
  await studio.addTrack("Audio");
  // Lead plays into Audio 1, so Audio 1 can't key a compressor on Lead.
  await studio.select("Lead");
  const output = page.locator('label:has-text("Audio to") select').first();
  await output.selectOption({ label: "Track: Audio 1" });
  await studio.addEffect("Compressor");
  await studio.openLastEffect();
  const source = page.locator('select:has(optgroup[label="Tracks"]) option', { hasText: "Audio 1" });
  await expect(source).toHaveText(/loop/);

  await output.selectOption({ index: 0 });
  await expect(source).not.toHaveText(/loop/);
});
