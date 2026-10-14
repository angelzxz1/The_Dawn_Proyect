// Daybreak's presets: the factory sounds, and the ones you save (kept in
// this browser, like the effects' presets).

import {
  BIPOLAR_SOURCES,
  defaultEnv,
  defaultFilter,
  defaultLfo,
  defaultOsc,
  initSynthParams,
  normalizeSynthParams,
  type ModDest,
  type ModSource,
  type SynthParams,
} from "./synthParams";

export const PRESET_CATEGORIES = ["Bass", "Lead", "Pad", "Pluck", "Keys", "FX"] as const;
export type PresetCategory = (typeof PRESET_CATEGORIES)[number];

export interface SynthPreset {
  id: string;
  name: string;
  category: PresetCategory;
  factory: boolean;
  params: SynthParams;
  /** The sound pack it came with (removed with the pack). */
  pack?: string;
}

let routeCounter = 0;
function mod(p: SynthParams, source: ModSource, dest: ModDest, amount: number, bipolar = BIPOLAR_SOURCES.includes(source)) {
  routeCounter += 1;
  p.mods.push({ id: `f${routeCounter}`, source, dest, amount, bipolar });
}

/** A vibrato of `semitones` on both oscillators. */
function vibrato(p: SynthParams, source: ModSource, semitones: number) {
  mod(p, source, "osc1.transpose", semitones / 96, true);
  mod(p, source, "osc2.transpose", semitones / 96, true);
}

function build(name: string, category: PresetCategory, edit: (p: SynthParams) => void): SynthPreset {
  const p = initSynthParams();
  edit(p);
  p.preset = name;
  return { id: `factory:${name}`, name, category, factory: true, params: p };
}

export const FACTORY_SYNTH_PRESETS: SynthPreset[] = [
  build("Init", "Lead", () => {}),

  // --- Bass ---
  build("Dawn Sub", "Bass", (p) => {
    p.osc1 = defaultOsc({ position: 0.22, level: 0.6 });
    p.sub = { on: true, shape: "sine", octave: -1, level: 0.7, pan: 0, dest: "direct" };
    p.filter1 = defaultFilter({ type: "lp24", cutoff: 700, resonance: 0.15 });
    p.envs[0] = defaultEnv({ attack: 0.003, decay: 0.3, sustain: 0.85, release: 0.12 });
    p.envs[1] = defaultEnv({ decay: 0.18, sustain: 0 });
    mod(p, "env2", "filter1.cutoff", 0.18);
    p.voice = { ...p.voice, mode: "legato", glide: 0.04, velocity: 0.3, volume: -8 };
  }),
  build("Reese", "Bass", (p) => {
    p.osc1 = defaultOsc({ position: 0.5, unison: 4, detune: 0.32, blend: 0.9, width: 0.35, level: 0.7 });
    p.osc2 = defaultOsc({ position: 0.5, transpose: -12, level: 0.45, unison: 2, detune: 0.1, width: 0.2 });
    p.filter1 = defaultFilter({ type: "lp24", cutoff: 1300, resonance: 0.2, drive: 0.35 });
    p.lfos[2] = defaultLfo({ shape: "smooth", sync: false, rate: 0.3, mode: "free" });
    mod(p, "lfo3", "filter1.cutoff", 0.12);
    mod(p, "lfo3", "osc1.detune", 0.15);
    p.voice = { ...p.voice, mode: "legato", glide: 0.05, velocity: 0.2, volume: -9 };
  }),
  build("Acid Line", "Bass", (p) => {
    p.osc1 = defaultOsc({ position: 0.5, level: 0.8 });
    p.filter1 = defaultFilter({ type: "ladder", cutoff: 380, resonance: 0.78, drive: 0.35 });
    p.envs[0] = defaultEnv({ attack: 0.002, decay: 0.4, sustain: 0.7, release: 0.08 });
    p.envs[1] = defaultEnv({ attack: 0.001, decay: 0.28, sustain: 0, decayCurve: 0.7 });
    mod(p, "env2", "filter1.cutoff", 0.42);
    mod(p, "velocity", "filter1.cutoff", 0.14);
    p.voice = { ...p.voice, mode: "legato", glide: 0.07, velocity: 0.5, volume: -3 };
  }),
  build("Growler", "Bass", (p) => {
    p.osc1 = defaultOsc({ table: "growl", position: 0.3, unison: 3, detune: 0.12, width: 0.4, level: 0.75 });
    p.sub = { on: true, shape: "sine", octave: -1, level: 0.5, pan: 0, dest: "direct" };
    p.filter1 = defaultFilter({ type: "ladder", cutoff: 2600, resonance: 0.35, drive: 0.5 });
    p.lfos[0] = defaultLfo({ shape: "triangle", division: 10 });
    mod(p, "lfo1", "osc1.position", 0.55, false);
    mod(p, "lfo1", "filter1.cutoff", 0.2, false);
    p.voice = { ...p.voice, mode: "legato", glide: 0.03, velocity: 0.2, volume: -10 };
  }),
  build("Wobble", "Bass", (p) => {
    p.osc1 = defaultOsc({ table: "resonant", position: 0.35, unison: 2, detune: 0.1, level: 0.7 });
    p.osc2 = defaultOsc({ position: 0.5, transpose: -12, level: 0.4 });
    p.filter1 = defaultFilter({ type: "lp24", cutoff: 300, resonance: 0.45, drive: 0.4 });
    p.lfos[0] = defaultLfo({ shape: "sine", division: 10, mode: "trigger", phase: 0.75 });
    mod(p, "lfo1", "filter1.cutoff", 0.5, false);
    mod(p, "lfo1", "osc1.position", 0.4, false);
    mod(p, "macro1", "lfo1.rate", 0.25, false);
    p.voice = { ...p.voice, mode: "legato", glide: 0.04, velocity: 0.2, volume: -12 };
  }),
  build("FM Pluck Bass", "Bass", (p) => {
    p.osc1 = defaultOsc({ table: "fm", position: 0.15, level: 0.8 });
    p.sub = { on: true, shape: "triangle", octave: -1, level: 0.35, pan: 0, dest: "f1" };
    p.filter1 = defaultFilter({ type: "lp12", cutoff: 1800, resonance: 0.2 });
    p.envs[0] = defaultEnv({ decay: 0.5, sustain: 0.45, release: 0.1 });
    p.envs[1] = defaultEnv({ decay: 0.22, sustain: 0 });
    mod(p, "env2", "osc1.position", 0.45);
    p.voice = { ...p.voice, mode: "poly", polyphony: 4, velocity: 0.6, volume: -5 };
  }),

  // --- Lead ---
  build("Daybreak Lead", "Lead", (p) => {
    p.osc1 = defaultOsc({ table: "daybreak", position: 0.62, unison: 5, detune: 0.2, width: 0.6, level: 0.65 });
    p.osc2 = defaultOsc({ position: 0.5, transpose: 12, level: 0.25 });
    p.filter1 = defaultFilter({ type: "lp24", cutoff: 5200, resonance: 0.25 });
    p.envs[0] = defaultEnv({ attack: 0.005, decay: 0.4, sustain: 0.8, release: 0.25 });
    p.lfos[1] = defaultLfo({ shape: "sine", sync: false, rate: 5.5, mode: "free", fade: 0.5 });
    vibrato(p, "lfo2", 0.35);
    mod(p, "modwheel", "filter1.cutoff", 0.25, false);
    p.voice = { ...p.voice, mode: "legato", glide: 0.03, velocity: 0.4, volume: -7 };
  }),
  build("Sync Scream", "Lead", (p) => {
    p.osc1 = defaultOsc({ position: 0.5, warp: "sync", warpAmount: 0.25, unison: 2, detune: 0.08, level: 0.7 });
    p.filter1 = defaultFilter({ type: "lp12", cutoff: 9000, resonance: 0.15 });
    p.envs[1] = defaultEnv({ attack: 0.001, decay: 0.7, sustain: 0.2 });
    mod(p, "env2", "osc1.warpAmount", 0.45);
    mod(p, "modwheel", "osc1.warpAmount", 0.3, false);
    p.voice = { ...p.voice, mode: "legato", glide: 0.05, velocity: 0.3, volume: -8 };
  }),
  build("Pulse Lead", "Lead", (p) => {
    p.osc1 = defaultOsc({ table: "pulse", position: 0.15, level: 0.7 });
    p.osc2 = defaultOsc({ table: "pulse", position: 0.3, fine: 9, level: 0.45 });
    p.filter1 = defaultFilter({ type: "lp24", cutoff: 3800, resonance: 0.2 });
    p.lfos[0] = defaultLfo({ shape: "triangle", division: 3, mode: "free" });
    mod(p, "lfo1", "osc1.position", 0.35, false);
    mod(p, "lfo1", "osc2.position", -0.3, false);
    p.voice = { ...p.voice, mode: "poly", polyphony: 6, velocity: 0.4, volume: -8 };
  }),
  build("Vowel Lead", "Lead", (p) => {
    p.osc1 = defaultOsc({ table: "vowels", position: 0, unison: 3, detune: 0.1, width: 0.5, level: 0.75 });
    p.filter1 = defaultFilter({ type: "lp12", cutoff: 8000, resonance: 0.1 });
    p.lfos[0] = defaultLfo({ shape: "triangle", division: 3 });
    mod(p, "lfo1", "osc1.position", 0.8, false);
    p.lfos[1] = defaultLfo({ shape: "sine", sync: false, rate: 5, mode: "free", fade: 0.8 });
    vibrato(p, "lfo2", 0.3);
    p.voice = { ...p.voice, mode: "legato", glide: 0.04, velocity: 0.3, volume: -8 };
  }),
  build("Chip Arp", "Lead", (p) => {
    p.osc1 = defaultOsc({ table: "digital", position: 0.4, level: 0.6 });
    p.filter1 = defaultFilter({ on: false });
    p.envs[0] = defaultEnv({ attack: 0.001, decay: 0.18, sustain: 0.3, release: 0.05 });
    p.lfos[0] = defaultLfo({ shape: "stepped", division: 12 });
    mod(p, "lfo1", "osc1.position", 0.5, false);
    p.voice = { ...p.voice, mode: "poly", polyphony: 4, velocity: 0.3, volume: -3 };
  }),

  // --- Pad ---
  build("Sunrise Pad", "Pad", (p) => {
    p.osc1 = defaultOsc({ table: "daybreak", position: 0.25, unison: 7, detune: 0.28, width: 1, level: 0.6 });
    p.osc2 = defaultOsc({ table: "choir", position: 0.4, transpose: 12, level: 0.35, unison: 3, detune: 0.15 });
    p.filter1 = defaultFilter({ type: "lp24", cutoff: 1900, resonance: 0.15 });
    p.envs[0] = defaultEnv({ attack: 1.2, attackCurve: 0.3, decay: 1, sustain: 0.9, release: 2.6 });
    p.envs[2] = defaultEnv({ attack: 3.5, attackCurve: -0.3, decay: 1, sustain: 1, release: 3 });
    mod(p, "env3", "osc1.position", 0.45);
    mod(p, "env3", "filter1.cutoff", 0.12);
    p.lfos[2] = defaultLfo({ shape: "smooth", sync: false, rate: 0.25, mode: "free" });
    mod(p, "lfo3", "filter1.cutoff", 0.08);
    p.voice = { ...p.voice, velocity: 0.3, volume: -9 };
  }),
  build("Glass Pad", "Pad", (p) => {
    p.osc1 = defaultOsc({ table: "bells", position: 0.3, unison: 4, detune: 0.12, width: 0.9, level: 0.5 });
    p.osc2 = defaultOsc({ position: 0, transpose: 12, level: 0.35 });
    p.filter1 = defaultFilter({ type: "lp12", cutoff: 7000, resonance: 0.1 });
    p.filter2 = defaultFilter({ on: true, type: "hp12", cutoff: 220, resonance: 0.05 });
    p.envs[0] = defaultEnv({ attack: 0.8, decay: 1.5, sustain: 0.8, release: 3 });
    p.lfos[0] = defaultLfo({ shape: "sine", sync: false, rate: 0.2, mode: "free" });
    mod(p, "lfo1", "osc1.position", 0.2);
    p.voice = { ...p.voice, velocity: 0.3, volume: -9 };
  }),
  build("Choir Air", "Pad", (p) => {
    p.osc1 = defaultOsc({ table: "choir", position: 0.3, unison: 6, detune: 0.2, width: 1, level: 0.65 });
    p.noise = { on: true, color: "pink", level: 0.06, pan: 0, dest: "f1" };
    p.filter1 = defaultFilter({ type: "formant", cutoff: 1000, resonance: 0.35, morph: 0.2, mix: 0.7 });
    p.envs[0] = defaultEnv({ attack: 1, decay: 1, sustain: 1, release: 2.2 });
    p.lfos[2] = defaultLfo({ shape: "smooth", sync: false, rate: 0.15, mode: "free" });
    mod(p, "lfo3", "filter1.morph", 0.35, false);
    mod(p, "lfo3", "osc1.position", 0.2);
    p.voice = { ...p.voice, velocity: 0.2, volume: 1 };
  }),
  build("Analog Strings", "Pad", (p) => {
    p.osc1 = defaultOsc({ table: "analog", position: 0.4, unison: 8, detune: 0.22, width: 1, level: 0.6 });
    p.filter1 = defaultFilter({ type: "lp12", cutoff: 3600, resonance: 0.1 });
    p.envs[0] = defaultEnv({ attack: 0.45, decay: 0.8, sustain: 0.85, release: 1.2 });
    p.lfos[1] = defaultLfo({ shape: "triangle", sync: false, rate: 0.35, mode: "free" });
    mod(p, "lfo2", "osc1.position", 0.25);
    p.voice = { ...p.voice, velocity: 0.4, volume: -6 };
  }),
  build("Evolving Wash", "Pad", (p) => {
    p.osc1 = defaultOsc({ table: "harmonics", position: 0.1, unison: 5, detune: 0.2, width: 1, level: 0.55 });
    p.osc2 = defaultOsc({ table: "resonant", position: 0.2, transpose: 7, level: 0.3, unison: 3, detune: 0.15, dest: "f2" });
    p.noise = { on: true, color: "pink", level: 0.05, pan: 0, dest: "f2" };
    p.filterRouting = "parallel";
    p.filter1 = defaultFilter({ type: "lp24", cutoff: 1400, resonance: 0.2 });
    p.filter2 = defaultFilter({ on: true, type: "bp", cutoff: 2600, resonance: 0.35 });
    p.envs[0] = defaultEnv({ attack: 2, decay: 2, sustain: 1, release: 4 });
    p.envs[2] = defaultEnv({ attack: 6, attackCurve: -0.2, sustain: 1, release: 4 });
    mod(p, "env3", "osc1.position", 0.8);
    p.lfos[0] = defaultLfo({ shape: "smooth", sync: false, rate: 0.12, mode: "free" });
    mod(p, "lfo1", "osc2.position", 0.6, false);
    mod(p, "lfo1", "filter2.cutoff", 0.15);
    p.voice = { ...p.voice, velocity: 0.2, volume: -4 };
  }),

  // --- Pluck ---
  build("Crystal Pluck", "Pluck", (p) => {
    p.osc1 = defaultOsc({ table: "bells", position: 0.45, unison: 3, detune: 0.1, width: 0.7, level: 0.7 });
    p.filter1 = defaultFilter({ type: "lp24", cutoff: 900, resonance: 0.25 });
    p.envs[0] = defaultEnv({ decay: 0.7, sustain: 0, release: 0.5 });
    p.envs[1] = defaultEnv({ decay: 0.3, sustain: 0 });
    mod(p, "env2", "filter1.cutoff", 0.4);
    mod(p, "velocity", "filter1.cutoff", 0.15);
    p.voice = { ...p.voice, velocity: 0.7, volume: -7 };
  }),
  build("Dawn Pluck", "Pluck", (p) => {
    p.osc1 = defaultOsc({ table: "daybreak", position: 0.2, unison: 4, detune: 0.18, width: 0.8, level: 0.7 });
    p.filter1 = defaultFilter({ type: "lp12", cutoff: 2800, resonance: 0.2 });
    p.envs[0] = defaultEnv({ decay: 0.45, sustain: 0, release: 0.35 });
    p.envs[1] = defaultEnv({ decay: 0.25, sustain: 0 });
    mod(p, "env2", "osc1.position", 0.55);
    p.voice = { ...p.voice, velocity: 0.6, volume: -3 };
  }),
  build("Plucked String", "Pluck", (p) => {
    // A burst of noise ringing a comb filter tuned to the note.
    p.osc1 = defaultOsc({ on: false });
    p.noise = { on: true, color: "white", level: 0, pan: 0, dest: "f1" };
    p.filter1 = defaultFilter({ type: "comb", cutoff: 261.6, keytrack: 1, resonance: 0.97, morph: 0.35, mix: 1 });
    p.envs[0] = defaultEnv({ decay: 3, sustain: 0, release: 0.6, decayCurve: 0.3 });
    p.envs[1] = defaultEnv({ attack: 0, decay: 0.012, sustain: 0, decayCurve: 0 });
    mod(p, "env2", "noise.level", 1);
    mod(p, "velocity", "filter1.morph", -0.3, false);
    p.voice = { ...p.voice, velocity: 0.8, volume: 1 };
  }),
  build("Kalimba", "Pluck", (p) => {
    p.osc1 = defaultOsc({ table: "fm", position: 0.12, level: 0.75 });
    p.osc2 = defaultOsc({ position: 0, transpose: 24, level: 0.18 });
    p.filter1 = defaultFilter({ type: "lp12", cutoff: 6000, resonance: 0.1 });
    p.envs[0] = defaultEnv({ decay: 0.9, sustain: 0, release: 0.5 });
    p.envs[1] = defaultEnv({ decay: 0.08, sustain: 0 });
    mod(p, "env2", "osc1.position", 0.35);
    mod(p, "env2", "osc2.level", 0.4);
    p.voice = { ...p.voice, velocity: 0.8, volume: -6 };
  }),

  // --- Keys ---
  build("Drawbar Organ", "Keys", (p) => {
    p.osc1 = defaultOsc({ table: "organ", position: 0.75, level: 0.6, randomPhase: 0 });
    p.filter1 = defaultFilter({ on: false });
    p.envs[0] = defaultEnv({ attack: 0.004, decay: 0.1, sustain: 1, release: 0.06 });
    p.lfos[0] = defaultLfo({ shape: "sine", sync: false, rate: 6.2, mode: "free" });
    mod(p, "lfo1", "osc1.pan", 0.25);
    mod(p, "lfo1", "osc1.level", 0.05);
    mod(p, "macro1", "osc1.position", 0.25, false);
    p.voice = { ...p.voice, velocity: 0, volume: -9 };
  }),
  build("Electric Keys", "Keys", (p) => {
    p.osc1 = defaultOsc({ table: "fm", position: 0.3, level: 0.7 });
    p.osc2 = defaultOsc({ position: 0, level: 0.3 });
    p.filter1 = defaultFilter({ type: "lp12", cutoff: 5000, resonance: 0.1 });
    p.envs[0] = defaultEnv({ decay: 1.8, sustain: 0.3, release: 0.5 });
    p.envs[1] = defaultEnv({ decay: 0.6, sustain: 0.1 });
    mod(p, "env2", "osc1.position", 0.25);
    mod(p, "velocity", "osc1.position", 0.2, false);
    p.lfos[1] = defaultLfo({ shape: "sine", sync: false, rate: 4.5, mode: "free" });
    mod(p, "lfo2", "osc1.pan", 0.3);
    p.voice = { ...p.voice, velocity: 0.8, volume: -7 };
  }),
  build("Bell Keys", "Keys", (p) => {
    p.osc1 = defaultOsc({ table: "bells", position: 0.55, level: 0.65 });
    p.osc2 = defaultOsc({ position: 0, transpose: 12, level: 0.25 });
    p.filter1 = defaultFilter({ type: "lp12", cutoff: 8000, resonance: 0.1 });
    p.envs[0] = defaultEnv({ decay: 2.5, sustain: 0, release: 1.2 });
    p.voice = { ...p.voice, velocity: 0.7, volume: -8 };
  }),

  // --- FX ---
  build("Riser", "FX", (p) => {
    p.osc1 = defaultOsc({ position: 0.5, warp: "sync", warpAmount: 0, unison: 6, detune: 0.3, width: 1, level: 0.5 });
    p.noise = { on: true, color: "white", level: 0.25, pan: 0, dest: "f1" };
    p.filter1 = defaultFilter({ type: "hp24", cutoff: 60, resonance: 0.3 });
    p.envs[0] = defaultEnv({ attack: 4, attackCurve: -0.5, sustain: 1, release: 0.5 });
    p.envs[2] = defaultEnv({ attack: 6, attackCurve: -0.5, sustain: 1, release: 0.5 });
    mod(p, "env3", "osc1.warpAmount", 0.8);
    mod(p, "env3", "filter1.cutoff", 0.55);
    mod(p, "env3", "osc1.transpose", 0.12);
    p.voice = { ...p.voice, velocity: 0, volume: -5 };
  }),
  build("Glitch Stab", "FX", (p) => {
    p.osc1 = defaultOsc({ table: "glitch", position: 0.4, warp: "quantize", warpAmount: 0.4, unison: 2, detune: 0.1, level: 0.65 });
    p.filter1 = defaultFilter({ type: "bp", cutoff: 1800, resonance: 0.3, mix: 0.7 });
    p.envs[0] = defaultEnv({ decay: 0.3, sustain: 0, release: 0.1 });
    p.lfos[0] = defaultLfo({ shape: "stepped", division: 12 });
    mod(p, "lfo1", "osc1.position", 0.8, false);
    mod(p, "lfo1", "filter1.cutoff", 0.2);
    p.voice = { ...p.voice, velocity: 0.5, volume: -1 };
  }),
  build("Metal Hit", "FX", (p) => {
    p.osc1 = defaultOsc({ table: "bells", position: 0.7, warp: "rm", warpAmount: 0.8, level: 0.7 });
    p.osc2 = defaultOsc({ position: 0, transpose: 7, fine: 13, level: 0 });
    p.filter1 = defaultFilter({ type: "hp12", cutoff: 400, resonance: 0.2 });
    p.envs[0] = defaultEnv({ decay: 1.2, sustain: 0, release: 0.8 });
    p.voice = { ...p.voice, velocity: 0.8, volume: -4 };
  }),
  build("Laser Zap", "FX", (p) => {
    p.osc1 = defaultOsc({ position: 0.5, warp: "fm", warpAmount: 0.4, level: 0.6 });
    p.osc2 = defaultOsc({ position: 0, transpose: 19, level: 0 });
    p.filter1 = defaultFilter({ type: "lp12", cutoff: 12000 });
    p.envs[0] = defaultEnv({ decay: 0.35, sustain: 0, release: 0.1 });
    p.envs[1] = defaultEnv({ decay: 0.25, sustain: 0, decayCurve: 0.8 });
    mod(p, "env2", "voice.transpose", 0.3);
    mod(p, "env2", "osc1.warpAmount", 0.5);
    p.voice = { ...p.voice, velocity: 0.4, volume: -2 };
  }),
];

// --- your presets ---

const STORAGE_KEY = "dawn-synth-presets-v1";

function readUser(): SynthPreset[] {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((r) => r && typeof r.id === "string" && typeof r.name === "string")
      .map((r) => ({
        id: r.id,
        name: String(r.name).slice(0, 60),
        category: (PRESET_CATEGORIES as readonly string[]).includes(r.category) ? r.category : "Lead",
        factory: false,
        params: normalizeSynthParams(r.params),
        ...(typeof r.pack === "string" && r.pack ? { pack: r.pack as string } : {}),
      }));
  } catch {
    return [];
  }
}

function writeUser(list: SynthPreset[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list.map(({ id, name, category, params, pack }) => ({ id, name, category, params, ...(pack ? { pack } : {}) }))));
  } catch {
    // Storage full or blocked: the preset lives until the page closes.
  }
}

let cache: SynthPreset[] | null = null;
let all: SynthPreset[] | null = null;
const listeners = new Set<() => void>();

export function userSynthPresets(): SynthPreset[] {
  if (!cache) cache = readUser();
  return cache;
}

/** Factory then yours (the same array until something changes). */
export function allSynthPresets(): SynthPreset[] {
  if (!all) all = [...FACTORY_SYNTH_PRESETS, ...userSynthPresets()];
  return all;
}

const factoryOnly = () => FACTORY_SYNTH_PRESETS;
/** For server rendering, where there's no browser storage. */
export { factoryOnly as serverSynthPresets };

export function subscribeSynthPresets(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function changed(list: SynthPreset[]) {
  cache = list;
  all = null;
  writeUser(list);
  listeners.forEach((fn) => fn());
}

/** Saves a preset (replacing one of yours with the same name). */
export function saveSynthPreset(name: string, category: PresetCategory, params: SynthParams): SynthPreset {
  const clean = name.trim().slice(0, 60) || "My Sound";
  const list = userSynthPresets();
  const existing = list.find((p) => p.name.toLowerCase() === clean.toLowerCase());
  const preset: SynthPreset = {
    id: existing?.id ?? `user:${Date.now().toString(36)}`,
    name: clean,
    category,
    factory: false,
    params: { ...structuredClone(params), preset: clean },
  };
  changed(existing ? list.map((p) => (p.id === existing.id ? preset : p)) : [...list, preset]);
  return preset;
}

/** A pack's synth presets, added under that pack (names that are taken get
 * the pack's name after them). `mapFile` points imported wavetables at the
 * pack's copies. Returns how many were added. */
export function addPackSynthPresets(packId: string, packName: string, raw: unknown[], mapFile: (path: string) => string | null): number {
  const list = userSynthPresets().filter((p) => p.pack !== packId);
  const added: SynthPreset[] = [];
  raw.forEach((item, i) => {
    const r = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    if (typeof r.name !== "string" || !r.name.trim()) return;
    const params = normalizeSynthParams(r.params);
    for (const osc of [params.osc1, params.osc2]) {
      if (!osc.userTable) continue;
      const id = mapFile(osc.userTable.id);
      if (id) osc.userTable = { ...osc.userTable, id };
      else delete osc.userTable;
    }
    let name = r.name.trim().slice(0, 60);
    if ([...list, ...added].some((p) => p.name.toLowerCase() === name.toLowerCase())) name = `${name} (${packName})`.slice(0, 60);
    added.push({
      id: `pack:${packId}:${i}`,
      name,
      category: (PRESET_CATEGORIES as readonly string[]).includes(r.category as string) ? (r.category as PresetCategory) : "Lead",
      factory: false,
      params: { ...params, preset: name },
      pack: packId,
    });
  });
  changed([...list, ...added]);
  return added.length;
}

export function removePackSynthPresets(packId: string): void {
  changed(userSynthPresets().filter((p) => p.pack !== packId));
}

export function deleteSynthPreset(id: string): void {
  changed(userSynthPresets().filter((p) => p.id !== id));
}

/** A preset's sound, ready to load (a copy, keeping any imported wavetables it names). */
export function presetParams(preset: SynthPreset): SynthParams {
  return structuredClone(preset.params);
}

export { initSynthParams };
