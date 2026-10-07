// The Furnace amp's knobs and voicings: what the plugin's params mean to
// the kernel (ampKernel.ts). The knobs read 0-10 like an amp's; the
// channel modes and the rectifier switch pick a voicing - the stage gains,
// filters and tone-stack parts behind the knobs.
//
// Modern is the reference voicing: its constants were fitted against
// measurements of a high-gain rectifier head's rhythm channel (gain and
// harmonics per frequency and level, the clipping curve, the spectrum and
// crest factor of a palm-muted riff), so with the default knobs it lands
// close to that amp. Vintage and Raw are derived from it the way the real
// channels differ: Vintage keeps more mids and a looser low end with less
// gain, Raw drops a clipping stage and opens up the top.

import { AMP_SOURCE, type AmpSettings } from "./ampKernel";

export const AMP_MODES = ["raw", "vintage", "modern"] as const;
export type AmpMode = (typeof AMP_MODES)[number];
export const AMP_MODE_LABELS: Record<AmpMode, string> = { raw: "Raw", vintage: "Vintage", modern: "Modern" };

export const AMP_RECTIFIERS = ["tube", "diode"] as const;
export type AmpRectifier = (typeof AMP_RECTIFIERS)[number];
export const AMP_RECTIFIER_LABELS: Record<AmpRectifier, string> = { tube: "Tube", diode: "Diode" };

/** Default knob positions (0-10): where the reference voicing was fitted. */
export const AMP_DEFAULTS = { gain: 7, bass: 7.2, mid: 1.7, treble: 5, presence: 2.5, master: 5 };

export function ampMode(v: number | undefined): AmpMode {
  return AMP_MODES[Math.min(AMP_MODES.length - 1, Math.max(0, Math.round(v ?? 2)))];
}

export function ampRectifier(v: number | undefined): AmpRectifier {
  return (v ?? 1) >= 0.5 ? "diode" : "tube";
}

type Voicing = Omit<AmpSettings, "gain" | "bass" | "mid" | "treble" | "presence" | "master" | "output" | "sag">;

/** Fitted against the reference capture (see the header). */
const MODERN: Voicing = {
  stageGains: [23.3, 9.91, 17.1, 6.83],
  shelfHz: [762, 762, 762, 762],
  shelfKeep: [0.876, 0.876, 0.876, 0.876],
  couplingHz: [20, 441, 40, 30],
  millerHz: [10005, 8004, 7004, 6003],
  inputHz: 396,
  asymmetry: 1.98,
  bias: 0.569,
  bright: 6,
  stack: { c1: 0.46e-9, c2: 20e-9, c3: 20e-9, r1: 250000, r2: 1000000, r3: 25000, r4: 54753 },
  stackGain: 2.02,
  powerDrive: 3.67,
  presenceHz: 3500,
  presenceDb: 9,
  depthHz: 90,
  depthDb: 6.86,
  lowHz: 40,
  highHz: 12000,
};

/** The output trim that puts the Modern voicing at the reference's level. */
const MODERN_TRIM = -6.41;

function voicing(mode: AmpMode): { v: Voicing; trim: number } {
  const m = MODERN;
  if (mode === "modern") return { v: m, trim: MODERN_TRIM };
  if (mode === "vintage") {
    // Less gain, a fuller low end into the first stages, a smaller slope
    // resistor (more mids out of the stack), less bias shift.
    return {
      v: {
        ...m,
        stageGains: [m.stageGains[0], m.stageGains[1] * 0.6, m.stageGains[2] * 0.7, m.stageGains[3]],
        couplingHz: [m.couplingHz[0], m.couplingHz[1] * 0.5, m.couplingHz[2], m.couplingHz[3]],
        inputHz: m.inputHz * 0.6,
        millerHz: m.millerHz.map((f) => f * 0.85),
        bias: m.bias * 0.7,
        stack: { ...m.stack, r4: m.stack.r4 * 0.55 },
        depthDb: m.depthDb * 0.6,
        presenceDb: m.presenceDb * 0.8,
      },
      trim: MODERN_TRIM + 2,
    };
  }
  // Raw: three clipping stages, brighter and more open.
  return {
    v: {
      ...m,
      stageGains: m.stageGains.slice(0, 3).map((g, i) => (i === 1 ? g * 0.5 : g)),
      shelfHz: m.shelfHz.slice(0, 3),
      shelfKeep: m.shelfKeep.slice(0, 3),
      couplingHz: [m.couplingHz[0], m.couplingHz[1] * 0.4, m.couplingHz[2]],
      millerHz: m.millerHz.slice(0, 3).map((f) => f * 1.2),
      inputHz: m.inputHz * 0.5,
      bias: m.bias * 0.5,
      bright: m.bright * 1.5,
      stack: { ...m.stack, r4: m.stack.r4 * 0.7 },
      depthDb: m.depthDb * 0.5,
    },
    trim: MODERN_TRIM + 4,
  };
}

/** Supply sag per rectifier: the tube rectifier sags and blooms, the
 * diodes stay stiff and tight. */
const SAG: Record<AmpRectifier, number> = { tube: 0.95, diode: 0.5 };

const knob = (v: number | undefined, fallback: number) => Math.min(1, Math.max(0, (v ?? fallback) / 10));

/** The kernel settings for a Furnace's params. */
export function ampSettingsFromParams(params: Record<string, number>): AmpSettings {
  const { v, trim } = voicing(ampMode(params.mode));
  return {
    ...v,
    gain: knob(params.gain, AMP_DEFAULTS.gain),
    bass: knob(params.bass, AMP_DEFAULTS.bass),
    mid: knob(params.mid, AMP_DEFAULTS.mid),
    treble: knob(params.treble, AMP_DEFAULTS.treble),
    presence: knob(params.presence, AMP_DEFAULTS.presence),
    master: knob(params.master, AMP_DEFAULTS.master),
    output: (params.output ?? 0) + trim,
    sag: SAG[ampRectifier(params.rectifier)],
  };
}

interface BiquadLike {
  b0: number; b1: number; b2: number; a1: number; a2: number;
  set(type: string, fc: number, q: number, db: number, fs: number): void;
}
const evaluated = new Function(`${AMP_SOURCE}; return { stackResponse, Biquad };`)() as {
  stackResponse(st: AmpSettings["stack"], t: number, l: number, m: number, w: number): [number, number];
  Biquad: new () => BiquadLike;
};

const taper = (x: number) => (Math.pow(10, 2 * x) - 1) / 99;

function biquadDb(q: BiquadLike, f: number, fs: number): number {
  const w = (2 * Math.PI * f) / fs, c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
  const nr = q.b0 + q.b1 * c1 + q.b2 * c2, ni = -(q.b1 * s1 + q.b2 * s2);
  const dr = 1 + q.a1 * c1 + q.a2 * c2, di = -(q.a1 * s1 + q.a2 * s2);
  return 10 * Math.log10((nr * nr + ni * ni) / (dr * dr + di * di));
}

/** The amp's tone shaping after the distortion (the tone stack, presence
 * and depth), in dB at each of `freqs`, for the window's curve. */
export function ampToneCurve(params: Record<string, number>, freqs: number[]): number[] {
  const s = ampSettingsFromParams(params);
  const fs = 192000;
  const presence = new evaluated.Biquad(), depth = new evaluated.Biquad();
  presence.set("highshelf", s.presenceHz, 0.7, s.presenceDb * s.presence, fs);
  depth.set("peak", s.depthHz, 0.9, s.depthDb, fs);
  return freqs.map((f) => {
    const [re, im] = evaluated.stackResponse(s.stack, s.treble, taper(s.bass), taper(s.mid), 2 * Math.PI * f);
    return 10 * Math.log10(re * re + im * im + 1e-24) + biquadDb(presence, f, fs) + biquadDb(depth, f, fs);
  });
}
