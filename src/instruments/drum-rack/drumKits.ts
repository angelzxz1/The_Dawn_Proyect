// Drum Rack kits: the factory ones (synthesized, so nothing to download)
// and the ones you save (kept in this browser; a kit that uses samples
// keeps pointing at them, so they play wherever those files are loaded).

import { defaultDrumKit, defaultKitPads, normalizeDrumKit, type DrumKitParams, type DrumPadParams } from "./drumParams";

export interface DrumKitPreset {
  id: string;
  name: string;
  factory: boolean;
  kit: DrumKitParams;
  /** The sound pack it came with (removed with the pack). */
  pack?: string;
}

/** The default kit's pads, with changes by pad name. */
function kit(name: string, changes: Record<string, Partial<DrumPadParams>>, all: Partial<DrumPadParams> = {}): DrumKitPreset {
  const pads = defaultKitPads().map((p) => ({ ...p, ...all, ...(changes[p.name] ?? {}) }));
  return { id: `factory:${name}`, name, factory: true, kit: { version: 1, kit: name, pads, volume: 0 } };
}

export const FACTORY_KITS: DrumKitPreset[] = [
  { id: "factory:Dawn 808", name: "Dawn 808", factory: true, kit: defaultDrumKit() },
  kit("909 Punch", {
    Kick: { decay: 0.32, character: 0.85, tone: 0.75, drive: 0.25, tune: 2 },
    Snare: { decay: 0.45, character: 0.85, tone: 0.75, tune: 2 },
    Clap: { decay: 0.4, character: 0.35, tone: 0.55 },
    "Closed Hat": { tone: 0.85, character: 0.35, decay: 0.1 },
    "Open Hat": { tone: 0.85, character: 0.35, decay: 0.5 },
    "Pedal Hat": { tone: 0.75, character: 0.35 },
    Crash: { tone: 0.7, decay: 0.75 },
    Ride: { tone: 0.8, character: 0.6 },
  }),
  kit("Trap", {
    Kick: { decay: 0.9, character: 0.3, tone: 0.2, tune: -3, drive: 0.35, level: -2 },
    Snare: { model: "clap", decay: 0.35, character: 0.3, tone: 0.65, name: "Snare" },
    Clap: { decay: 0.5, character: 0.6, tone: 0.5 },
    "Closed Hat": { decay: 0.06, tone: 0.95, character: 0.6, level: -14 },
    "Pedal Hat": { decay: 0.04, tone: 0.9, character: 0.6, level: -16, name: "Tick Hat" },
    "Open Hat": { decay: 0.35, tone: 0.9, character: 0.6 },
    Rim: { character: 0.8, level: -8 },
  }),
  kit(
    "Lo-Fi",
    {
      Kick: { decay: 0.35, character: 0.35, tone: 0.1, drive: 0.55 },
      Snare: { decay: 0.35, character: 0.5, tone: 0.3, drive: 0.4 },
      "Closed Hat": { tone: 0.3, character: 0.2 },
      "Open Hat": { tone: 0.3, character: 0.2, decay: 0.45 },
      Shaker: { level: -12 },
    },
    { filter: -0.3, resonance: 0.2, drive: 0.3 }
  ),
  kit("Electro", {
    Kick: { decay: 0.3, character: 1, tone: 0.9, drive: 0.4 },
    Snare: { decay: 0.3, character: 0.95, tone: 0.9, drive: 0.35 },
    Clap: { character: 0.2, tone: 0.8 },
    "Closed Hat": { character: 0.9, tone: 0.9 },
    "Open Hat": { character: 0.9, tone: 0.9, decay: 0.45 },
    Cowbell: { level: -9, decay: 0.45 },
    Clave: { level: -9, character: 0.7 },
    "Low Tom": { character: 0.9, decay: 0.4, tune: -7 },
    "Mid Tom": { character: 0.9, decay: 0.4, tune: -2 },
    "High Tom": { character: 0.9, decay: 0.4, tune: 3 },
  }),
  kit("Techno", {
    Kick: { decay: 0.42, character: 0.7, tone: 0.5, drive: 0.55, tune: -2, level: -2 },
    Snare: { model: "clap", decay: 0.3, character: 0.45, tone: 0.45 },
    "Closed Hat": { decay: 0.09, tone: 0.75, character: 0.5, filter: 0.3 },
    "Open Hat": { decay: 0.3, tone: 0.8, character: 0.5, filter: 0.3, level: -12 },
    Ride: { decay: 0.7, character: 0.85, tone: 0.7, level: -12 },
    Rim: { level: -8, character: 0.9 },
  }),
  kit("Studio", {
    Kick: { decay: 0.3, character: 0.25, tone: 0.25, tune: 3, drive: 0.1 },
    Snare: { decay: 0.55, character: 0.75, tone: 0.45, tune: 1 },
    "Closed Hat": { character: 0.15, tone: 0.55, decay: 0.14 },
    "Pedal Hat": { character: 0.15, tone: 0.45 },
    "Open Hat": { character: 0.15, tone: 0.55, decay: 0.6 },
    "Low Tom": { decay: 0.7, character: 0.3, tone: 0.6, tune: -4 },
    "Mid Tom": { decay: 0.65, character: 0.3, tone: 0.6, tune: 1 },
    "High Tom": { decay: 0.6, character: 0.3, tone: 0.6, tune: 5 },
    Crash: { decay: 0.85, character: 0.05, tone: 0.55 },
    Ride: { decay: 0.75, character: 0.8, tone: 0.55 },
  }),
  // A live rock kit, synthesized: a deep kick with beater click, a fat
  // snare with plenty of wires, long toms, washy hats and big cymbals.
  kit("Rock Kit", {
    Kick: { decay: 0.4, character: 0.55, tone: 0.7, tune: -2, drive: 0.15, level: -2 },
    Snare: { decay: 0.6, character: 0.8, tone: 0.55, tune: -1, drive: 0.15, level: -4 },
    Clap: { decay: 0.35, character: 0.4, tone: 0.5, level: -9 },
    "Closed Hat": { decay: 0.16, tone: 0.5, character: 0.45, level: -11 },
    "Pedal Hat": { decay: 0.1, tone: 0.4, character: 0.45, level: -13 },
    "Open Hat": { decay: 0.65, tone: 0.5, character: 0.45, level: -12 },
    "Low Tom": { decay: 0.8, character: 0.45, tone: 0.65, tune: -7, level: -4 },
    "Mid Tom": { decay: 0.75, character: 0.45, tone: 0.65, tune: -2, level: -4 },
    "High Tom": { decay: 0.7, character: 0.45, tone: 0.65, tune: 3, level: -4 },
    Crash: { decay: 0.95, character: 0.1, tone: 0.5, level: -9 },
    Ride: { decay: 0.85, character: 0.85, tone: 0.5, level: -12 },
  }),
  // Brushes for ballads and shuffles: a swishing snare, a soft kick and
  // a gentle ride, all a little darker.
  kit(
    "Brushes",
    {
      Kick: { decay: 0.35, character: 0.15, tone: 0.05, tune: 2, level: -6 },
      Snare: { decay: 0.75, character: 0.95, tone: 0.15, tune: 3, filter: -0.25, velocity: 0.9, level: -8 },
      Clap: { decay: 0.6, character: 0.9, tone: 0.2, filter: -0.3, level: -12 },
      "Closed Hat": { decay: 0.1, tone: 0.3, character: 0.3, level: -15 },
      "Open Hat": { decay: 0.45, tone: 0.3, character: 0.3, level: -15 },
      Ride: { decay: 0.8, character: 0.8, tone: 0.4, level: -11 },
      Crash: { decay: 0.8, character: 0.15, tone: 0.3, level: -13 },
    },
    { velocity: 0.85 }
  ),
  kit("Percussion", {
    Kick: { decay: 0.3, character: 0.2, tone: 0.1, level: -8 },
    Rim: { level: -6 },
    Snap: { level: -6 },
    Cowbell: { level: -8 },
    Shaker: { level: -8, character: 0.7 },
    Clave: { level: -7 },
    "Low Tom": { tune: 7, decay: 0.35, character: 0.2, name: "Low Conga" },
    "Mid Tom": { tune: 12, decay: 0.3, character: 0.2, name: "Mid Conga" },
    "High Tom": { tune: 17, decay: 0.25, character: 0.2, name: "High Conga" },
  }),
];

const STORAGE_KEY = "dawn-drum-kits-v1";

function readUser(): DrumKitPreset[] {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((r) => r && typeof r.id === "string" && typeof r.name === "string")
      .map((r) => ({
        id: r.id,
        name: String(r.name).slice(0, 60),
        factory: false,
        kit: normalizeDrumKit(r.kit),
        ...(typeof r.pack === "string" && r.pack ? { pack: r.pack as string } : {}),
      }));
  } catch {
    return [];
  }
}

let cache: DrumKitPreset[] | null = null;
let all: DrumKitPreset[] | null = null;
const listeners = new Set<() => void>();

function user(): DrumKitPreset[] {
  if (!cache) cache = readUser();
  return cache;
}

/** Factory kits, then yours (the same array until something changes). */
export function allDrumKits(): DrumKitPreset[] {
  if (!all) all = [...FACTORY_KITS, ...user()];
  return all;
}

export function serverDrumKits(): DrumKitPreset[] {
  return FACTORY_KITS;
}

export function subscribeDrumKits(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function changed(list: DrumKitPreset[]) {
  cache = list;
  all = null;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list.map(({ id, name, kit, pack }) => ({ id, name, kit, ...(pack ? { pack } : {}) }))));
  } catch {
    // Storage full or blocked: it lasts until the page closes.
  }
  listeners.forEach((fn) => fn());
}

/** Saves the kit as yours (replacing one of yours with the same name). */
export function saveDrumKit(name: string, kit: DrumKitParams): DrumKitPreset {
  const clean = name.trim().slice(0, 60) || "My Kit";
  const list = user();
  const existing = list.find((k) => k.name.toLowerCase() === clean.toLowerCase());
  const preset: DrumKitPreset = { id: existing?.id ?? `user:${Date.now().toString(36)}`, name: clean, factory: false, kit: { ...structuredClone(kit), kit: clean } };
  changed(existing ? list.map((k) => (k.id === existing.id ? preset : k)) : [...list, preset]);
  return preset;
}

/** A pack's kits, added under that pack (names that are taken get the
 * pack's name after them). `mapFile` points sample pads at the pack's
 * copies; a pad whose sample is missing plays its synth voice. */
export function addPackKits(packId: string, packName: string, raw: unknown[], mapFile: (path: string) => string | null): number {
  const list = user().filter((k) => k.pack !== packId);
  const added: DrumKitPreset[] = [];
  raw.forEach((item, i) => {
    const r = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    if (typeof r.name !== "string" || !r.name.trim()) return;
    const kit = normalizeDrumKit(r.kit);
    kit.pads = kit.pads.map((pad) => {
      if (!pad.sample) return pad;
      const id = mapFile(pad.sample.id);
      if (id) return { ...pad, sample: { ...pad.sample, id } };
      const rest = { ...pad };
      delete rest.sample;
      return { ...rest, source: "synth" as const };
    });
    let name = r.name.trim().slice(0, 60);
    if ([...FACTORY_KITS, ...list, ...added].some((k) => k.name.toLowerCase() === name.toLowerCase())) name = `${name} (${packName})`.slice(0, 60);
    added.push({ id: `pack:${packId}:${i}`, name, factory: false, kit: { ...kit, kit: name }, pack: packId });
  });
  changed([...list, ...added]);
  return added.length;
}

export function removePackKits(packId: string): void {
  changed(user().filter((k) => k.pack !== packId));
}

/** Your own kits (not factory, not from packs). */
export function ownDrumKits(): DrumKitPreset[] {
  return user().filter((k) => !k.pack);
}

export function deleteDrumKit(id: string): void {
  changed(user().filter((k) => k.id !== id));
}
