// Drawing helpers for the synth window: the warped wave, filter curves,
// envelope shape and LFO shapes. They follow the kernel (synthKernel.ts) so
// what's drawn is what plays.

import type { LfoShape, SynthEnvParams, SynthFilterType, WarpMode } from "./synthParams";

/** Where a warp reads the wave at phase `ph` (0..1), as the kernel does. */
export function warpPhase(mode: WarpMode, amt: number, ph: number): number {
  switch (mode) {
    case "sync": {
      const w = ph * (1 + amt * 15);
      return w - Math.floor(w);
    }
    case "bend": {
      const b = amt * 12;
      return (ph * (1 + b)) / (1 + b * ph);
    }
    case "squeeze": {
      const b = amt * 12;
      if (ph < 0.5) {
        const x = 2 * ph;
        return (0.5 * x) / (1 + b * (1 - x));
      }
      const x = 2 - 2 * ph;
      return 1 - (0.5 * x) / (1 + b * (1 - x));
    }
    case "pulse": {
      const width = 1 - 0.95 * amt;
      return ph < width ? ph / width : 0;
    }
    case "mirror": {
      const tri = ph < 0.5 ? ph : 1 - ph;
      const w = ph + (tri - ph) * amt;
      return w < 0 ? w + 1 : w;
    }
    case "quantize": {
      if (amt <= 0) return ph;
      const steps = Math.round(Math.pow(2, 8 - amt * 7));
      return Math.floor(ph * steps) / steps;
    }
    default:
      return ph;
  }
}

/** The fold warp works on the wave's level instead of its phase. */
export function warpLevel(mode: WarpMode, amt: number, y: number): number {
  if (mode !== "fold" || amt <= 0) return y;
  const folded = Math.sin(y * (1 + amt * 7) * Math.PI * 0.5);
  return y + (folded - y) * Math.min(1, amt * 4);
}

/** One cycle of a (preview) frame, warped, as `points` samples. */
export function warpedCycle(frame: Float32Array, mode: WarpMode, amt: number, points: number): Float32Array {
  const n = frame.length;
  const out = new Float32Array(points);
  for (let i = 0; i < points; i++) {
    const w = warpPhase(mode, amt, i / points) * n;
    const i0 = Math.floor(w) % n;
    const fr = w - Math.floor(w);
    const y = frame[i0] + (frame[(i0 + 1) % n] - frame[i0]) * fr;
    out[i] = warpLevel(mode, amt, y);
  }
  return out;
}

// --- filters ---

type C = { re: number; im: number };
const c = (re: number, im = 0): C => ({ re, im });
const add = (a: C, b: C): C => c(a.re + b.re, a.im + b.im);
const mul = (a: C, b: C): C => c(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
const scale = (a: C, k: number): C => c(a.re * k, a.im * k);
const div = (a: C, b: C): C => {
  const d = b.re * b.re + b.im * b.im || 1e-12;
  return c((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d);
};
const mag = (a: C) => Math.hypot(a.re, a.im);

/** 2-pole responses at s = j·f/fc: [lp, bp (unity peak), hp, notch]. */
function svf(f: number, fc: number, k: number): [C, C, C, C] {
  const s = c(0, f / fc);
  const den = add(add(mul(s, s), scale(s, k)), c(1));
  const lp = div(c(1), den);
  const bp = div(scale(s, k), den);
  const hp = div(mul(s, s), den);
  const notch = div(add(mul(s, s), c(1)), den);
  return [lp, bp, hp, notch];
}

const VOWELS: [number, number, number][] = [
  [730, 1090, 2440],
  [530, 1840, 2480],
  [270, 2290, 3010],
  [570, 840, 2410],
  [300, 870, 2240],
];

/** The filter's gain at `f` Hz, in dB. */
export function filterResponseDb(
  type: SynthFilterType,
  cutoff: number,
  resonance: number,
  morph: number,
  mix: number,
  f: number,
  sampleRate = 48000
): number {
  const fc = Math.min(cutoff, sampleRate * 0.45);
  const Q = 0.5 * Math.pow(50, resonance);
  let h: C;
  switch (type) {
    case "lp12":
      h = svf(f, fc, 1 / Q)[0];
      break;
    case "hp12":
      h = svf(f, fc, 1 / Q)[2];
      break;
    case "bp":
      h = svf(f, fc, 1 / Q)[1];
      break;
    case "notch":
      h = svf(f, fc, 1 / Q)[3];
      break;
    case "lp24":
      h = mul(svf(f, fc, 1.414)[0], svf(f, fc, 1 / Math.max(Q, 0.707))[0]);
      break;
    case "hp24":
      h = mul(svf(f, fc, 1.414)[2], svf(f, fc, 1 / Math.max(Q, 0.707))[2]);
      break;
    case "ladder": {
      const k = resonance * 3.9;
      const s = add(c(1), c(0, f / fc));
      const s4 = mul(mul(s, s), mul(s, s));
      h = div(c(1 + k * 0.5), add(s4, c(k)));
      break;
    }
    case "morph": {
      const [lp, bp, hp, notch] = svf(f, fc, 1 / Q);
      const m = morph * 3;
      const lerp = (a: C, b: C, t: number) => add(scale(a, 1 - t), scale(b, t));
      h = m < 1 ? lerp(lp, bp, m) : m < 2 ? lerp(bp, hp, m - 1) : lerp(hp, notch, m - 2);
      break;
    }
    case "comb":
    case "combNeg": {
      const fb = (type === "comb" ? 1 : -1) * resonance * 0.97 * (1 - morph * 0.5 * Math.min(1, f / 4000));
      const w = (2 * Math.PI * f) / fc;
      h = scale(div(c(1), c(1 - fb * Math.cos(w), fb * Math.sin(w))), 1 - Math.abs(fb) * 0.75);
      break;
    }
    default: {
      // Vowel: three band passes.
      const x = morph * 4;
      const j = Math.min(3, Math.floor(x));
      const fr = x - j;
      const shift = Math.min(4, Math.max(0.25, cutoff / 1000));
      const kk = 1 / (4 + resonance * 16);
      h = c(0);
      [1, 0.7, 0.4].forEach((g, i) => {
        const hz = (VOWELS[j][i] + (VOWELS[j + 1][i] - VOWELS[j][i]) * fr) * shift;
        h = add(h, scale(svf(f, hz, kk)[1], g * 1.6));
      });
    }
  }
  const out = add(scale(h, mix), c(1 - mix));
  return 20 * Math.log10(Math.max(1e-6, mag(out)));
}

// --- envelopes ---

/** -1..1: 0 is linear, positive bows the segment out (fast start). */
export function envCurve(x: number, k: number): number {
  if (k > 0.001) return 1 - Math.pow(1 - x, 1 + 4 * k);
  if (k < -0.001) return Math.pow(x, 1 - 4 * k);
  return x;
}

export interface EnvLayout {
  /** Seconds per unit of width. */
  secondsPerX: number;
  /** x of each segment's end: delay, attack, hold, decay, sustain (a fixed stretch), release. */
  x: [number, number, number, number, number, number];
}

/** Lays an envelope out across `width` (the sustain gets a fixed share). */
export function envLayout(env: SynthEnvParams, width: number, span?: number): EnvLayout {
  const sustainW = width * 0.16;
  const total = span ?? Math.max(0.5, env.delay + env.attack + env.hold + env.decay + env.release);
  const secondsPerX = total / (width - sustainW);
  const xs: number[] = [];
  let x = 0;
  [env.delay, env.attack, env.hold, env.decay].forEach((t) => {
    x += t / secondsPerX;
    xs.push(x);
  });
  x += sustainW;
  xs.push(x);
  x += env.release / secondsPerX;
  xs.push(x);
  return { secondsPerX, x: xs as EnvLayout["x"] };
}

/** Points along the envelope (x in layout units, y 0..1). */
export function envPath(env: SynthEnvParams, layout: EnvLayout, steps = 24): [number, number][] {
  const [xd, xa, xh, xdc, xs, xr] = layout.x;
  const pts: [number, number][] = [[0, 0], [xd, 0]];
  for (let i = 1; i <= steps; i++) pts.push([xd + ((xa - xd) * i) / steps, envCurve(i / steps, env.attackCurve)]);
  pts.push([xh, 1]);
  for (let i = 1; i <= steps; i++) pts.push([xh + ((xdc - xh) * i) / steps, env.sustain + (1 - env.sustain) * (1 - envCurve(i / steps, env.decayCurve))]);
  pts.push([xs, env.sustain]);
  for (let i = 1; i <= steps; i++) pts.push([xs + ((xr - xs) * i) / steps, env.sustain * (1 - envCurve(i / steps, env.releaseCurve))]);
  return pts;
}

/** Where a playing envelope is, for the live dot: its stage (as the
 * kernel numbers them) and level. */
export function envPosition(env: SynthEnvParams, layout: EnvLayout, stage: number, level: number): [number, number] | null {
  const [xd, xa, xh, xdc, xs, xr] = layout.x;
  const find = (x0: number, x1: number, y: (t: number) => number) => {
    let best = 0;
    let err = Infinity;
    for (let i = 0; i <= 48; i++) {
      const e = Math.abs(y(i / 48) - level);
      if (e < err) {
        err = e;
        best = i / 48;
      }
    }
    return x0 + (x1 - x0) * best;
  };
  switch (stage) {
    case 1:
      return [0, 0];
    case 2:
      return [find(xd, xa, (t) => envCurve(t, env.attackCurve)), level];
    case 3:
      return [(xa + xh) / 2, 1];
    case 4:
      return [find(xh, xdc, (t) => env.sustain + (1 - env.sustain) * (1 - envCurve(t, env.decayCurve))), level];
    case 5:
      return [(xdc + xs) / 2, level];
    case 6: {
      const from = Math.max(1e-6, env.sustain);
      return [find(xs, xr, (t) => from * (1 - envCurve(t, env.releaseCurve))), level];
    }
    default:
      return null;
  }
}

// --- LFOs ---

function seededSteps(count: number): number[] {
  let s = 12345;
  return Array.from({ length: count }, () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  });
}
const STEPS = seededSteps(9);

/** An LFO's shape at phase p (0..1), 0..1. Random shapes draw an example. */
export function lfoShapeValue(shape: LfoShape, p: number): number {
  switch (shape) {
    case "sine":
      return 0.5 + 0.5 * Math.sin(2 * Math.PI * p);
    case "triangle": {
      const q = (p + 0.25) % 1;
      return q < 0.5 ? 2 * q : 2 - 2 * q;
    }
    case "saw":
      return 1 - p;
    case "ramp":
      return p;
    case "square":
      return p < 0.5 ? 1 : 0;
    case "stepped":
      return STEPS[Math.min(7, Math.floor(p * 8))];
    default: {
      const x = p * 8;
      const i = Math.min(7, Math.floor(x));
      const m = 0.5 - 0.5 * Math.cos(Math.PI * (x - i));
      return STEPS[i] + (STEPS[i + 1] - STEPS[i]) * m;
    }
  }
}
