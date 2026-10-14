// The Drum Rack's settings: 16 pads on the notes C1-D#2 (the app counts
// middle C as C4, so these are MIDI 24-39), each playing a synthesized drum voice or a sample,
// with its own tune, decay, filter, drive, level, pan and choke group.
// Shared by the engine (drums.ts, drumKernel.ts), the window, kits and
// saved projects.

export const PAD_COUNT = 16;
export const FIRST_PAD_NOTE = 24;

export const DRUM_MODELS = ["kick", "snare", "clap", "hat", "cymbal", "tom", "rim", "cowbell", "shaker", "clave"] as const;
export type DrumModel = (typeof DRUM_MODELS)[number];

/** What each voice model is, and what its Character knob does. */
export const DRUM_MODEL_INFO: Record<DrumModel, { label: string; character: string; tone: string; hint: string }> = {
  kick: { label: "Kick", character: "Punch", tone: "Click", hint: "A sine with a fast pitch drop, like an 808/909 kick." },
  snare: { label: "Snare", character: "Snappy", tone: "Tone", hint: "A tuned body plus filtered noise (the snares)." },
  clap: { label: "Clap", character: "Spread", tone: "Tone", hint: "Several quick bursts of noise and a tail, like hands together." },
  hat: { label: "Hi-Hat", character: "Metal", tone: "Tone", hint: "Six detuned square waves (the 808 recipe) and noise, high-passed." },
  cymbal: { label: "Cymbal", character: "Bell", tone: "Tone", hint: "The metallic hat voice, lower and longer; Bell adds a ride's ping." },
  tom: { label: "Tom", character: "Punch", tone: "Attack", hint: "A pitched drum with a pitch drop." },
  rim: { label: "Rim", character: "Ring", tone: "Tone", hint: "A click ringing two tuned resonances." },
  cowbell: { label: "Cowbell", character: "Balance", tone: "Tone", hint: "Two square waves through a band pass, the 808 way." },
  shaker: { label: "Shaker", character: "Attack", tone: "Tone", hint: "High-passed noise with a soft attack." },
  clave: { label: "Clave", character: "Knock", tone: "Tone", hint: "A short, bright wooden ping." },
};

export interface DrumPadParams {
  name: string;
  source: "synth" | "sample";
  model: DrumModel;
  /** Semitones (both sources). */
  tune: number;
  /** 0..1: how long it rings (a sample plays through to its end at 1). */
  decay: number;
  /** 0..1, synth only (see DRUM_MODEL_INFO). */
  tone: number;
  /** 0..1, synth only (see DRUM_MODEL_INFO). */
  character: number;
  drive: number;
  sample?: { id: string; name: string };
  /** Where the sample starts, 0..1 of its length. */
  start: number;
  reverse: boolean;
  /** dB. */
  level: number;
  pan: number;
  /** -1..1: below 0 a low pass closes down, above 0 a high pass opens up. */
  filter: number;
  resonance: number;
  /** How much velocity sets the loudness (and brightness), 0..1. */
  velocity: number;
  /** 0 = none; pads in the same group (1-4) cut each other off. */
  choke: number;
  mute: boolean;
}

export interface DrumKitParams {
  version: 1;
  /** The kit it was loaded from or saved as. */
  kit?: string;
  pads: DrumPadParams[];
  /** dB. */
  volume: number;
}

export const LEVEL_MIN = -48;
export const LEVEL_MAX = 6;
export const CHOKE_GROUPS = 4;

export function padNote(index: number): number {
  return FIRST_PAD_NOTE + index;
}

/** The pad a MIDI note number plays, or -1. */
export function padIndexForMidi(midi: number): number {
  const i = midi - FIRST_PAD_NOTE;
  return i >= 0 && i < PAD_COUNT ? i : -1;
}

/** Computer-keyboard keys, in the order of `PAD_KEY_ORDER`: the first row
 * plays the pads the old ten-pad kit had on A..; (kick, snare, clap, toms,
 * hats, crash, ride), the second the rest. */
export const PAD_KEYS = ["a", "s", "d", "f", "g", "h", "j", "k", "l", ";", "q", "w", "e", "r", "t", "y"];
/** Pad indexes (note - 36) for each of PAD_KEYS. */
export const PAD_KEY_ORDER = [0, 2, 4, 5, 7, 9, 6, 10, 13, 15, 1, 3, 8, 11, 12, 14];

export function defaultPad(overrides: Partial<DrumPadParams> = {}): DrumPadParams {
  return {
    name: "Pad",
    source: "synth",
    model: "kick",
    tune: 0,
    decay: 0.5,
    tone: 0.5,
    character: 0.5,
    drive: 0,
    start: 0,
    reverse: false,
    level: -6,
    pan: 0,
    filter: 0,
    resonance: 0.1,
    velocity: 0.7,
    choke: 0,
    mute: false,
    ...overrides,
  };
}

const synth = (name: string, model: DrumModel, o: Partial<DrumPadParams> = {}) => defaultPad({ name, model, ...o });

/** The default kit ("Dawn 808"): the old kit's ten sounds on their old
 * notes, and six more in between. */
export function defaultKitPads(): DrumPadParams[] {
  return [
    synth("Kick", "kick", { decay: 0.45, character: 0.55, tone: 0.35, level: -3 }), // 24 C1
    synth("Rim", "rim", { level: -10 }), // 25 C#1
    synth("Snare", "snare", { decay: 0.4, character: 0.6, level: -6 }), // 26 D1
    synth("Snap", "clap", { decay: 0.1, character: 0.05, tone: 0.8, level: -10 }), // 27 D#1
    synth("Clap", "clap", { decay: 0.45, character: 0.5, level: -6 }), // 28 E1
    synth("Low Tom", "tom", { tune: -5, decay: 0.55, level: -6 }), // 29 F1
    synth("Closed Hat", "hat", { decay: 0.12, tone: 0.6, level: -12, choke: 1 }), // 30 F#1
    synth("Mid Tom", "tom", { tune: 0, decay: 0.5, level: -6 }), // 31 G1
    synth("Pedal Hat", "hat", { decay: 0.08, tone: 0.4, level: -14, choke: 1 }), // 32 G#1
    synth("High Tom", "tom", { tune: 5, decay: 0.45, level: -6 }), // 33 A1
    synth("Open Hat", "hat", { decay: 0.55, tone: 0.6, level: -13, choke: 1 }), // 34 A#1
    synth("Cowbell", "cowbell", { level: -14 }), // 35 B1
    synth("Shaker", "shaker", { decay: 0.3, level: -14 }), // 36 C2
    synth("Crash", "cymbal", { decay: 0.7, character: 0.1, level: -12 }), // 37 C#2
    synth("Clave", "clave", { level: -12 }), // 38 D2
    synth("Ride", "cymbal", { decay: 0.6, character: 0.75, tone: 0.65, level: -14 }), // 39 D#2
  ];
}

export function defaultDrumKit(): DrumKitParams {
  return { version: 1, kit: "Dawn 808", pads: defaultKitPads(), volume: 0 };
}

// --- repair ---

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw => (v && typeof v === "object" && !Array.isArray(v) ? (v as Raw) : {});
const num = (v: unknown, fallback: number, min: number, max: number): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === "boolean" ? v : fallback);
function oneOf<T>(v: unknown, options: readonly T[], fallback: T): T {
  return options.includes(v as T) ? (v as T) : fallback;
}

export function normalizePad(raw: unknown, d: DrumPadParams): DrumPadParams {
  const r = obj(raw);
  const sample = obj(r.sample);
  const hasSample = typeof sample.id === "string" && sample.id !== "";
  return {
    name: typeof r.name === "string" && r.name.trim() ? r.name.slice(0, 24) : d.name,
    source: hasSample ? oneOf(r.source, ["synth", "sample"] as const, d.source) : "synth",
    model: oneOf(r.model, DRUM_MODELS, d.model),
    tune: num(r.tune, d.tune, -24, 24),
    decay: num(r.decay, d.decay, 0, 1),
    tone: num(r.tone, d.tone, 0, 1),
    character: num(r.character, d.character, 0, 1),
    drive: num(r.drive, d.drive, 0, 1),
    ...(hasSample ? { sample: { id: sample.id as string, name: typeof sample.name === "string" ? sample.name.slice(0, 60) : "Sample" } } : {}),
    start: num(r.start, d.start, 0, 0.99),
    reverse: bool(r.reverse, d.reverse),
    level: num(r.level, d.level, LEVEL_MIN, LEVEL_MAX),
    pan: num(r.pan, d.pan, -1, 1),
    filter: num(r.filter, d.filter, -1, 1),
    resonance: num(r.resonance, d.resonance, 0, 1),
    velocity: num(r.velocity, d.velocity, 0, 1),
    choke: Math.round(num(r.choke, d.choke, 0, CHOKE_GROUPS)),
    mute: bool(r.mute, d.mute),
  };
}

/** Repairs a saved kit; a drum track from before the Drum Rack gets the default kit. */
export function normalizeDrumKit(raw: unknown): DrumKitParams {
  const r = obj(raw);
  const d = defaultDrumKit();
  if (r.version !== 1) return d;
  const pads = Array.isArray(r.pads) ? r.pads : [];
  return {
    version: 1,
    ...(typeof r.kit === "string" && r.kit ? { kit: r.kit.slice(0, 60) } : {}),
    pads: d.pads.map((pd, i) => normalizePad(pads[i], pd)),
    volume: num(r.volume, d.volume, LEVEL_MIN, LEVEL_MAX),
  };
}

// --- compiled for the kernel ---

export interface CompiledPad {
  on: boolean;
  sample: boolean;
  model: number;
  tune: number;
  decay: number;
  tone: number;
  character: number;
  drive: number;
  start: number;
  reverse: boolean;
  gain: number;
  pan: number;
  filter: number;
  resonance: number;
  velocity: number;
  choke: number;
}

export function compileDrumKit(k: DrumKitParams): { pads: CompiledPad[]; volume: number } {
  return {
    volume: Math.pow(10, k.volume / 20),
    pads: k.pads.map((p) => ({
      on: !p.mute,
      sample: p.source === "sample" && !!p.sample,
      model: DRUM_MODELS.indexOf(p.model),
      tune: p.tune,
      decay: p.decay,
      tone: p.tone,
      character: p.character,
      drive: p.drive,
      start: p.start,
      reverse: p.reverse,
      gain: p.level <= LEVEL_MIN ? 0 : Math.pow(10, p.level / 20),
      pan: p.pan,
      filter: p.filter,
      resonance: p.resonance,
      velocity: p.velocity,
      choke: p.choke,
    })),
  };
}
