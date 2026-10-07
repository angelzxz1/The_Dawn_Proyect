// Effect presets: named settings for a device, like Live's browser. Every
// effect type has a few factory presets; user presets are saved in this
// browser (localStorage) and are shared by every project.
//
// A preset holds knob settings only. Display settings (an analyzer's view
// range) and Listen stay as they are when one is loaded, and a sidechain's
// routing or a loaded IR/amp file belong to the project, not the preset.
// A synced delay's times are stored in beats, so a preset follows the
// project's tempo.

import { EFFECT_TYPES, defaultParams, paramSpecs, type EffectType } from "./effects";

export interface EffectPreset {
  id: string;
  type: EffectType;
  name: string;
  /** Only the params that differ from the defaults need be here. */
  params: Record<string, number>;
  factory: boolean;
  /** Delay times are in beats (quarter notes), not seconds. */
  tempoRelative?: boolean;
  /** The sound pack it came with (removed with the pack). */
  pack?: string;
}

/** Which preset an effect was last loaded from or saved to. */
export interface PresetRef {
  id: string;
  name: string;
}

const MAX_NAME = 60;

/** Params a preset never changes: view settings, and Listen. */
function isViewKey(type: EffectType, key: string): boolean {
  if (key === "scListen") return true;
  if (type === "mbDynamics") return key === "view" || key.endsWith("Solo");
  return (type === "paramEq" || type === "multiband") && (key === "scale" || key === "analyzer");
}

const clampToSpec = (type: EffectType, key: string, v: number): number | null => {
  const spec = paramSpecs(type).find((s) => s.key === key);
  if (!spec || typeof v !== "number" || !Number.isFinite(v)) return null;
  return Math.min(spec.max, Math.max(spec.min, v));
};

const DELAY_TIMES = ["delayTimeL", "delayTimeR"];
const TIME_MIN = 0.02;
const TIME_MAX = 2;

/** The full param set an effect gets from `preset`: the defaults, with the
 * preset's values on top (display settings kept from `current`). */
export function paramsFromPreset(
  preset: Pick<EffectPreset, "type" | "params" | "tempoRelative">,
  current: Record<string, number>,
  bpm: number
): Record<string, number> {
  const out = defaultParams(preset.type);
  Object.entries(preset.params).forEach(([key, value]) => {
    if (isViewKey(preset.type, key)) return;
    if (preset.tempoRelative && DELAY_TIMES.includes(key)) {
      out[key] = Math.min(TIME_MAX, Math.max(TIME_MIN, (value * 60) / bpm));
      return;
    }
    const v = clampToSpec(preset.type, key, value);
    if (v !== null) out[key] = v;
  });
  Object.keys(out).forEach((key) => {
    if (isViewKey(preset.type, key) && current[key] !== undefined) out[key] = current[key];
  });
  return out;
}

/** What a preset saved from these settings holds. */
export function presetFromParams(type: EffectType, params: Record<string, number>, bpm: number): Pick<EffectPreset, "params" | "tempoRelative"> {
  const out: Record<string, number> = {};
  paramSpecs(type).forEach((spec) => {
    if (isViewKey(type, spec.key)) return;
    out[spec.key] = params[spec.key] ?? spec.default;
  });
  const tempoRelative = type === "delay" && (out.sync ?? 0) >= 0.5;
  if (tempoRelative) DELAY_TIMES.forEach((key) => (out[key] = (out[key] * bpm) / 60));
  return { params: out, tempoRelative };
}

/** Whether `params` are (still) exactly what `preset` sets. */
export function matchesPreset(preset: EffectPreset, params: Record<string, number>, bpm: number): boolean {
  const expected = paramsFromPreset(preset, params, bpm);
  return paramSpecs(preset.type).every((spec) => Math.abs((params[spec.key] ?? spec.default) - expected[spec.key]) < 1e-4);
}

// --- Factory presets ---

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function factory(type: EffectType, list: [name: string, params: Record<string, number>, tempoRelative?: boolean][]): EffectPreset[] {
  return list.map(([name, params, tempoRelative]) => ({
    id: `factory:${type}:${slug(name)}`,
    type,
    name,
    params,
    factory: true,
    ...(tempoRelative ? { tempoRelative } : {}),
  }));
}

/** Parametric EQ bands: [shape, freq, gain, q, slope?] - shapes by index
 * (see paramEqModel.ts EQ_SHAPES: 0 bell, 1 low shelf, 2 low cut, 3 high
 * shelf, 4 high cut). */
function eq(bands: [number, number, number, number, number?][], extra: Record<string, number> = {}): Record<string, number> {
  const p: Record<string, number> = { ...extra };
  bands.forEach(([shape, freq, gain, q, slope], i) => {
    const n = i + 1;
    Object.assign(p, { [`b${n}On`]: 1, [`b${n}Shape`]: shape, [`b${n}Freq`]: freq, [`b${n}Gain`]: gain, [`b${n}Q`]: q });
    if (slope) p[`b${n}Slope`] = slope;
  });
  return p;
}

/** Multiband: crossovers, then each band's settings. */
function mb(crossovers: number[], bands: Partial<Record<"Thresh" | "Ratio" | "Attack" | "Release" | "Knee" | "Range" | "Gain" | "Mode" | "Bypass", number>>[], extra: Record<string, number> = {}): Record<string, number> {
  const p: Record<string, number> = { bands: bands.length, ...extra };
  crossovers.forEach((x, k) => (p[`x${k + 1}`] = x));
  bands.forEach((b, i) => Object.entries(b).forEach(([field, v]) => (p[`b${i + 1}${field}`] = v)));
  return p;
}

export const FACTORY_PRESETS: EffectPreset[] = [
  ...factory("compressor", [
    ["Gentle Glue", { threshold: -18, ratio: 2, attack: 0.03, release: 0.25, knee: 12 }],
    ["Mix Bus Glue", { threshold: -20, ratio: 2, attack: 0.03, release: 0.3, knee: 6, scHpf: 120 }],
    ["Vocal Leveler", { threshold: -24, ratio: 4, attack: 0.005, release: 0.12, knee: 6 }],
    ["Punchy Drums", { threshold: -20, ratio: 4, attack: 0.03, release: 0.08, knee: 3 }],
    ["Bass Tamer", { threshold: -22, ratio: 5, attack: 0.01, release: 0.15, knee: 6 }],
    ["Parallel Smash", { threshold: -40, ratio: 20, attack: 0.001, release: 0.1, knee: 0, dryWet: 0.4 }],
    ["Sidechain Pump", { threshold: -30, ratio: 10, attack: 0.001, release: 0.15, knee: 0, makeupAuto: 0, makeup: 0 }],
  ]),
  // Steps (see glueModel.ts): ratio 0-2 = 2, 4, 10:1; attack 0-6 = 0.01,
  // 0.1, 0.3, 1, 3, 10, 30 ms; release 0-6 = 0.1, 0.2, 0.4, 0.6, 0.8,
  // 1.2 s, Auto.
  ...factory("glue", [
    ["Mix Bus Glue", { threshold: -16, ratio: 0, attack: 5, release: 6, makeup: 2 }],
    ["Master Polish", { threshold: -10, ratio: 0, attack: 6, release: 6, makeup: 1, range: -3 }],
    ["Drum Bus Punch", { threshold: -20, ratio: 1, attack: 6, release: 1, makeup: 4 }],
    ["Vocal Glue", { threshold: -18, ratio: 1, attack: 4, release: 2, makeup: 3 }],
    ["Parallel Crush", { threshold: -30, ratio: 2, attack: 0, release: 0, makeup: 10, dryWet: 0.4, softClip: 1 }],
    ["Sidechain Pump", { threshold: -30, ratio: 2, attack: 0, release: 2 }],
  ]),
  // Per band l/m/h: Above ratio > 1 compresses down, < 1 expands up;
  // Below ratio > 1 expands down, < 1 compresses up.
  ...factory("mbDynamics", [
    ["Gentle Multiband Master", { lAboveT: -18, lAboveR: 1.8, mAboveT: -16, mAboveR: 1.6, hAboveT: -18, hAboveR: 1.8, lAttack: 0.02, lRelease: 0.15, mAttack: 0.01, mRelease: 0.1, hAttack: 0.005, hRelease: 0.08, rms: 1 }],
    ["De-Esser", { lowOn: 0, xHigh: 5000, hAboveT: -30, hAboveR: 5, hAttack: 0.001, hRelease: 0.04 }],
    ["Uncompress (Upward Expansion)", { lIn: -3, mIn: -3, hIn: -3, lAboveT: -14, lAboveR: 0.8, mAboveT: -14, mAboveR: 0.8, hAboveT: -16, hAboveR: 0.8, lAttack: 0.001, mAttack: 0.001, hAttack: 0.001, lRelease: 0.08, mRelease: 0.06, hRelease: 0.05 }],
    ["Upward Detail", { lBelowT: -45, lBelowR: 0.7, mBelowT: -45, mBelowR: 0.6, hBelowT: -50, hBelowR: 0.6, lRelease: 0.2, mRelease: 0.15, hRelease: 0.12 }],
    ["Clean Up Noise", { lBelowT: -60, lBelowR: 3, mBelowT: -60, mBelowR: 3, hBelowT: -55, hBelowR: 4, lRelease: 0.2, mRelease: 0.15, hRelease: 0.1 }],
    ["OTT-Style Squash", { lAboveT: -30, lAboveR: 8, mAboveT: -28, mAboveR: 8, hAboveT: -30, hAboveR: 8, lBelowT: -45, lBelowR: 0.5, mBelowT: -45, mBelowR: 0.5, hBelowT: -45, hBelowR: 0.5, xLow: 88, xHigh: 2500, output: -3, amount: 0.6, lAttack: 0.005, mAttack: 0.003, hAttack: 0.001, lRelease: 0.1, mRelease: 0.08, hRelease: 0.05 }],
  ]),
  ...factory("gate", [
    ["Guitar Hiss", { threshold: -60, attack: 0.001, hold: 0.05, release: 0.15, range: -80 }],
    ["Tight Drums", { threshold: -35, attack: 0.0005, hold: 0.02, release: 0.05, range: -80 }],
    ["Vocal Breaths", { threshold: -45, attack: 0.002, hold: 0.08, release: 0.25, range: -12 }],
    ["Trance Gate (Sidechain)", { threshold: -30, attack: 0.0005, hold: 0, release: 0.02, range: -80 }],
  ]),
  ...factory("multiband", [
    ["Gentle Master", mb([150, 4000], [
      { Thresh: -18, Ratio: 1.5, Attack: 0.03, Release: 0.25, Knee: 12 },
      { Thresh: -18, Ratio: 1.5, Attack: 0.02, Release: 0.2, Knee: 12 },
      { Thresh: -20, Ratio: 1.5, Attack: 0.01, Release: 0.15, Knee: 12 },
    ])],
    ["Bass Control", mb([150], [
      { Thresh: -24, Ratio: 4, Attack: 0.02, Release: 0.15, Knee: 6 },
      { Thresh: 0, Ratio: 1, Bypass: 1 },
    ])],
    ["De-Esser", mb([5000, 10000], [
      { Thresh: 0, Ratio: 1, Bypass: 1 },
      { Thresh: -32, Ratio: 6, Attack: 0.0005, Release: 0.05, Knee: 3, Range: 12 },
      { Thresh: 0, Ratio: 1, Bypass: 1 },
    ])],
    ["Upward Detail", mb([200, 2000, 8000], [
      { Thresh: -40, Ratio: 1.5, Attack: 0.01, Release: 0.2, Mode: 2, Range: 9 },
      { Thresh: -40, Ratio: 1.5, Attack: 0.01, Release: 0.2, Mode: 2, Range: 9 },
      { Thresh: -40, Ratio: 1.5, Attack: 0.005, Release: 0.15, Mode: 2, Range: 9 },
      { Thresh: -40, Ratio: 1.5, Attack: 0.005, Release: 0.15, Mode: 2, Range: 9 },
    ])],
  ]),
  ...factory("limiter", [
    ["Transparent -1 dB", { gain: 0, threshold: -1, release: 0.1 }],
    ["Loud Master", { gain: 6, threshold: -0.3, release: 0.05, softClip: 1 }],
    ["Peak Catcher", { gain: 0, threshold: -3, release: 0.02 }],
  ]),
  ...factory("paramEq", [
    ["Low Cut 100 Hz", eq([[2, 100, 0, 0.71, 24]])],
    ["Vocal Clarity", eq([[2, 80, 0, 0.71, 18], [0, 300, -2, 1], [0, 3000, 2.5, 0.8], [3, 10000, 2, 0.71]])],
    ["Kick Punch", eq([[2, 30, 0, 0.71, 24], [0, 60, 3, 1.2], [0, 350, -4, 1.5], [0, 4000, 3, 1]])],
    ["Bass Clean-Up", eq([[2, 35, 0, 0.71, 24], [1, 100, 2, 0.71], [0, 250, -3, 1.2]])],
    ["Master Air", eq([[0, 200, -1, 0.7], [3, 12000, 1.5, 0.71]])],
  ]),
  ...factory("eq3", [
    ["Smile", { low: 4, mid: -3, high: 4 }],
    ["Warmth", { low: 3, high: -3 }],
    ["Vocal Presence", { low: -3, mid: 2, high: 3, highFrequency: 4000 }],
    ["Telephone", { low: -24, mid: 4, high: -24, lowFrequency: 500, highFrequency: 3000 }],
    ["Rumble Cut", { low: -24, lowFrequency: 120 }],
  ]),
  ...factory("filter", [
    ["Warm Low Pass", { mode: 0, frequency: 3000, Q: 0.7, slope: 1 }],
    ["High Pass Clean-Up", { mode: 1, frequency: 120, Q: 0.7, slope: 1 }],
    ["Telephone Band", { mode: 2, frequency: 1500, Q: 1.2 }],
    ["Auto-Wah", { mode: 2, frequency: 800, Q: 4, lfoRate: 2, lfoDepth: 0.7 }],
    ["Slow Sweep", { mode: 0, frequency: 1200, Q: 3, lfoRate: 0.1, lfoDepth: 0.8, slope: 1 }],
  ]),
  ...factory("delay", [
    ["Dotted Eighth Stereo", { delayTimeL: 0.5, delayTimeR: 0.75, feedback: 0.4, wet: 0.3 }, true],
    ["Quarter Echo", { delayTimeL: 1, delayTimeR: 1, feedback: 0.35, wet: 0.25, link: 1 }, true],
    ["Ping-Pong Eighths", { delayTimeL: 0.5, delayTimeR: 0.5, feedback: 0.5, wet: 0.3, pingPong: 1, link: 1 }, true],
    ["Dub Throw", { delayTimeL: 0.75, delayTimeR: 0.75, feedback: 0.7, lowCut: 300, highCut: 2500, wet: 0.35, link: 1 }, true],
    ["Slapback", { sync: 0, delayTimeL: 0.09, delayTimeR: 0.1, feedback: 0.1, lowCut: 100, highCut: 5000, wet: 0.25 }],
    ["Ambient Wash", { delayTimeL: 1.5, delayTimeR: 2, feedback: 0.75, lowCut: 250, highCut: 4000, wet: 0.4 }, true],
  ]),
  ...factory("reverb", [
    ["Small Room", { mode: 1, decay: 0.6, preDelay: 0.005, damping: 6000, early: 1, lowCut: 150, wet: 0.2 }],
    ["Drum Room", { mode: 1, decay: 0.9, preDelay: 0, early: 1, lowCut: 200, highCut: 9000, wet: 0.18 }],
    ["Vocal Plate", { mode: 2, decay: 1.8, preDelay: 0.03, lowCut: 300, highCut: 8000, wet: 0.22 }],
    ["Big Hall", { mode: 0, decay: 3.5, preDelay: 0.04, damping: 5000, wet: 0.3 }],
    ["Ambient Cloud", { mode: 0, decay: 8, preDelay: 0.08, damping: 3500, early: 0.4, wet: 0.5 }],
  ]),
  ...factory("chorus", [
    ["Classic Chorus", { frequency: 0.8, delayTime: 7, depth: 0.5, spread: 180, wet: 0.5 }],
    ["Subtle Widener", { frequency: 0.3, delayTime: 12, depth: 0.25, spread: 180, wet: 0.3 }],
    ["Flanger", { frequency: 0.25, delayTime: 2, depth: 0.8, feedback: 0.6, wet: 0.5, waveform: 1 }],
    ["Vibrato", { frequency: 5, delayTime: 4, depth: 0.4, spread: 0, wet: 1 }],
    ["Detune Pad", { frequency: 0.15, delayTime: 15, depth: 0.7, spread: 180, wet: 0.45 }],
  ]),
  // Curves (shape): 0 Analog Clip, 1 Digital Clip, 2 Sinoid Fold, 3 Soft
  // Sine, 4 Medium Curve, 5 Hard Curve. Color mode: 0 Pre, 1 Post, 2
  // Emphasis.
  ...factory("distortion", [
    ["Warm Tape", { distortion: 0.15, shape: 0, tone: 14000, colorOn: 1, colorMode: 2, colorBase: 3, colorFreq: 3000, colorDepth: -2, colorQ: 0.7 }],
    ["Soft Sine Glow", { distortion: 0.25, shape: 3, tone: 16000 }],
    ["Mid Bite", { distortion: 0.45, shape: 4, tone: 9000, output: -3, colorOn: 1, colorMode: 2, colorFreq: 1200, colorQ: 0.8, colorDepth: 9 }],
    ["Bass Grit, Clean Lows", { distortion: 0.5, shape: 0, tone: 8000, output: -4, colorOn: 1, colorMode: 2, colorBase: -10, colorFreq: 900, colorQ: 0.7, colorDepth: 4 }],
    ["Bright Exciter", { distortion: 0.35, shape: 3, tone: 20000, wet: 0.3, colorOn: 1, colorMode: 0, colorBase: -12, colorFreq: 5000, colorQ: 0.7, colorDepth: 6 }],
    ["Crunch", { distortion: 0.5, shape: 5, tone: 6000, output: -4 }],
    ["Fuzz", { distortion: 0.9, shape: 1, bias: 0.3, tone: 4000, output: -8 }],
    ["Lo-Fi Digital", { distortion: 0.6, shape: 1, tone: 5000, output: -6, softClip: 1 }],
    ["Wavefolder", { distortion: 0.6, shape: 2, tone: 9000, output: -6 }],
    ["Parallel Grit", { distortion: 0.7, shape: 0, tone: 7000, wet: 0.35 }],
  ]),
  ...factory("pitchShift", [
    ["Octave Up", { pitch: 12 }],
    ["Octave Down", { pitch: -12 }],
    ["Fifth Harmony", { pitch: 7, wet: 0.5 }],
    ["Doubler", { pitch: 0, fine: 8, window: 0.06, wet: 0.5 }],
    ["Shimmer", { pitch: 12, feedback: 0.5, wet: 0.4 }],
  ]),
  ...factory("irLoader", [
    ["Full Range", {}],
    ["Tight Guitar Cab", { lowCut: 80, highCut: 7000 }],
    ["Dark Cab", { lowCut: 70, highCut: 4500 }],
    ["Ambient Blend", { wet: 0.3 }],
  ]),
  // Mode 0-2 = Raw, Vintage, Modern; rectifier 0 = Tube, 1 = Diode.
  ...factory("tubeAmp", [
    ["Modern Rhythm", {}],
    ["Modern Lead", { gain: 8.5, mid: 5.5, presence: 6, output: 1 }],
    ["Tube Rectifier Bloom", { rectifier: 0, gain: 7.5 }],
    ["Vintage Crunch", { mode: 1, gain: 5, bass: 5, mid: 6, treble: 6 }],
    ["Vintage Lead", { mode: 1, gain: 8, mid: 6.5, presence: 6 }],
    ["Raw Edge", { mode: 0, gain: 3, bass: 5, mid: 5, treble: 6.5 }],
    ["Raw Crunch", { mode: 0, gain: 6, mid: 5 }],
  ]),
  ...factory("namAmp", [
    ["Flat", {}],
    ["Scooped", { bass: 7, middle: 3, treble: 7 }],
    ["Mid Push", { bass: 4.5, middle: 7.5, treble: 5.5 }],
    ["Hot Input", { input: 6, output: -6 }],
  ]),
  ...factory("utility", [
    ["Mono", { mono: 1 }],
    ["Bass Mono 120 Hz", { bassMono: 1, bassFreq: 120 }],
    ["Wide 150%", { width: 1.5 }],
    ["Swap Left and Right", { channel: 3 }],
    ["Polarity Flip", { invertL: 1, invertR: 1 }],
    ["-6 dB Trim", { gain: -6 }],
  ]),
  ...factory("tuner", [
    ["A = 440 Hz", { reference: 440 }],
    ["A = 442 Hz (orchestral)", { reference: 442 }],
    ["A = 432 Hz", { reference: 432 }],
  ]),
];

// --- User presets (this browser's localStorage) ---

const STORAGE_KEY = "dawn-effect-presets-v1";
const EMPTY: EffectPreset[] = [];
let cache: EffectPreset[] | null = null;
const listeners = new Set<() => void>();

function normalize(raw: unknown): EffectPreset | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const type = r.type as EffectType;
  if (typeof r.id !== "string" || !r.id || !EFFECT_TYPES.includes(type)) return null;
  const name = typeof r.name === "string" ? r.name.trim().slice(0, MAX_NAME) : "";
  if (!name) return null;
  const params: Record<string, number> = {};
  const saved = r.params && typeof r.params === "object" ? (r.params as Record<string, unknown>) : {};
  const tempoRelative = r.tempoRelative === true;
  Object.entries(saved).forEach(([key, value]) => {
    if (typeof value !== "number" || !Number.isFinite(value)) return;
    if (tempoRelative && DELAY_TIMES.includes(key)) params[key] = Math.max(0, value);
    else {
      const v = clampToSpec(type, key, value);
      if (v !== null) params[key] = v;
    }
  });
  const pack = typeof r.pack === "string" && r.pack ? r.pack : undefined;
  return { id: r.id, type, name, params, factory: false, ...(tempoRelative ? { tempoRelative } : {}), ...(pack ? { pack } : {}) };
}

function read(): EffectPreset[] {
  if (cache) return cache;
  let list: EffectPreset[] = [];
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) {
      const seen = new Set<string>();
      list = parsed.map(normalize).filter((p): p is EffectPreset => !!p && !seen.has(p.id) && !!seen.add(p.id));
    }
  } catch {
    // Unreadable storage: start empty (the bad data is left alone).
  }
  cache = list;
  return list;
}

function write(list: EffectPreset[]): void {
  cache = list;
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(
        list.map((p) => ({ id: p.id, type: p.type, name: p.name, params: p.params, ...(p.tempoRelative ? { tempoRelative: true } : {}), ...(p.pack ? { pack: p.pack } : {}) }))
      )
    );
  } catch {
    // Storage full or blocked: kept for this session only.
  }
  listeners.forEach((fn) => fn());
}

if (typeof window !== "undefined") {
  // Presets saved in another tab show up here too.
  window.addEventListener("storage", (e) => {
    if (e.key !== STORAGE_KEY) return;
    cache = null;
    listeners.forEach((fn) => fn());
  });
}

export function subscribePresets(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Every user preset (a stable array until one changes). */
export function userPresets(): EffectPreset[] {
  return typeof window === "undefined" ? EMPTY : read();
}

export function presetsFor(type: EffectType, user: EffectPreset[] = userPresets()): { factory: EffectPreset[]; user: EffectPreset[] } {
  return {
    factory: FACTORY_PRESETS.filter((p) => p.type === type),
    user: user.filter((p) => p.type === type).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export function findPreset(id: string | undefined): EffectPreset | undefined {
  if (!id) return undefined;
  return FACTORY_PRESETS.find((p) => p.id === id) ?? read().find((p) => p.id === id);
}

let idCounter = 0;
const newId = () => `user:${Date.now().toString(36)}-${(++idCounter).toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

/** Saves settings as a user preset. A user preset of that type with the
 * same name (ignoring case) is replaced. */
export function saveUserPreset(type: EffectType, name: string, params: Record<string, number>, bpm: number): EffectPreset {
  const clean = name.trim().slice(0, MAX_NAME) || "Untitled";
  const list = read();
  const existing = list.find((p) => p.type === type && p.name.toLowerCase() === clean.toLowerCase());
  const preset: EffectPreset = { id: existing?.id ?? newId(), type, name: clean, factory: false, ...presetFromParams(type, params, bpm) };
  if (!preset.tempoRelative) delete preset.tempoRelative;
  write(existing ? list.map((p) => (p.id === existing.id ? preset : p)) : [...list, preset]);
  return preset;
}

/** Replaces a user preset's settings, keeping its name. */
export function overwriteUserPreset(id: string, params: Record<string, number>, bpm: number): EffectPreset | null {
  const existing = read().find((p) => p.id === id);
  if (!existing) return null;
  return saveUserPreset(existing.type, existing.name, params, bpm);
}

/** Renames a user preset; false if the name is empty or already taken. */
export function renameUserPreset(id: string, name: string): boolean {
  const clean = name.trim().slice(0, MAX_NAME);
  const list = read();
  const preset = list.find((p) => p.id === id);
  if (!preset || !clean) return false;
  if (list.some((p) => p.id !== id && p.type === preset.type && p.name.toLowerCase() === clean.toLowerCase())) return false;
  write(list.map((p) => (p.id === id ? { ...p, name: clean } : p)));
  return true;
}

export function deleteUserPreset(id: string): void {
  write(read().filter((p) => p.id !== id));
}

/** A pack's presets (raw, as saved in the pack), added under that pack.
 * A name that's taken gets the pack's name after it. Returns how many were added. */
export function addPackPresets(packId: string, packName: string, raw: unknown[]): number {
  const list = read().filter((p) => p.pack !== packId);
  const added: EffectPreset[] = [];
  raw.forEach((item, i) => {
    const r = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const p = normalize({ ...r, id: `pack:${packId}:${i}`, pack: packId });
    if (!p) return;
    const taken = (n: string) => [...list, ...added].some((q) => q.type === p.type && q.name.toLowerCase() === n.toLowerCase());
    if (taken(p.name)) p.name = `${p.name} (${packName})`.slice(0, MAX_NAME);
    added.push(p);
  });
  write([...list, ...added]);
  return added.length;
}

export function removePackPresets(packId: string): void {
  write(read().filter((p) => p.pack !== packId));
}

/** For tests: forget the cached list (re-read storage next time). */
export function resetPresetCache(): void {
  cache = null;
}
