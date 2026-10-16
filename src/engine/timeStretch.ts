// Playing a file faster or slower, for warped clips (warp.ts): what a
// clip's pieces play, rendered to samples. Stretch keeps the pitch, by
// WSOLA - the output is built of overlapping windows of the file, each
// taken from about where the file should be then, nudged to where it
// lines up best with what came before (so the waveform carries on without
// a seam). Repitch reads the file faster or slower, pitch and all, like
// tape. Pure; the work comes in steps (renderSteps) so a long clip can be
// done a bit at a time without holding up the page.

import type { WarpPiece } from "../project/warp";

export type StretchMode = "stretch" | "repitch";

/** How far a window may be nudged (s) to line up. */
const TOLERANCE_SECONDS = 0.012;
/** The coarse search's step: it runs on a signal 4x thinned out. */
const DECIMATE = 4;
const EPS = 1e-9;

/** Where the file is (s) at output time `t` (s), or null where the clip
 * plays nothing: a cursor for times that mostly go forward. */
function sourceCursor(pieces: readonly WarpPiece[]) {
  let i = 0;
  return (t: number): number | null => {
    if (pieces.length === 0) return null;
    if (t < pieces[i].t0 - EPS) i = 0;
    while (i < pieces.length - 1 && t >= pieces[i].t1) i++;
    const p = pieces[i];
    if (t < p.t0 - EPS || t >= p.t1) return null;
    return p.t1 - p.t0 > EPS ? p.s0 + ((t - p.t0) * (p.s1 - p.s0)) / (p.t1 - p.t0) : p.s0;
  };
}

/** A sample between samples (4-point Hermite). */
function hermite(x: Float32Array, pos: number): number {
  const i = Math.floor(pos);
  if (i < 0 || i >= x.length) return 0;
  const f = pos - i;
  const xm1 = x[i - 1] ?? 0;
  const x0 = x[i];
  const x1 = x[i + 1] ?? 0;
  const x2 = x[i + 2] ?? 0;
  const c1 = 0.5 * (x1 - xm1);
  const c2 = xm1 - 2.5 * x0 + 2 * x1 - 0.5 * x2;
  const c3 = 0.5 * (x2 - xm1) + 1.5 * (x0 - x1);
  return ((c3 * f + c2) * f + c1) * f + x0;
}

/** The window length for a sample rate: about 43 ms. */
export function frameSize(sampleRate: number): number {
  return sampleRate > 60000 ? 4096 : 2048;
}

/**
 * Renders what the pieces play of `source` (one array per channel) into
 * `frames` samples, yielding now and then; the last value is the output.
 * Pieces that play at the file's own speed are copied as they are.
 */
export function* renderSteps(
  source: Float32Array[],
  sampleRate: number,
  pieces: readonly WarpPiece[],
  frames: number,
  mode: StretchMode
): Generator<void, Float32Array[], void> {
  const out = source.map(() => new Float32Array(frames));
  if (source.length === 0 || frames === 0) return out;
  const ownSpeed = pieces.every((p) => Math.abs(p.s1 - p.s0 - (p.t1 - p.t0)) < 1e-6);
  if (mode === "repitch" || ownSpeed) {
    const at = sourceCursor(pieces);
    for (let i = 0; i < frames; i++) {
      const s = at(i / sampleRate);
      if (s !== null) {
        const pos = s * sampleRate;
        // At its own speed, sample for sample (no smoothing).
        const whole = ownSpeed ? Math.round(pos) : -1;
        source.forEach((ch, c) => (out[c][i] = whole >= 0 ? (ch[whole] ?? 0) : hermite(ch, pos)));
      }
      if (i % 65536 === 65535) yield;
    }
    return out;
  }
  yield* wsola(source, sampleRate, pieces, out);
  return out;
}

function* wsola(source: Float32Array[], sampleRate: number, pieces: readonly WarpPiece[], out: Float32Array[]): Generator<void, void, void> {
  const frames = out[0].length;
  const n = frameSize(sampleRate);
  const hop = n / 2;
  const tol = Math.round(TOLERANCE_SECONDS * sampleRate);
  // A periodic Hann window: overlapped by half, they add up to 1.
  const win = new Float32Array(n);
  for (let j = 0; j < n; j++) win[j] = 0.5 - 0.5 * Math.cos((2 * Math.PI * j) / n);
  // The channels together, and thinned out, for lining windows up.
  const len = source[0].length;
  const mono = new Float32Array(len);
  source.forEach((ch) => ch.forEach((v, i) => (mono[i] += v)));
  const coarse = new Float32Array(Math.floor(len / DECIMATE));
  for (let i = 0; i < coarse.length; i++) {
    let sum = 0;
    for (let k = 0; k < DECIMATE; k++) sum += mono[i * DECIMATE + k];
    coarse[i] = sum;
  }
  // How alike the window at `a` and the one at `b` start (over half a
  // window), for the candidate at b's level.
  const likeness = (x: Float32Array, a: number, b: number, length: number) => {
    let dot = 0;
    let energy = 0;
    for (let j = 0; j < length; j++) {
      const xa = x[a + j] ?? 0;
      const xb = x[b + j] ?? 0;
      dot += xa * xb;
      energy += xb * xb;
    }
    return dot / Math.sqrt(energy + 1e-9);
  };
  const at = sourceCursor(pieces);
  let prev: number | null = null;
  for (let k = 0, o = -hop; o < frames; k++, o += hop) {
    // The window's middle (kept inside the clip, so its ends are whole).
    const s = at(Math.min(frames - 1, Math.max(0, o + hop)) / sampleRate);
    if (s === null) {
      prev = null;
      continue;
    }
    const ideal = Math.round(s * sampleRate) - hop;
    let chosen = ideal;
    if (prev !== null) {
      // Where the last window would carry on to, unstretched: the window
      // near `ideal` most like it.
      const natural = prev + hop;
      let best = 0;
      let bestScore = -Infinity;
      const c0 = Math.floor(natural / DECIMATE);
      for (let d = -tol; d <= tol; d += DECIMATE) {
        const score = likeness(coarse, c0, Math.floor((ideal + d) / DECIMATE), hop / DECIMATE);
        if (score > bestScore) {
          bestScore = score;
          best = d;
        }
      }
      let fine = best;
      bestScore = -Infinity;
      for (let d = best - DECIMATE + 1; d <= best + DECIMATE - 1; d++) {
        const score = likeness(mono, natural, ideal + d, hop);
        if (score > bestScore) {
          bestScore = score;
          fine = d;
        }
      }
      chosen = ideal + fine;
    }
    for (let c = 0; c < source.length; c++) {
      const x = source[c];
      const y = out[c];
      for (let j = 0; j < n; j++) {
        const i = o + j;
        if (i < 0 || i >= frames) continue;
        const v = x[chosen + j];
        if (v !== undefined) y[i] += v * win[j];
      }
    }
    prev = chosen;
    if (k % 64 === 63) yield;
  }
}

/** Runs the steps to the end at once (the tests, short clips). */
export function renderNow(source: Float32Array[], sampleRate: number, pieces: readonly WarpPiece[], frames: number, mode: StretchMode): Float32Array[] {
  const steps = renderSteps(source, sampleRate, pieces, frames, mode);
  for (;;) {
    const r = steps.next();
    if (r.done) return r.value;
  }
}

/** Runs the steps a few milliseconds at a time, letting the page carry on
 * between. */
export async function renderInSteps(source: Float32Array[], sampleRate: number, pieces: readonly WarpPiece[], frames: number, mode: StretchMode): Promise<Float32Array[]> {
  const steps = renderSteps(source, sampleRate, pieces, frames, mode);
  let started = performance.now();
  for (;;) {
    const r = steps.next();
    if (r.done) return r.value;
    if (performance.now() - started > 8) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      started = performance.now();
    }
  }
}
