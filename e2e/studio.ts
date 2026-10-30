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
    const all = this.page.locator("[data-clip-id]");
    return text ? all.filter({ hasText: text }) : all;
  }

  /** The clips on one track. */
  clipsOn(track: string): Locator {
    return this.lane(track).locator("[data-clip-id]");
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

  /** Each autosaved track's height (unset: the standard one), by name. */
  autosavedHeights(): Promise<Record<string, number | undefined> | null> {
    return this.page.evaluate(
      () =>
        new Promise<Record<string, number | undefined> | null>((resolve, reject) => {
          const open = indexedDB.open("dawn-project-db");
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const get = open.result.transaction("meta").objectStore("meta").get("current");
            get.onerror = () => reject(get.error);
            get.onsuccess = () =>
              resolve(get.result ? Object.fromEntries(get.result.channels.map((c: { name: string; height?: number }) => [c.name, c.height])) : null);
          };
        })
    );
  }

  async undo(): Promise<void> {
    await this.page.getByTitle("Undo (Ctrl/Cmd+Z)").click();
  }

  /** The clips in the autosaved working copy (on the tracks' lanes, or in
   * a take with `lane`), each with whether its audio was saved with it. */
  autosavedClips(): Promise<SavedClip[]> {
    return this.page.evaluate(
      () =>
        new Promise<SavedClip[]>((resolve, reject) => {
          const open = indexedDB.open("dawn-project-db");
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const tx = open.result.transaction(["meta", "audioBlobs"]);
            const meta = tx.objectStore("meta").get("current");
            const aliasesReq = tx.objectStore("meta").get("current:aliases");
            const keys = tx.objectStore("audioBlobs").getAllKeys();
            tx.oncomplete = () => {
              type Raw = Omit<SavedClip, "audio" | "lane">;
              const project = meta.result as
                | { clipsByChannel: Record<string, Raw[]>; takesByChannel?: Record<string, { id: string; clips: Raw[] }[]> }
                | undefined;
              // A file clips share is stored once, under one of them.
              const stored = new Set(keys.result as string[]);
              const aliases = (aliasesReq.result ?? {}) as Record<string, string>;
              const saved = (id: string) => stored.has(id) || stored.has(aliases[id]);
              const takes = Object.values(project?.takesByChannel ?? {}).flatMap((lanes) => lanes.flatMap((lane) => lane.clips.map((c) => ({ ...c, lane: lane.id }))));
              resolve(
                [...Object.values(project?.clipsByChannel ?? {}).flat(), ...takes].map(({ id, kind, name, color, fileName, durationSeconds, lane }: Raw & { lane?: string }) => ({
                  id,
                  kind,
                  name,
                  color,
                  fileName,
                  durationSeconds,
                  ...(lane ? { lane } : {}),
                  audio: saved(id),
                }))
              );
            };
          };
        })
    );
  }

  /** How many audio files autosave keeps. */
  autosavedFileCount(): Promise<number> {
    return this.page.evaluate(
      () =>
        new Promise<number>((resolve, reject) => {
          const open = indexedDB.open("dawn-project-db");
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const count = open.result.transaction("audioBlobs").objectStore("audioBlobs").count();
            count.onsuccess = () => resolve(count.result);
            count.onerror = () => reject(count.error);
          };
        })
    );
  }

  /** An autosaved clip's audio file: how long it is and its loudest sample
   * (0 to 1), or null if there's none. */
  autosavedAudio(clipId: string): Promise<{ seconds: number; peak: number } | null> {
    return this.page.evaluate(
      (id) =>
        new Promise<{ seconds: number; peak: number } | null>((resolve, reject) => {
          const open = indexedDB.open("dawn-project-db");
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const tx = open.result.transaction(["meta", "audioBlobs"]);
            const aliases = tx.objectStore("meta").get("current:aliases");
            const own = tx.objectStore("audioBlobs").get(id);
            tx.onerror = () => reject(tx.error);
            tx.oncomplete = () => {
              const owner = ((aliases.result ?? {}) as Record<string, string>)[id];
              if (own.result || !owner) return void finish(own.result as Blob | undefined);
              const again = open.result.transaction("audioBlobs").objectStore("audioBlobs").get(owner);
              again.onsuccess = () => void finish(again.result as Blob | undefined);
              again.onerror = () => reject(again.error);
            };
            const finish = async (blob: Blob | undefined) => {
              if (!blob) return resolve(null);
              const buffer = await new OfflineAudioContext(1, 1, 48000).decodeAudioData(await blob.arrayBuffer());
              let peak = 0;
              for (let c = 0; c < buffer.numberOfChannels; c++) buffer.getChannelData(c).forEach((v) => (peak = Math.max(peak, Math.abs(v))));
              resolve({ seconds: buffer.duration, peak });
            };
          };
        }),
      clipId
    );
  }

  /** The transport's BPM field. */
  get bpm(): Locator {
    return this.page.locator('label:has-text("BPM") input');
  }

  /** The tempo lane, under the loop brace. */
  get tempoLane(): Locator {
    return this.page.getByTestId("tempo-lane");
  }

  /** The section lane, under the tempo lane. */
  get markerLane(): Locator {
    return this.page.getByTestId("marker-lane");
  }

  /** Where the playhead is (px from the song's start). */
  playheadX(): Promise<number> {
    return this.page.getByTestId("playhead").evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).m41);
  }

  /** The autosaved tempo map and section markers, and where each track's
   * clips and their notes are (s), by track name. */
  autosavedTiming(): Promise<SavedTiming | null> {
    return this.page.evaluate(
      () =>
        new Promise<SavedTiming | null>((resolve, reject) => {
          const open = indexedDB.open("dawn-project-db");
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const get = open.result.transaction("meta").objectStore("meta").get("current");
            get.onerror = () => reject(get.error);
            get.onsuccess = () => {
              type Raw = { offset: number; length: number; notes?: { time: number; duration: number }[]; warp?: { bpm: number; mode: string } };
              const p = get.result as
                | {
                    bpm: number;
                    tempoChanges?: { beat: number; bpm: number }[];
                    markers?: { beat: number; name: string }[];
                    channels: { id: string; name: string }[]; clipsByChannel: Record<string, Raw[]> }
                | undefined;
              if (!p) return resolve(null);
              const clips = Object.fromEntries(
                p.channels.map((c) => [
                  c.name,
                  (p.clipsByChannel[c.id] ?? []).map((clip) => ({
                    offset: clip.offset,
                    length: clip.length,
                    notes: (clip.notes ?? []).map((n) => ({ time: n.time, duration: n.duration })),
                    ...(clip.warp ? { warp: { bpm: clip.warp.bpm, mode: clip.warp.mode } } : {}),
                  })),
                ])
              );
              resolve({
                bpm: p.bpm,
                tempoChanges: p.tempoChanges ?? [],
                markers: (p.markers ?? []).map((m) => ({ beat: m.beat, name: m.name })),
                clips,
              });
            };
          };
        })
    );
  }
}

/** The autosaved timing (Studio.autosavedTiming). */
export interface SavedTiming {
  bpm: number;
  tempoChanges: { beat: number; bpm: number }[];
  markers: { beat: number; name: string }[];
  clips: Record<string, { offset: number; length: number; notes: { time: number; duration: number }[]; warp?: { bpm: number; mode: string } }[]>;
}

/** A clip as autosaved (Studio.autosavedClips). */
export interface SavedClip {
  id: string;
  kind: string;
  name?: string;
  color?: string;
  fileName?: string;
  /** How long its file is (audio clips). */
  durationSeconds?: number;
  /** Its audio was saved with it (audio clips). */
  audio: boolean;
  /** The take lane it's in, if it's a take's. */
  lane?: string;
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
