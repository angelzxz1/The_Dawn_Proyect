// The studio (/app) through its UI, for the browser tests: opening a
// template, finding a track's header and lane, its clips, the FX rack and
// the effect browser.

import { expect, type Locator, type Page } from "@playwright/test";
import { PROJECT_TEMPLATES } from "../src/project/templates";

export type TemplateName = (typeof PROJECT_TEMPLATES)[number]["name"];

/** The tracks a template starts with, in order. */
export function templateTracks(name: TemplateName): string[] {
  const template = PROJECT_TEMPLATES.find((t) => t.name === name)!;
  return template.build().channels.map((c) => c.name);
}

export class Studio {
  constructor(readonly page: Page) {}

  /** Opens the app and starts from a template. */
  async open(template: TemplateName = "Empty Project"): Promise<void> {
    await this.page.goto("/app");
    await this.page
      .getByRole("dialog", { name: "Start" })
      .getByRole("button", { name: new RegExp(`^${escape(template)}`) })
      .click();
    await expect(this.page.getByRole("dialog", { name: "Start" })).toBeHidden();
    await expect(this.trackNames).toHaveText(templateTracks(template));
  }

  /** Every track's name, top to bottom. */
  get trackNames(): Locator {
    return this.page.getByRole("group", { name: /^Track / }).locator('span[title="Double-click to rename"]');
  }

  header(track: string): Locator {
    return this.page.getByRole("group", { name: `Track ${track}`, exact: true });
  }

  lane(track: string): Locator {
    return this.page.getByRole("group", { name: `${track} lane`, exact: true });
  }

  /** Every clip on the timeline, or the ones showing `text` ("12 notes"). */
  clips(text?: string | RegExp): Locator {
    const all = this.page.locator('[title^="Drag to move"]');
    return text ? all.filter({ hasText: text }) : all;
  }

  /** The clips on one track. */
  clipsOn(track: string): Locator {
    return this.lane(track).locator('[title^="Drag to move"]');
  }

  /** Drags with the mouse from the middle of `from` by (dx, dy) pixels. */
  async drag(from: Locator, dx: number, dy = 0): Promise<void> {
    await from.scrollIntoViewIfNeeded();
    const box = (await from.boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await this.page.mouse.move(x, y);
    await this.page.mouse.down();
    await this.page.mouse.move(x + dx, y + dy, { steps: 10 });
    await this.page.mouse.up();
  }

  /** A track's name on its header (click it to select the track). */
  name(track: string): Locator {
    return this.header(track).locator('span[title="Double-click to rename"]');
  }

  /** Selects a track, which shows its FX rack. */
  async select(track: string): Promise<void> {
    await this.name(track).click();
    await expect(this.page.getByText(`FX — ${track}`, { exact: true })).toBeVisible();
  }

  async addTrack(type: "Audio" | "MIDI"): Promise<void> {
    const count = await this.trackNames.count();
    await this.page.getByRole("button", { name: `+ ${type}`, exact: true }).click();
    await expect(this.trackNames).toHaveCount(count + 1);
  }

  /** Adds an effect from the browser to the selected track's rack. */
  async addEffect(label: string): Promise<void> {
    const cards = this.page.locator('button[title="Expand"]');
    const count = await cards.count();
    await this.page.locator('div[title^="Drag onto the FX rack"]', { hasText: new RegExp(`^${escape(label)}$`) }).click();
    await expect(cards).toHaveCount(count + 1);
  }

  /** Opens the window of the last effect in the rack. */
  async openLastEffect(): Promise<void> {
    await this.page.getByTitle("Expand", { exact: true }).last().click();
  }

  /** Picks an item from the File menu. */
  async fileMenu(item: string | RegExp): Promise<void> {
    await this.page.getByRole("button", { name: /^File/ }).click();
    await this.page.getByRole("menuitem", { name: item }).click();
  }

  /** The tracks in the autosaved working copy (IndexedDB), or null. */
  autosavedTracks(): Promise<string[] | null> {
    return this.page.evaluate(
      () =>
        new Promise<string[] | null>((resolve, reject) => {
          const open = indexedDB.open("dawn-project-db");
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const get = open.result.transaction("meta").objectStore("meta").get("current");
            get.onerror = () => reject(get.error);
            get.onsuccess = () => resolve(get.result ? get.result.channels.map((c: { name: string }) => c.name) : null);
          };
        })
    );
  }

  async undo(): Promise<void> {
    await this.page.getByTitle("Undo (Ctrl/Cmd+Z)").click();
  }

  /** The transport's BPM field. */
  get bpm(): Locator {
    return this.page.locator('label:has-text("BPM") input');
  }
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
