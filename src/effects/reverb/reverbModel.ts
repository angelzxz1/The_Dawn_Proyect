// The reverb's sound model, shared by the audio engine (which renders it
// into an impulse response for a convolver) and the Reverb window's graph
// (which draws the same early reflections and decay envelopes), so what the
// graph shows is what's actually heard.

export type ReverbMode = "hall" | "room" | "plate";
export const REVERB_MODES: ReverbMode[] = ["hall", "room", "plate"];

/** The `mode` param is stored as a plain number like every other param:
 * 0 = Hall, 1 = Room, 2 = Plate. */
export function reverbModeFromParam(v: number): ReverbMode {
  return REVERB_MODES[Math.max(0, Math.min(2, Math.round(v)))];
}

interface ModeShape {
  /** Early reflections are spread between these times (seconds). */
  erStart: number;
  erEnd: number;
  erCount: number;
  /** When the diffuse tail starts, and how long it takes to build up. */
  tailOnset: number;
  tailBuild: number;
}

const MODE_SHAPES: Record<ReverbMode, ModeShape> = {
  // Big space: sparse reflections spread wide, tail builds slowly.
  hall: { erStart: 0.008, erEnd: 0.085, erCount: 14, tailOnset: 0.02, tailBuild: 0.07 },
  // Small space: dense, tightly packed reflections, tail arrives fast.
  room: { erStart: 0.002, erEnd: 0.035, erCount: 18, tailOnset: 0.006, tailBuild: 0.018 },
  // Plate: essentially no discrete reflections - near-instant dense wash.
  plate: { erStart: 0.0005, erEnd: 0.006, erCount: 6, tailOnset: 0, tailBuild: 0.004 },
};

const LN_1000 = Math.log(1000); // RT60: amplitude falls by 1000x (-60dB)

/** How long the highs (above the Damping frequency) take to fall 60dB. At
 * 20kHz damping the highs last as long as the full band; the lower the
 * damping frequency, the faster they die away. */
export function highsRt60(decay: number, damping: number): number {
  const amount = Math.log(damping / 500) / Math.log(40);
  return decay * Math.max(0.1, Math.min(1, amount));
}

/** Small deterministic PRNG so a given setting always produces the exact
 * same impulse (and the graph can show the exact same reflections). */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface ReflectionTap {
  time: number;
  /** Signed amplitude, largest |gain| = 1. */
  gain: number;
}

/** The discrete early reflections for a mode (channel 0 = left, 1 = right -
 * each side gets its own pattern, which Width then blends between). */
export function earlyReflections(mode: ReverbMode, channel: 0 | 1): ReflectionTap[] {
  const shape = MODE_SHAPES[mode];
  const rand = prng(1013 + channel * 7919 + REVERB_MODES.indexOf(mode) * 104729);
  const taps: ReflectionTap[] = [];
  for (let i = 0; i < shape.erCount; i++) {
    const pos = rand();
    const time = shape.erStart + pos * (shape.erEnd - shape.erStart);
    const magnitude = (1 - 0.65 * pos) * (0.55 + 0.45 * rand());
    taps.push({ time, gain: rand() < 0.5 ? -magnitude : magnitude });
  }
  taps.sort((a, b) => a.time - b.time);
  const peak = Math.max(...taps.map((t) => Math.abs(t.gain)));
  return taps.map((t) => ({ time: t.time, gain: t.gain / peak }));
}

/** 0..1 fade-in of the diffuse tail at `t` seconds (before pre-delay). */
export function tailBuildUp(mode: ReverbMode, t: number): number {
  const shape = MODE_SHAPES[mode];
  if (t < shape.tailOnset) return 0;
  if (shape.tailBuild <= 0) return 1;
  return Math.min(1, (t - shape.tailOnset) / shape.tailBuild);
}

/** RBJ-cookbook Butterworth (Q = 1/sqrt 2) section as a per-sample
 * function. */
function biquad(type: "lowpass" | "highpass", frequency: number, sampleRate: number): (x: number) => number {
  const w0 = (2 * Math.PI * frequency) / sampleRate;
  const cos = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * Math.SQRT1_2);
  const a0 = 1 + alpha;
  const b1 = (type === "lowpass" ? 1 - cos : -(1 + cos)) / a0;
  const b0 = (type === "lowpass" ? (1 - cos) / 2 : (1 + cos) / 2) / a0;
  const b2 = b0;
  const a1 = (-2 * cos) / a0;
  const a2 = (1 - alpha) / a0;
  let z1 = 0;
  let z2 = 0;
  return (x) => {
    const y = b0 * x + z1;
    z1 = b1 * x - a1 * y + z2;
    z2 = b2 * x - a2 * y;
    return y;
  };
}

export interface ImpulseParams {
  decay: number;
  damping: number;
  early: number;
  width: number;
  mode: ReverbMode;
}

/** Renders the stereo impulse response. The tail is noise split at the
 * damping frequency into a low band (decaying over `decay`) and a high band
 * (decaying over `highsRt60`); early reflections are added on top, scaled
 * by `early`. Each channel is normalized to unit energy, so Decay/Early/
 * Width change the character without changing how loud the reverb is. */
export function renderImpulse(
  sampleRate: number,
  p: ImpulseParams
): [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>] {
  const shape = MODE_SHAPES[p.mode];
  const highs = highsRt60(p.decay, p.damping);
  // Long enough for the tail to fall ~72dB.
  const length = Math.max(1, Math.ceil((shape.tailOnset + shape.tailBuild + p.decay * 1.2) * sampleRate));
  const crossover = Math.min(p.damping, sampleRate * 0.45);
  const lowRate = LN_1000 / p.decay;
  const highRate = LN_1000 / highs;

  const renderSide = (channel: 0 | 1): Float32Array<ArrayBuffer> => {
    const out = new Float32Array(length);
    const rand = prng(48271 + channel * 16807);
    // Linkwitz-Riley 4th-order split at the damping frequency (two cascaded
    // Butterworth sections per band): steep enough that the slow low band
    // doesn't leak into the highs and hide the damping, and the two bands
    // still sum flat.
    const lowA = biquad("lowpass", crossover, sampleRate);
    const lowB = biquad("lowpass", crossover, sampleRate);
    const highA = biquad("highpass", crossover, sampleRate);
    const highB = biquad("highpass", crossover, sampleRate);
    let tailEnergy = 0;
    let lowEnv = 1;
    let highEnv = 1;
    const lowStep = Math.exp(-lowRate / sampleRate);
    const highStep = Math.exp(-highRate / sampleRate);
    for (let i = 0; i < length; i++) {
      const noise = rand() * 2 - 1;
      const low = lowB(lowA(noise));
      const high = highB(highA(noise));
      const v = tailBuildUp(p.mode, i / sampleRate) * (low * lowEnv + high * highEnv);
      lowEnv *= lowStep;
      highEnv *= highStep;
      out[i] = v;
      tailEnergy += v * v;
    }
    const tailScale = tailEnergy > 0 ? 1 / Math.sqrt(tailEnergy) : 0;
    for (let i = 0; i < length; i++) out[i] *= tailScale;

    // Reflections: unit total energy, then scaled so Early=100% puts about
    // as much energy in the reflections as in the whole tail.
    const taps = earlyReflections(p.mode, channel);
    const tapEnergy = taps.reduce((s, t) => s + t.gain * t.gain, 0);
    const tapScale = (p.early * 0.9) / Math.sqrt(tapEnergy);
    for (const tap of taps) {
      const i = Math.min(length - 1, Math.round(tap.time * sampleRate));
      out[i] += tap.gain * tapScale;
    }
    return out;
  };

  const left = renderSide(0);
  const independent = renderSide(1);
  // Width blends the right channel from "identical to left" (mono) to fully
  // independent (widest), keeping its energy constant along the way.
  const w = Math.max(0, Math.min(1, p.width));
  const norm = 1 / Math.sqrt((1 - w) * (1 - w) + w * w);
  const right = new Float32Array(length);
  for (let i = 0; i < length; i++) right[i] = ((1 - w) * left[i] + w * independent[i]) * norm;

  for (const ch of [left, right]) {
    let e = 0;
    for (let i = 0; i < length; i++) e += ch[i] * ch[i];
    const s = e > 0 ? 1 / Math.sqrt(e) : 0;
    for (let i = 0; i < length; i++) ch[i] *= s;
  }
  return [left, right];
}
