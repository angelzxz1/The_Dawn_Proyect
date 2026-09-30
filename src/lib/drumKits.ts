// Drum Rack kits: the factory ones (synthesized, so nothing to download)
// and the ones you save (kept in this browser; a kit that uses samples
// keeps pointing at them, so they play wherever those files are loaded).

import { defaultDrumKit, defaultKitPads, normalizeDrumKit, type DrumKitParams, type DrumPadParams } from "./drumParams";

export interface DrumKitPreset {
  id: string;
  name: string;
  factory: boolean;
  kit: DrumKitParams;
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
      .map((r) => ({ id: r.id, name: String(r.name).slice(0, 60), factory: false, kit: normalizeDrumKit(r.kit) }));
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
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list.map(({ id, name, kit }) => ({ id, name, kit }))));
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

export function deleteDrumKit(id: string): void {
  changed(user().filter((k) => k.id !== id));
}
