// The synth's sound: every setting of the wavetable synth ("Daybreak"),
// shared by the engine (synth.ts, which compiles it for the worklet kernel
// in synthKernel.ts), the window (SynthWindow.tsx), presets and saved
// projects.
//
// The voice: two wavetable oscillators (each with a warp and a unison
// stack), a sub and a noise source, into two filters (serial or parallel),
// then the amp envelope. Three envelopes, three LFOs, velocity, note, the
// mod wheel, pitch bend, a per-note random value and four macros can
// modulate almost any knob through the modulation matrix.
//
// Modulation works on a knob's normalized position (0..1 along its travel,
// logarithmic for frequencies and times): a route adds `amount` (-1..1) times
// its source to that position, like Vital's modulation rings.

import { WAVETABLE_IDS, type WavetableId } from "./wavetableModel";

export const WARP_MODES = ["none", "sync", "bend", "squeeze", "pulse", "mirror", "fold", "quantize", "fm", "rm"] as const;
export type WarpMode = (typeof WARP_MODES)[number];
export const WARP_LABELS: Record<WarpMode, string> = {
  none: "Off",
  sync: "Sync",
  bend: "Bend",
  squeeze: "Squeeze",
  pulse: "Pulse",
  mirror: "Mirror",
  fold: "Fold",
  quantize: "Quantize",
  fm: "FM",
  rm: "Ring",
};

export const FILTER_TYPES = ["lp12", "lp24", "ladder", "hp12", "hp24", "bp", "notch", "morph", "comb", "combNeg", "formant"] as const;
export type SynthFilterType = (typeof FILTER_TYPES)[number];
export const FILTER_LABELS: Record<SynthFilterType, string> = {
  lp12: "Low 12",
  lp24: "Low 24",
  ladder: "Ladder",
  hp12: "High 12",
  hp24: "High 24",
  bp: "Band",
  notch: "Notch",
  morph: "Morph",
  comb: "Comb +",
  combNeg: "Comb −",
  formant: "Vowel",
};
/** What the Morph knob does for each filter type (null: unused). */
export const FILTER_MORPH_LABEL: Partial<Record<SynthFilterType, string>> = {
  morph: "Morph",
  comb: "Damp",
  combNeg: "Damp",
  formant: "Vowel",
};

/** Where an oscillator's sound goes. */
export const OSC_DESTS = ["f1", "f2", "both", "direct"] as const;
export type OscDest = (typeof OSC_DESTS)[number];
export const OSC_DEST_LABELS: Record<OscDest, string> = { f1: "F1", f2: "F2", both: "F1+2", direct: "Out" };

export const SUB_SHAPES = ["sine", "triangle", "saw", "square"] as const;
export type SubShape = (typeof SUB_SHAPES)[number];

export const LFO_SHAPES = ["sine", "triangle", "saw", "ramp", "square", "stepped", "smooth"] as const;
export type LfoShape = (typeof LFO_SHAPES)[number];
export const LFO_SHAPE_LABELS: Record<LfoShape, string> = {
  sine: "Sine",
  triangle: "Triangle",
  saw: "Saw Down",
  ramp: "Saw Up",
  square: "Square",
  stepped: "Random Steps",
  smooth: "Random Smooth",
};
export const LFO_MODES = ["trigger", "free", "once"] as const;
export type LfoMode = (typeof LFO_MODES)[number];
export const LFO_MODE_LABELS: Record<LfoMode, string> = { trigger: "Retrigger", free: "Free", once: "One Shot" };

/** Tempo-synced LFO rates: a label and its length in beats. */
export const LFO_DIVISIONS: { label: string; beats: number }[] = [
  { label: "8 bars", beats: 32 },
  { label: "4 bars", beats: 16 },
  { label: "2 bars", beats: 8 },
  { label: "1 bar", beats: 4 },
  { label: "1/2", beats: 2 },
  { label: "1/2 T", beats: 4 / 3 },
  { label: "1/4 D", beats: 1.5 },
  { label: "1/4", beats: 1 },
  { label: "1/4 T", beats: 2 / 3 },
  { label: "1/8 D", beats: 0.75 },
  { label: "1/8", beats: 0.5 },
  { label: "1/8 T", beats: 1 / 3 },
  { label: "1/16", beats: 0.25 },
  { label: "1/16 T", beats: 1 / 6 },
  { label: "1/32", beats: 0.125 },
];

export const VOICE_MODES = ["poly", "mono", "legato"] as const;
export type VoiceMode = (typeof VOICE_MODES)[number];

export interface SynthOscParams {
  on: boolean;
  table: WavetableId;
  /** An imported wavetable (an audio file saved with the project), used
   * instead of `table` when present. */
  userTable?: { id: string; name: string };
  position: number;
  warp: WarpMode;
  warpAmount: number;
  /** Semitones. */
  transpose: number;
  /** Cents. */
  fine: number;
  level: number;
  pan: number;
  unison: number;
  /** How far the unison voices spread in pitch (0..1, up to ±50 cents). */
  detune: number;
  /** The outer unison voices' level against the middle ones. */
  blend: number;
  /** How far the unison voices spread across the stereo field. */
  width: number;
  /** Where each note starts in the wave (0..1). */
  phase: number;
  /** How much each voice's start is randomized (0..1). */
  randomPhase: number;
  dest: OscDest;
}

export interface SynthSubParams {
  on: boolean;
  shape: SubShape;
  /** Octaves below the note: 0, -1 or -2. */
  octave: number;
  level: number;
  pan: number;
  dest: OscDest;
}

export interface SynthNoiseParams {
  on: boolean;
  color: "white" | "pink";
  level: number;
  pan: number;
  dest: OscDest;
}

export interface SynthFilterParams {
  on: boolean;
  type: SynthFilterType;
  cutoff: number;
  resonance: number;
  drive: number;
  morph: number;
  /** How far the cutoff follows the note (0..1: none..one octave per octave). */
  keytrack: number;
  mix: number;
}

export interface SynthEnvParams {
  delay: number;
  attack: number;
  hold: number;
  decay: number;
  sustain: number;
  release: number;
  /** -1..1: 0 is linear, positive bows the segment out (fast start). */
  attackCurve: number;
  decayCurve: number;
  releaseCurve: number;
}

export interface SynthLfoParams {
  shape: LfoShape;
  /** Hz, when not synced. */
  rate: number;
  sync: boolean;
  /** Index into LFO_DIVISIONS. */
  division: number;
  mode: LfoMode;
  phase: number;
  /** Seconds to fade in after each note starts. */
  fade: number;
}

export const MOD_SOURCES = [
  "env1",
  "env2",
  "env3",
  "lfo1",
  "lfo2",
  "lfo3",
  "velocity",
  "note",
  "modwheel",
  "bend",
  "random",
  "macro1",
  "macro2",
  "macro3",
  "macro4",
] as const;
export type ModSource = (typeof MOD_SOURCES)[number];
export const MOD_SOURCE_LABELS: Record<ModSource, string> = {
  env1: "Env 1",
  env2: "Env 2",
  env3: "Env 3",
  lfo1: "LFO 1",
  lfo2: "LFO 2",
  lfo3: "LFO 3",
  velocity: "Velocity",
  note: "Note",
  modwheel: "Mod Wheel",
  bend: "Pitch Bend",
  random: "Random",
  macro1: "Macro 1",
  macro2: "Macro 2",
  macro3: "Macro 3",
  macro4: "Macro 4",
};
/** Sources that swing both ways by nature: new routes from them start bipolar. */
export const BIPOLAR_SOURCES: ModSource[] = ["lfo1", "lfo2", "lfo3", "bend", "random"];

export interface ModRoute {
  id: string;
  source: ModSource;
  dest: ModDest;
  /** -1..1 of the destination knob's travel. */
  amount: number;
  /** Swing the source around zero (-1..1) instead of 0..1. */
  bipolar: boolean;
}

export interface SynthParams {
  version: 2;
  /** The preset it was loaded from or saved as (just its name, for show). */
  preset?: string;
  osc1: SynthOscParams;
  osc2: SynthOscParams;
  sub: SynthSubParams;
  noise: SynthNoiseParams;
  filter1: SynthFilterParams;
  filter2: SynthFilterParams;
  filterRouting: "serial" | "parallel";
  /** env1 is the amp envelope. */
  envs: [SynthEnvParams, SynthEnvParams, SynthEnvParams];
  lfos: [SynthLfoParams, SynthLfoParams, SynthLfoParams];
  macros: [number, number, number, number];
  mods: ModRoute[];
  voice: {
    mode: VoiceMode;
    polyphony: number;
    /** Seconds. */
    glide: number;
    /** Semitones for a full pitch-bend. */
    bendRange: number;
    /** How much velocity sets the loudness (0..1). */
    velocity: number;
    /** Semitones, the whole synth. */
    transpose: number;
    /** dB. */
    volume: number;
  };
}

export const MAX_MODS = 32;
export const MAX_UNISON = 16;
export const MAX_POLYPHONY = 16;

// --- modulation destinations ---

export type DestScale = "linear" | "log";

export interface DestSpec {
  key: ModDest;
  label: string;
  /** The section it belongs to, for the matrix's destination list. */
  group: string;
  min: number;
  max: number;
  scale: DestScale;
}

type OscDestKey = "level" | "pan" | "position" | "warpAmount" | "transpose" | "fine" | "detune" | "blend" | "width";
type FilterDestKey = "cutoff" | "resonance" | "drive" | "morph" | "mix";

export type ModDest =
  | `osc1.${OscDestKey}`
  | `osc2.${OscDestKey}`
  | "sub.level"
  | "sub.pan"
  | "noise.level"
  | "noise.pan"
  | `filter1.${FilterDestKey}`
  | `filter2.${FilterDestKey}`
  | "lfo1.rate"
  | "lfo2.rate"
  | "lfo3.rate"
  | "voice.transpose"
  | "voice.volume";

export const LFO_RATE_MIN = 0.01;
export const LFO_RATE_MAX = 40;
export const CUTOFF_MIN = 20;
export const CUTOFF_MAX = 20000;
export const VOLUME_MIN = -48;
export const VOLUME_MAX = 6;

function oscDests(n: 1 | 2): DestSpec[] {
  const g = `Osc ${n}`;
  return [
    { key: `osc${n}.level`, label: "Level", group: g, min: 0, max: 1, scale: "linear" },
    { key: `osc${n}.pan`, label: "Pan", group: g, min: -1, max: 1, scale: "linear" },
    { key: `osc${n}.position`, label: "Position", group: g, min: 0, max: 1, scale: "linear" },
    { key: `osc${n}.warpAmount`, label: "Warp", group: g, min: 0, max: 1, scale: "linear" },
    { key: `osc${n}.transpose`, label: "Pitch", group: g, min: -48, max: 48, scale: "linear" },
    { key: `osc${n}.fine`, label: "Fine", group: g, min: -100, max: 100, scale: "linear" },
    { key: `osc${n}.detune`, label: "Detune", group: g, min: 0, max: 1, scale: "linear" },
    { key: `osc${n}.blend`, label: "Blend", group: g, min: 0, max: 1, scale: "linear" },
    { key: `osc${n}.width`, label: "Width", group: g, min: 0, max: 1, scale: "linear" },
  ] as DestSpec[];
}

function filterDests(n: 1 | 2): DestSpec[] {
  const g = `Filter ${n}`;
  return [
    { key: `filter${n}.cutoff`, label: "Cutoff", group: g, min: CUTOFF_MIN, max: CUTOFF_MAX, scale: "log" },
    { key: `filter${n}.resonance`, label: "Resonance", group: g, min: 0, max: 1, scale: "linear" },
    { key: `filter${n}.drive`, label: "Drive", group: g, min: 0, max: 1, scale: "linear" },
    { key: `filter${n}.morph`, label: "Morph", group: g, min: 0, max: 1, scale: "linear" },
    { key: `filter${n}.mix`, label: "Mix", group: g, min: 0, max: 1, scale: "linear" },
  ] as DestSpec[];
}

/** Every knob a modulation can drive, in the kernel's order. */
export const DEST_SPECS: DestSpec[] = [
  ...oscDests(1),
  ...oscDests(2),
  { key: "sub.level", label: "Level", group: "Sub", min: 0, max: 1, scale: "linear" },
  { key: "sub.pan", label: "Pan", group: "Sub", min: -1, max: 1, scale: "linear" },
  { key: "noise.level", label: "Level", group: "Noise", min: 0, max: 1, scale: "linear" },
  { key: "noise.pan", label: "Pan", group: "Noise", min: -1, max: 1, scale: "linear" },
  ...filterDests(1),
  ...filterDests(2),
  { key: "lfo1.rate", label: "Rate", group: "LFO 1", min: LFO_RATE_MIN, max: LFO_RATE_MAX, scale: "log" },
  { key: "lfo2.rate", label: "Rate", group: "LFO 2", min: LFO_RATE_MIN, max: LFO_RATE_MAX, scale: "log" },
  { key: "lfo3.rate", label: "Rate", group: "LFO 3", min: LFO_RATE_MIN, max: LFO_RATE_MAX, scale: "log" },
  { key: "voice.transpose", label: "Pitch", group: "Voice", min: -48, max: 48, scale: "linear" },
  { key: "voice.volume", label: "Volume", group: "Voice", min: VOLUME_MIN, max: VOLUME_MAX, scale: "linear" },
];
export const DEST_INDEX: Record<ModDest, number> = Object.fromEntries(DEST_SPECS.map((d, i) => [d.key, i])) as Record<ModDest, number>;
export const MOD_DESTS = DEST_SPECS.map((d) => d.key);

export function destLabel(key: ModDest): string {
  const spec = DEST_SPECS[DEST_INDEX[key]];
  return spec ? `${spec.group} ${spec.label}` : key;
}

export function toNorm(spec: { min: number; max: number; scale: DestScale }, value: number): number {
  const v = Math.min(spec.max, Math.max(spec.min, value));
  if (spec.scale === "log") return Math.log(v / spec.min) / Math.log(spec.max / spec.min);
  return (v - spec.min) / (spec.max - spec.min);
}

export function fromNorm(spec: { min: number; max: number; scale: DestScale }, n: number): number {
  const f = Math.min(1, Math.max(0, n));
  if (spec.scale === "log") return spec.min * Math.pow(spec.max / spec.min, f);
  return spec.min + f * (spec.max - spec.min);
}

/** The knob's current value for a destination. */
export function destValue(p: SynthParams, key: ModDest): number {
  const [section, field] = key.split(".") as [string, string];
  if (section === "lfo1" || section === "lfo2" || section === "lfo3") return p.lfos[Number(section[3]) - 1].rate;
  const target = (p as unknown as Record<string, Record<string, number>>)[section];
  return target[field];
}

// --- defaults ---

export function defaultOsc(overrides: Partial<SynthOscParams> = {}): SynthOscParams {
  return {
    on: true,
    table: "basic",
    position: 0.5,
    warp: "none",
    warpAmount: 0,
    transpose: 0,
    fine: 0,
    level: 0.7,
    pan: 0,
    unison: 1,
    detune: 0.25,
    blend: 0.75,
    width: 0.8,
    phase: 0,
    randomPhase: 1,
    dest: "f1",
    ...overrides,
  };
}

export function defaultFilter(overrides: Partial<SynthFilterParams> = {}): SynthFilterParams {
  return { on: true, type: "lp24", cutoff: 20000, resonance: 0.1, drive: 0, morph: 0, keytrack: 0, mix: 1, ...overrides };
}

export function defaultEnv(overrides: Partial<SynthEnvParams> = {}): SynthEnvParams {
  return {
    delay: 0,
    attack: 0.002,
    hold: 0,
    decay: 0.6,
    sustain: 1,
    release: 0.15,
    attackCurve: 0,
    decayCurve: 0.6,
    releaseCurve: 0.6,
    ...overrides,
  };
}

export function defaultLfo(overrides: Partial<SynthLfoParams> = {}): SynthLfoParams {
  return { shape: "sine", rate: 2, sync: true, division: 7, mode: "trigger", phase: 0, fade: 0, ...overrides };
}

/** "Init": one saw-ish oscillator, a gently open filter. */
export function initSynthParams(): SynthParams {
  return {
    version: 2,
    preset: "Init",
    osc1: defaultOsc(),
    osc2: defaultOsc({ on: false, position: 0, level: 0.5 }),
    sub: { on: false, shape: "sine", octave: -1, level: 0.5, pan: 0, dest: "direct" },
    noise: { on: false, color: "white", level: 0.25, pan: 0, dest: "f1" },
    filter1: defaultFilter(),
    filter2: defaultFilter({ on: false, type: "hp12", cutoff: 20 }),
    filterRouting: "serial",
    envs: [defaultEnv(), defaultEnv({ sustain: 0, decay: 0.4 }), defaultEnv({ sustain: 0, decay: 1.2 })],
    lfos: [defaultLfo(), defaultLfo({ shape: "triangle", division: 10 }), defaultLfo({ shape: "smooth", sync: false, rate: 0.5, mode: "free" })],
    macros: [0, 0, 0, 0],
    mods: [],
    voice: { mode: "poly", polyphony: 8, glide: 0, bendRange: 2, velocity: 0.6, transpose: 0, volume: -6 },
  };
}

// --- repair / migration ---

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw => (v && typeof v === "object" && !Array.isArray(v) ? (v as Raw) : {});
const num = (v: unknown, fallback: number, min: number, max: number): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
const int = (v: unknown, fallback: number, min: number, max: number): number => Math.round(num(v, fallback, min, max));
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === "boolean" ? v : fallback);
function oneOf<T>(v: unknown, options: readonly T[], fallback: T): T {
  return options.includes(v as T) ? (v as T) : fallback;
}

function normalizeOsc(raw: unknown, d: SynthOscParams): SynthOscParams {
  const r = obj(raw);
  const user = obj(r.userTable);
  return {
    on: bool(r.on, d.on),
    table: oneOf(r.table, WAVETABLE_IDS, d.table),
    ...(typeof user.id === "string" && user.id ? { userTable: { id: user.id, name: typeof user.name === "string" ? user.name : "Wavetable" } } : {}),
    position: num(r.position, d.position, 0, 1),
    warp: oneOf(r.warp, WARP_MODES, d.warp),
    warpAmount: num(r.warpAmount, d.warpAmount, 0, 1),
    transpose: int(r.transpose, d.transpose, -48, 48),
    fine: num(r.fine, d.fine, -100, 100),
    level: num(r.level, d.level, 0, 1),
    pan: num(r.pan, d.pan, -1, 1),
    unison: int(r.unison, d.unison, 1, MAX_UNISON),
    detune: num(r.detune, d.detune, 0, 1),
    blend: num(r.blend, d.blend, 0, 1),
    width: num(r.width, d.width, 0, 1),
    phase: num(r.phase, d.phase, 0, 1),
    randomPhase: num(r.randomPhase, d.randomPhase, 0, 1),
    dest: oneOf(r.dest, OSC_DESTS, d.dest),
  };
}

function normalizeFilter(raw: unknown, d: SynthFilterParams): SynthFilterParams {
  const r = obj(raw);
  return {
    on: bool(r.on, d.on),
    type: oneOf(r.type, FILTER_TYPES, d.type),
    cutoff: num(r.cutoff, d.cutoff, CUTOFF_MIN, CUTOFF_MAX),
    resonance: num(r.resonance, d.resonance, 0, 1),
    drive: num(r.drive, d.drive, 0, 1),
    morph: num(r.morph, d.morph, 0, 1),
    keytrack: num(r.keytrack, d.keytrack, 0, 1),
    mix: num(r.mix, d.mix, 0, 1),
  };
}

function normalizeEnv(raw: unknown, d: SynthEnvParams): SynthEnvParams {
  const r = obj(raw);
  return {
    delay: num(r.delay, d.delay, 0, 4),
    attack: num(r.attack, d.attack, 0, 20),
    hold: num(r.hold, d.hold, 0, 4),
    decay: num(r.decay, d.decay, 0.001, 30),
    sustain: num(r.sustain, d.sustain, 0, 1),
    release: num(r.release, d.release, 0.001, 30),
    attackCurve: num(r.attackCurve, d.attackCurve, -1, 1),
    decayCurve: num(r.decayCurve, d.decayCurve, -1, 1),
    releaseCurve: num(r.releaseCurve, d.releaseCurve, -1, 1),
  };
}

function normalizeLfo(raw: unknown, d: SynthLfoParams): SynthLfoParams {
  const r = obj(raw);
  return {
    shape: oneOf(r.shape, LFO_SHAPES, d.shape),
    rate: num(r.rate, d.rate, LFO_RATE_MIN, LFO_RATE_MAX),
    sync: bool(r.sync, d.sync),
    division: int(r.division, d.division, 0, LFO_DIVISIONS.length - 1),
    mode: oneOf(r.mode, LFO_MODES, d.mode),
    phase: num(r.phase, d.phase, 0, 1),
    fade: num(r.fade, d.fade, 0, 10),
  };
}

let modCounter = 0;
export function newModId(): string {
  modCounter += 1;
  return `mod-${Date.now().toString(36)}-${modCounter}`;
}

function normalizeMods(raw: unknown): ModRoute[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: ModRoute[] = [];
  for (const item of raw) {
    const r = obj(item);
    const source = oneOf(r.source, MOD_SOURCES, null as unknown as ModSource);
    const dest = oneOf(r.dest, MOD_DESTS, null as unknown as ModDest);
    if (!source || !dest) continue;
    let id = typeof r.id === "string" && r.id ? r.id : newModId();
    if (seen.has(id)) id = newModId();
    seen.add(id);
    out.push({ id, source, dest, amount: num(r.amount, 0, -1, 1), bipolar: bool(r.bipolar, BIPOLAR_SOURCES.includes(source)) });
    if (out.length >= MAX_MODS) break;
  }
  return out;
}

function tuple<T, N extends number>(raw: unknown, defaults: T[], fix: (v: unknown, d: T) => T): T[] & { length: N } {
  const list = Array.isArray(raw) ? raw : [];
  return defaults.map((d, i) => fix(list[i], d)) as T[] & { length: N };
}

/** Repairs saved synth settings, or converts the first synth's settings
 * (before "Daybreak") into the new ones so old projects keep their sound. */
export function normalizeSynthParams(raw: unknown): SynthParams {
  const r = obj(raw);
  if (r.version !== 2) return migrateLegacySynth(r);
  const d = initSynthParams();
  const sub = obj(r.sub);
  const noise = obj(r.noise);
  const voice = obj(r.voice);
  return {
    version: 2,
    ...(typeof r.preset === "string" && r.preset ? { preset: r.preset.slice(0, 60) } : {}),
    osc1: normalizeOsc(r.osc1, d.osc1),
    osc2: normalizeOsc(r.osc2, d.osc2),
    sub: {
      on: bool(sub.on, d.sub.on),
      shape: oneOf(sub.shape, SUB_SHAPES, d.sub.shape),
      octave: int(sub.octave, d.sub.octave, -2, 0),
      level: num(sub.level, d.sub.level, 0, 1),
      pan: num(sub.pan, d.sub.pan, -1, 1),
      dest: oneOf(sub.dest, OSC_DESTS, d.sub.dest),
    },
    noise: {
      on: bool(noise.on, d.noise.on),
      color: oneOf(noise.color, ["white", "pink"] as const, d.noise.color),
      level: num(noise.level, d.noise.level, 0, 1),
      pan: num(noise.pan, d.noise.pan, -1, 1),
      dest: oneOf(noise.dest, OSC_DESTS, d.noise.dest),
    },
    filter1: normalizeFilter(r.filter1, d.filter1),
    filter2: normalizeFilter(r.filter2, d.filter2),
    filterRouting: oneOf(r.filterRouting, ["serial", "parallel"] as const, d.filterRouting),
    envs: tuple<SynthEnvParams, 3>(r.envs, d.envs, normalizeEnv) as SynthParams["envs"],
    lfos: tuple<SynthLfoParams, 3>(r.lfos, d.lfos, normalizeLfo) as SynthParams["lfos"],
    macros: tuple<number, 4>(r.macros, d.macros, (v, fallback) => num(v, fallback, 0, 1)) as SynthParams["macros"],
    mods: normalizeMods(r.mods),
    voice: {
      mode: oneOf(voice.mode, VOICE_MODES, d.voice.mode),
      polyphony: int(voice.polyphony, d.voice.polyphony, 1, MAX_POLYPHONY),
      glide: num(voice.glide, d.voice.glide, 0, 5),
      bendRange: int(voice.bendRange, d.voice.bendRange, 0, 24),
      velocity: num(voice.velocity, d.voice.velocity, 0, 1),
      transpose: int(voice.transpose, d.voice.transpose, -48, 48),
      volume: num(voice.volume, d.voice.volume, VOLUME_MIN, VOLUME_MAX),
    },
  };
}

const LEGACY_TABLES: Record<string, WavetableId> = {
  classic: "basic",
  formant: "vowels",
  organ: "organ",
  metallic: "bells",
  glitch: "glitch",
};

const qToResonance = (q: number) => Math.min(1, Math.max(0, Math.log(Math.max(q, 0.5) / 0.5) / Math.log(50)));

function migrateLegacySynth(r: Raw): SynthParams {
  if (!r.oscA && !("oscillatorType" in r || "attack" in r || "filterCutoff" in r)) return initSynthParams();
  const p = r.oscA ? migrateWavetableSynth(r) : migrateSubtractiveSynth(r);
  delete p.preset;
  return p;
}

/** The very first synth: one oscillator (or simple FM), a filter and an envelope. */
function migrateSubtractiveSynth(r: Raw): SynthParams {
  const p = initSynthParams();
  const shapes: Record<string, number> = { sine: 0, triangle: 0.25, sawtooth: 0.5, square: 0.75 };
  const fm = r.mode === "fm";
  p.osc1 = defaultOsc({
    table: fm ? "fm" : "basic",
    position: fm ? Math.min(1, num(r.modulationIndex, 4, 0, 40) / 10) : shapes[typeof r.oscillatorType === "string" ? r.oscillatorType : ""] ?? 0.5,
    fine: num(r.detune, 0, -100, 100),
    level: 0.8,
  });
  p.filter1 = defaultFilter({ type: "lp12", cutoff: num(r.filterCutoff, 2400, CUTOFF_MIN, CUTOFF_MAX), resonance: qToResonance(num(r.filterResonance, 1, 0.1, 30)) });
  p.envs[0] = defaultEnv({
    attack: num(r.attack, 0.01, 0, 10),
    decay: Math.max(0.001, num(r.decay, 0.2, 0, 10)),
    sustain: num(r.sustain, 0.6, 0, 1),
    release: Math.max(0.001, num(r.release, 0.4, 0, 20)),
    attackCurve: 0,
  });
  p.voice.velocity = 1;
  p.voice.volume = -3;
  return p;
}

/** The first wavetable synth: two oscillators (octave/semitone/fine, unison
 * voices and spread in cents), a sub, one filter with its own envelope (a
 * sweep in octaves), an amp envelope, and an LFO on pitch or the filter. */
function migrateWavetableSynth(r: Raw): SynthParams {
  const p = initSynthParams();
  const osc = (raw: unknown, on: boolean): SynthOscParams => {
    const o = obj(raw);
    const table = LEGACY_TABLES[typeof o.wavetable === "string" ? o.wavetable : ""] ?? "basic";
    let position = num(o.position, 0.4, 0, 1);
    // The old Classic table had four shapes; Basic Shapes adds a pulse at the end.
    if (table === "basic") position *= 0.75;
    const voices = int(o.unisonVoices, 1, 1, 8);
    return defaultOsc({
      on,
      table,
      position,
      transpose: int(o.octave, 0, -2, 2) * 12 + int(o.semitone, 0, -12, 12),
      fine: num(o.fineCents, 0, -50, 50),
      level: num(o.level, 0.8, 0, 1),
      unison: voices,
      detune: num(o.unisonSpread, 12, 0, 50) / 100,
      randomPhase: voices > 1 ? 1 : 0,
    });
  };
  p.osc1 = osc(r.oscA, true);
  p.osc2 = osc(r.oscB, bool(r.oscBEnabled, false));
  const subLevel = num(r.subLevel, 0, 0, 1);
  p.sub = { on: subLevel > 0, shape: "sine", octave: r.subOctaveDown === 2 ? -2 : -1, level: subLevel, pan: 0, dest: "f1" };
  const types: Record<string, SynthFilterType> = { lowpass: "lp12", highpass: "hp12", bandpass: "bp", notch: "notch" };
  const q = num(r.filterResonance, 1, 0.1, 30);
  p.filter1 = defaultFilter({
    type: types[typeof r.filterType === "string" ? r.filterType : ""] ?? "lp12",
    cutoff: num(r.filterCutoff, 2000, CUTOFF_MIN, CUTOFF_MAX),
    // Q 0.5..25 is resonance 0..1 (see the kernel).
    resonance: qToResonance(q),
  });
  p.envs[0] = defaultEnv({
    attack: num(r.ampAttack, 0.01, 0, 10),
    decay: Math.max(0.001, num(r.ampDecay, 0.2, 0, 10)),
    sustain: num(r.ampSustain, 0.8, 0, 1),
    release: Math.max(0.001, num(r.ampRelease, 0.5, 0, 20)),
    attackCurve: 0,
  });
  p.envs[1] = defaultEnv({
    attack: num(r.filterAttack, 0.01, 0, 10),
    decay: Math.max(0.001, num(r.filterDecay, 0.2, 0, 10)),
    sustain: num(r.filterSustain, 0.5, 0, 1),
    release: Math.max(0.001, num(r.filterRelease, 0.5, 0, 20)),
    attackCurve: 0,
  });
  const envOctaves = num(r.filterEnvAmount, 0, -8, 8);
  if (envOctaves !== 0) {
    const octavesSpan = Math.log2(CUTOFF_MAX / CUTOFF_MIN);
    p.mods.push({ id: newModId(), source: "env2", dest: "filter1.cutoff", amount: Math.max(-1, Math.min(1, envOctaves / octavesSpan)), bipolar: false });
  }
  const lfoAmount = num(r.lfoAmount, 0, 0, 1);
  p.lfos[0] = defaultLfo({ sync: false, rate: num(r.lfoRate, 2, LFO_RATE_MIN, LFO_RATE_MAX), mode: "free" });
  if (lfoAmount > 0) {
    if (r.lfoTarget === "filter") {
      p.mods.push({ id: newModId(), source: "lfo1", dest: "filter1.cutoff", amount: lfoAmount * 0.25, bipolar: true });
    } else {
      // ±1 semitone at full.
      p.mods.push({ id: newModId(), source: "lfo1", dest: "osc1.transpose", amount: lfoAmount / 96, bipolar: true });
      p.mods.push({ id: newModId(), source: "lfo1", dest: "osc2.transpose", amount: lfoAmount / 96, bipolar: true });
    }
  }
  p.voice.glide = num(r.glide, 0, 0, 5);
  p.voice.velocity = 1;
  p.voice.volume = -3;
  return p;
}

// --- compiled for the kernel ---

export interface CompiledSynth {
  /** Every destination's knob position, 0..1, in DEST_SPECS order. */
  base: number[];
  /** Routes, four numbers each: source index, destination index, amount, bipolar (0/1). */
  routes: number[];
  osc: { on: boolean; warp: number; unison: number; dest: number; phase: number; randomPhase: number }[];
  sub: { on: boolean; shape: number; octave: number; dest: number };
  noise: { on: boolean; pink: boolean; dest: number };
  filters: { on: boolean; type: number; keytrack: number }[];
  serial: boolean;
  envs: SynthEnvParams[];
  lfos: { shape: number; rate: number; sync: boolean; beats: number; mode: number; phase: number; fade: number }[];
  macros: number[];
  voice: { mode: number; polyphony: number; glide: number; bendRange: number; velocity: number };
}

/** The settings in the flat form the worklet kernel reads. */
export function compileSynth(p: SynthParams): CompiledSynth {
  const base = DEST_SPECS.map((spec) => toNorm(spec, destValue(p, spec.key)));
  const routes: number[] = [];
  p.mods.forEach((m) => {
    if (m.amount === 0) return;
    routes.push(MOD_SOURCES.indexOf(m.source), DEST_INDEX[m.dest], m.amount, m.bipolar ? 1 : 0);
  });
  const osc = [p.osc1, p.osc2].map((o) => ({
    on: o.on,
    warp: WARP_MODES.indexOf(o.warp),
    unison: o.unison,
    dest: OSC_DESTS.indexOf(o.dest),
    phase: o.phase,
    randomPhase: o.randomPhase,
  }));
  return {
    base,
    routes,
    osc,
    sub: { on: p.sub.on, shape: SUB_SHAPES.indexOf(p.sub.shape), octave: p.sub.octave, dest: OSC_DESTS.indexOf(p.sub.dest) },
    noise: { on: p.noise.on, pink: p.noise.color === "pink", dest: OSC_DESTS.indexOf(p.noise.dest) },
    filters: [p.filter1, p.filter2].map((f) => ({ on: f.on, type: FILTER_TYPES.indexOf(f.type), keytrack: f.keytrack })),
    serial: p.filterRouting === "serial",
    envs: p.envs.map((e) => ({ ...e })),
    lfos: p.lfos.map((l) => ({
      shape: LFO_SHAPES.indexOf(l.shape),
      rate: l.rate,
      sync: l.sync,
      beats: LFO_DIVISIONS[l.division]?.beats ?? 1,
      mode: LFO_MODES.indexOf(l.mode),
      phase: l.phase,
      fade: l.fade,
    })),
    macros: [...p.macros],
    voice: {
      mode: VOICE_MODES.indexOf(p.voice.mode),
      polyphony: p.voice.polyphony,
      glide: p.voice.glide,
      bendRange: p.voice.bendRange,
      velocity: p.voice.velocity,
    },
  };
}
