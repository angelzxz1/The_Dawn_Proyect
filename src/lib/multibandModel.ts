// The Multiband Compressor's DSP: crossover design, the gain computer and
// the per-sample kernel. It's kept as source text because it runs inside an
// AudioWorklet (multiband.ts); the graph evaluates this same text to draw
// its curves and the unit tests check it, so what's drawn and tested is
// exactly what plays.
//
// Crossovers are Linkwitz-Riley 24 dB/oct (two Butterworth sections for
// each side). A low band also runs through the all-pass of every crossover
// above it, so with every band untouched the bands add back up to a flat
// response (only phase changes, like any analog multiband).
//
// Each band has its own stereo-linked dynamics: a peak level detector
// (attack/release set how fast the detected level rises/falls), a
// soft-knee gain computer (downward compression, downward expansion or
// upward compression), and Range capping how far the gain can move. Makeup gain, per-band bypass and
// global mix/output are smoothed so moving them never clicks. No lookahead,
// so no added latency.
//
// With a sidechain (or the sidechain gain/filters in use), the detectors
// hear the key signal split through the same crossovers instead: each band
// reacts to the key's energy in that band.

import { KEY_FILTER_SOURCE, keySettingsFromParams, type KeySettings } from "./sidechainModel";

export const MB_MAX_BANDS = 6;
/** Closest two crossovers may be (a frequency ratio, ~1/3 octave). */
export const MB_MIN_SPACING = 1.25;
export const MB_MIN_FREQ = 20;
export const MB_MAX_FREQ = 20000;

export const MB_MODES = ["compress", "expand", "upward"] as const;
export type MbMode = (typeof MB_MODES)[number];
export const MB_MODE_LABELS: Record<MbMode, string> = {
  compress: "Compress",
  expand: "Expand",
  upward: "Upward",
};

/** Per-band param fields, stored flat as `b<n><Field>`. */
export const MB_BAND_FIELDS = ["Thresh", "Ratio", "Attack", "Release", "Knee", "Range", "Gain", "Mode", "Bypass"] as const;
export type MbBandField = (typeof MB_BAND_FIELDS)[number];

export const MB_BAND_DEFAULTS: Record<MbBandField, number> = {
  Thresh: -20,
  Ratio: 2,
  Attack: 0.01,
  Release: 0.15,
  Knee: 6,
  Range: 24,
  Gain: 0,
  Mode: 0,
  Bypass: 0,
};

/** Crossover defaults: 4 bands split at 120 Hz / 1 kHz / 6 kHz; the rest
 * only matter as automation defaults. */
export const MB_DEFAULT_CROSSOVERS = [120, 1000, 6000, 10000, 15000];
export const MB_DEFAULT_BANDS = 4;

/** One band's settings as the kernel takes them (seconds, dB, 0/1). */
export interface MbBand {
  thresh: number;
  ratio: number;
  attack: number;
  release: number;
  knee: number;
  range: number;
  gain: number;
  mode: number;
  bypass: number;
}

export interface MbSettings extends Partial<KeySettings> {
  count: number;
  /** count - 1 crossover frequencies (Hz). */
  crossovers: number[];
  bands: MbBand[];
  outputDb: number;
  mix: number;
  /** A band (0-based) to hear alone, or -1. */
  solo: number;
}

export const MB_SOURCE = `
${KEY_FILTER_SOURCE}
const MB_MAX = ${MB_MAX_BANDS};
const MB_FADE = 128;
const MB_SLOTS = 4 + MB_MAX;
const MB_DB = Math.LN10 / 20;

// A crossover's three filters, each [b0, b1, b2, a1, a2]: Butterworth
// low pass, high pass, and the matching all pass (what LP^2 + HP^2 equals).
function mbCoefs(freq, sr) {
  const w0 = (2 * Math.PI * Math.min(freq, sr * 0.45)) / sr;
  const cos = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * Math.SQRT1_2);
  const a0 = 1 + alpha;
  const a1 = (-2 * cos) / a0;
  const a2 = (1 - alpha) / a0;
  return [
    [(1 - cos) / 2 / a0, (1 - cos) / a0, (1 - cos) / 2 / a0, a1, a2],
    [(1 + cos) / 2 / a0, -(1 + cos) / a0, (1 + cos) / 2 / a0, a1, a2],
    [(1 - alpha) / a0, (-2 * cos) / a0, 1, a1, a2],
  ];
}

// How much of "d dB past the threshold" counts, with a soft knee W dB wide.
function mbKnee(d, W) {
  if (2 * d >= W) return d;
  if (W > 0 && 2 * d > -W) return ((d + W / 2) * (d + W / 2)) / (2 * W);
  return 0;
}

// Gain (dB) for a level of x dB: mode 0 compresses above the threshold,
// 1 expands (turns down) below it, 2 lifts quiet parts up toward it.
function mbStaticGain(x, T, R, W, mode, range) {
  let g;
  if (mode === 1) g = -(R - 1) * mbKnee(T - x, W);
  else if (mode === 2) g = (1 - 1 / R) * mbKnee(T - x, W);
  else g = (1 / R - 1) * mbKnee(x - T, W);
  return g < -range ? -range : g > range ? range : g;
}

class MultibandKernel {
  constructor(sampleRate) {
    this.sr = sampleRate;
    this.count = 1;
    this.coefs = new Float64Array(MB_MAX * 15);
    // Crossover state for L, R, key L, key R.
    this.state = new Float64Array(4 * MB_MAX * MB_SLOTS * 2);
    this.curLog = new Float64Array(MB_MAX);
    this.targetLog = new Float64Array(MB_MAX);
    this.bandL = new Float64Array(MB_MAX);
    this.bandR = new Float64Array(MB_MAX);
    this.keyL = new Float64Array(MB_MAX);
    this.keyR = new Float64Array(MB_MAX);
    this.key = new KeyFilter(sampleRate);
    this.external = false;
    this.listen = false;
    this.peak = new Float64Array(MB_MAX);
    this.det = new Float64Array(MB_MAX);
    this.env = new Float64Array(MB_MAX);
    this.makeup = new Float64Array(MB_MAX);
    this.active = new Float64Array(MB_MAX).fill(1);
    this.params = [];
    for (let b = 0; b < MB_MAX; b++) this.params.push({ T: -20, R: 2, W: 6, mode: 0, range: 24, atk: 0, rel: 0, gain: 0, bypass: 0 });
    // Meters, read and reset by the processor: per band the most extreme
    // dynamic gain (dB) and the peak level (linear) since the last read.
    this.meterGain = new Float64Array(MB_MAX);
    this.meterLevel = new Float64Array(MB_MAX);
    this.mix = 1;
    this.mixTarget = 1;
    this.out = 1;
    this.outTarget = 1;
    this.solo = -1;
    this.smooth = 1 - Math.exp(-1 / (0.01 * sampleRate));
    this.fade = 1;
    this.pending = null;
    this.started = false;
  }

  set(s) {
    this.external = !!s.external;
    this.listen = !!s.listen;
    this.key.set(s);
    const count = Math.max(1, Math.min(MB_MAX, Math.round(s.count)));
    // Changing the number of bands rebuilds the crossover tree: fade out,
    // switch, fade back in (a few ms) instead of clicking.
    if (this.started && count !== this.count) {
      this.pending = s;
      return;
    }
    if (this.pending) this.pending = s;
    else this.apply(s, !this.started);
    this.started = true;
  }

  apply(s, snap) {
    const sr = this.sr;
    const count = Math.max(1, Math.min(MB_MAX, Math.round(s.count)));
    const rebuilt = count !== this.count;
    this.count = count;
    const xs = s.crossovers.slice(0, count - 1).map((f) => Math.min(sr * 0.45, Math.max(10, f || 1000)));
    xs.sort((a, b) => a - b);
    for (let k = 0; k < count - 1; k++) {
      this.targetLog[k] = Math.log(xs[k]);
      if (snap || rebuilt) {
        this.curLog[k] = this.targetLog[k];
        this.design(k);
      }
    }
    for (let b = 0; b < MB_MAX; b++) {
      const src = s.bands[b];
      if (!src) continue;
      const p = this.params[b];
      p.T = src.thresh;
      p.R = Math.max(1, src.ratio);
      p.W = Math.max(0, src.knee);
      p.mode = Math.round(src.mode);
      p.range = Math.max(0, src.range);
      p.atk = Math.exp(-1 / (Math.max(0.00005, src.attack) * sr));
      p.rel = Math.exp(-1 / (Math.max(0.001, src.release) * sr));
      p.gain = src.gain;
      p.bypass = src.bypass >= 0.5 ? 1 : 0;
      if (snap) {
        this.makeup[b] = p.bypass ? 0 : p.gain;
        this.active[b] = p.bypass ? 0 : 1;
      }
    }
    this.mixTarget = Math.max(0, Math.min(1, s.mix));
    this.outTarget = Math.exp(s.outputDb * MB_DB);
    this.solo = s.solo >= 0 && s.solo < count ? s.solo : -1;
    if (snap) {
      this.mix = this.mixTarget;
      this.out = this.outTarget;
    }
    if (rebuilt) this.state.fill(0);
  }

  design(k) {
    const c = mbCoefs(Math.exp(this.curLog[k]), this.sr);
    const o = k * 15;
    for (let f = 0; f < 3; f++) for (let i = 0; i < 5; i++) this.coefs[o + f * 5 + i] = c[f][i];
  }

  // Splits one channel's sample into the band buffer.
  split(x, ch, out) {
    const c = this.coefs;
    const s = this.state;
    const last = this.count - 1;
    let rem = x;
    for (let k = 0; k < last; k++) {
      const base = (ch * MB_MAX + k) * MB_SLOTS * 2;
      const o = k * 15;
      // Low side: LP twice, then the all-pass of every crossover above.
      let lo = rem;
      for (let pass = 0; pass < 2; pass++) {
        const si = base + pass * 2;
        const y = c[o] * lo + s[si];
        s[si] = c[o + 1] * lo - c[o + 3] * y + s[si + 1];
        s[si + 1] = c[o + 2] * lo - c[o + 4] * y;
        lo = y;
      }
      for (let j = k + 1; j < last; j++) {
        const si = base + (4 + j) * 2;
        const a = j * 15 + 10;
        const y = c[a] * lo + s[si];
        s[si] = c[a + 1] * lo - c[a + 3] * y + s[si + 1];
        s[si + 1] = c[a + 2] * lo - c[a + 4] * y;
        lo = y;
      }
      out[k] = lo;
      // High side: HP twice; it carries on to the next crossover.
      for (let pass = 2; pass < 4; pass++) {
        const si = base + pass * 2;
        const y = c[o + 5] * rem + s[si];
        s[si] = c[o + 6] * rem - c[o + 8] * y + s[si + 1];
        s[si + 1] = c[o + 7] * rem - c[o + 9] * y;
        rem = y;
      }
    }
    out[last] = rem;
  }

  // Processes n frames of inL/inR (inR may be null for mono) into outL/outR
  // (outR may be null); keyL/keyR is the sidechain (null when nothing is
  // connected).
  process(inL, inR, outL, outR, n, keyL, keyR) {
    const count = this.count;
    // Crossover moves glide (~10 ms) so dragging one never zippers.
    const glide = 1 - Math.exp(-n / (0.01 * this.sr));
    for (let k = 0; k < count - 1; k++) {
      const d = this.targetLog[k] - this.curLog[k];
      if (Math.abs(d) > 1e-5) {
        this.curLog[k] += Math.abs(d) < 1e-3 ? d : d * glide;
        this.design(k);
      }
    }
    const smooth = this.smooth;
    const bL = this.bandL;
    const bR = this.bandR;
    const kf = this.key;
    // A separate split for the detectors only when they hear something
    // other than the input itself.
    const keyed = this.external || kf.active;
    const kL = keyed ? this.keyL : bL;
    const kR = keyed ? this.keyR : bR;
    const keyGain = keyed ? 1 : kf.gain;
    for (let i = 0; i < n; i++) {
      const l = inL ? inL[i] : 0;
      const r = inR ? inR[i] : l;
      this.split(l, 0, bL);
      this.split(r, 1, bR);
      let kl = l * kf.gain;
      let kr = r * kf.gain;
      if (keyed) {
        if (this.external) {
          kl = keyL ? keyL[i] : 0;
          kr = keyR ? keyR[i] : kl;
        } else {
          kl = l;
          kr = r;
        }
        kl = kf.run(kl, 0);
        kr = kf.run(kr, 1);
        this.split(kl, 2, kL);
        this.split(kr, 3, kR);
      }
      let wetL = 0;
      let wetR = 0;
      let dryL = 0;
      let dryR = 0;
      for (let b = 0; b < this.count; b++) {
        const p = this.params[b];
        const bl = bL[b];
        const br = bR[b];
        const level = Math.max(Math.abs(kL[b]), Math.abs(kR[b])) * keyGain;
        if (level > this.meterLevel[b]) this.meterLevel[b] = level;
        // Level detection: a peak follower falling at the Release time
        // (so a wave's own zero crossings don't read as the level
        // dropping), smoothed by the Attack time. Attack/Release so mean
        // the level rising/falling in every mode.
        const peak = this.peak[b];
        this.peak[b] = level > peak ? level : level + p.rel * (peak - level);
        this.det[b] = this.peak[b] + p.atk * (this.det[b] - this.peak[b]);
        const x = this.det[b] > 1e-6 ? Math.log(this.det[b]) / MB_DB : -120;
        this.env[b] = mbStaticGain(x, p.T, p.R, p.W, p.mode, p.range);
        this.active[b] += ((p.bypass ? 0 : 1) - this.active[b]) * smooth;
        this.makeup[b] += ((p.bypass ? 0 : p.gain) - this.makeup[b]) * smooth;
        const dyn = this.active[b] * this.env[b];
        if (Math.abs(dyn) > Math.abs(this.meterGain[b])) this.meterGain[b] = dyn;
        if (this.solo >= 0 && b !== this.solo) continue;
        const g = Math.exp((this.makeup[b] + dyn) * MB_DB);
        wetL += bl * g;
        wetR += br * g;
        dryL += bl;
        dryR += br;
      }
      this.mix += (this.mixTarget - this.mix) * smooth;
      this.out += (this.outTarget - this.out) * smooth;
      if (this.pending) {
        this.fade -= 1 / MB_FADE;
        if (this.fade <= 0) {
          this.fade = 0;
          const next = this.pending;
          this.pending = null;
          this.apply(next, false);
        }
      } else if (this.fade < 1) {
        this.fade = Math.min(1, this.fade + 1 / MB_FADE);
      }
      if (this.listen) {
        outL[i] = kl;
        if (outR) outR[i] = kr;
        continue;
      }
      const gain = this.out * this.fade;
      outL[i] = (dryL + (wetL - dryL) * this.mix) * gain;
      if (outR) outR[i] = (dryR + (wetR - dryR) * this.mix) * gain;
    }
  }
}
`;

interface MbSourceExports {
  mbCoefs: (freq: number, sr: number) => number[][];
  mbStaticGain: (x: number, T: number, R: number, W: number, mode: number, range: number) => number;
}

const evaluated = new Function(`${MB_SOURCE}; return { mbCoefs, mbStaticGain };`)() as MbSourceExports;

/** The band's gain (dB) at a steady input level (dB) - its transfer curve,
 * minus makeup. */
export function mbStaticGain(levelDb: number, band: Pick<MbBand, "thresh" | "ratio" | "knee" | "mode" | "range">): number {
  return evaluated.mbStaticGain(levelDb, band.thresh, Math.max(1, band.ratio), Math.max(0, band.knee), Math.round(band.mode), Math.max(0, band.range));
}

function biquadAt(c: number[], w: number): [number, number] {
  // H(e^jw) = (b0 + b1 z^-1 + b2 z^-2) / (1 + a1 z^-1 + a2 z^-2)
  const c1 = Math.cos(w);
  const s1 = -Math.sin(w);
  const c2 = Math.cos(2 * w);
  const s2 = -Math.sin(2 * w);
  const nr = c[0] + c[1] * c1 + c[2] * c2;
  const ni = c[1] * s1 + c[2] * s2;
  const dr = 1 + c[3] * c1 + c[4] * c2;
  const di = c[3] * s1 + c[4] * s2;
  const den = dr * dr + di * di;
  return [(nr * dr + ni * di) / den, (ni * dr - nr * di) / den];
}

/** Each band's complex response (re/im per frequency) through the
 * crossover tree - summed with per-band gains, they give the curve the
 * whole effect applies. */
export function mbBandResponses(crossovers: number[], freqs: number[], sr: number): { re: Float64Array; im: Float64Array }[] {
  const count = crossovers.length + 1;
  const designs = crossovers.map((f) => evaluated.mbCoefs(f, sr));
  const bands = Array.from({ length: count }, () => ({ re: new Float64Array(freqs.length), im: new Float64Array(freqs.length) }));
  freqs.forEach((f, i) => {
    const w = (2 * Math.PI * f) / sr;
    const lp = designs.map((d) => biquadAt(d[0], w));
    const hp = designs.map((d) => biquadAt(d[1], w));
    const ap = designs.map((d) => biquadAt(d[2], w));
    let hr = 1; // product of the high passes so far
    let hi = 0;
    for (let b = 0; b < count; b++) {
      let r = hr;
      let im = hi;
      const mul = (z: [number, number]) => {
        const nr = r * z[0] - im * z[1];
        im = r * z[1] + im * z[0];
        r = nr;
      };
      if (b < count - 1) {
        mul(lp[b]);
        mul(lp[b]);
        for (let j = b + 1; j < count - 1; j++) mul(ap[j]);
        // The next band continues after this crossover's high passes.
        const h = [hr, hi];
        for (const z of [hp[b], hp[b]]) {
          const nr = h[0] * z[0] - h[1] * z[1];
          h[1] = h[0] * z[1] + h[1] * z[0];
          h[0] = nr;
        }
        hr = h[0];
        hi = h[1];
      }
      bands[b].re[i] = r;
      bands[b].im[i] = im;
    }
  });
  return bands;
}

/** Combined response (dB per frequency) with each band at `gainsDb`. */
export function mbTotalDb(responses: { re: Float64Array; im: Float64Array }[], gainsDb: number[], out: Float64Array): Float64Array {
  const lin = gainsDb.map((g) => Math.pow(10, g / 20));
  for (let i = 0; i < out.length; i++) {
    let r = 0;
    let im = 0;
    for (let b = 0; b < responses.length; b++) {
      r += responses[b].re[i] * lin[b];
      im += responses[b].im[i] * lin[b];
    }
    out[i] = 10 * Math.log10(r * r + im * im + 1e-20);
  }
  return out;
}

export const mbKey = (band: number, field: MbBandField) => `b${band + 1}${field}`;

export function mbBandCount(params: Record<string, number>): number {
  return Math.max(1, Math.min(MB_MAX_BANDS, Math.round(params.bands ?? MB_DEFAULT_BANDS)));
}

/** The active crossovers, lowest first. */
export function mbCrossovers(params: Record<string, number>): number[] {
  const count = mbBandCount(params);
  return Array.from({ length: count - 1 }, (_, k) => params[`x${k + 1}`] ?? MB_DEFAULT_CROSSOVERS[k]).sort((a, b) => a - b);
}

export function mbBandFromParams(params: Record<string, number>, band: number): MbBand {
  const v = (f: MbBandField) => params[mbKey(band, f)] ?? MB_BAND_DEFAULTS[f];
  return {
    thresh: v("Thresh"),
    ratio: v("Ratio"),
    attack: v("Attack"),
    release: v("Release"),
    knee: v("Knee"),
    range: v("Range"),
    gain: v("Gain"),
    mode: v("Mode"),
    bypass: v("Bypass"),
  };
}

export function mbSettingsFromParams(params: Record<string, number>, solo = -1, external = false): MbSettings {
  return {
    ...keySettingsFromParams(params, external),
    count: mbBandCount(params),
    crossovers: mbCrossovers(params),
    bands: Array.from({ length: MB_MAX_BANDS }, (_, b) => mbBandFromParams(params, b)),
    outputDb: params.output ?? 0,
    mix: params.mix ?? 1,
    solo,
  };
}

/** Which band (0-based) a frequency falls in. */
export function mbBandAt(params: Record<string, number>, freq: number): number {
  const xs = mbCrossovers(params);
  const i = xs.findIndex((x) => freq < x);
  return i === -1 ? xs.length : i;
}

/** Where a crossover may move to, keeping its neighbours MB_MIN_SPACING
 * away. */
export function mbCrossoverLimits(params: Record<string, number>, k: number): [number, number] {
  const xs = mbCrossovers(params);
  return [k > 0 ? xs[k - 1] * MB_MIN_SPACING : MB_MIN_FREQ, k < xs.length - 1 ? xs[k + 1] / MB_MIN_SPACING : MB_MAX_FREQ];
}

/** The param changes that split the band under `freq` in two there (the
 * new upper half starts as a copy of it). Null if there's no room. */
export function mbSplitChanges(params: Record<string, number>, freq: number): Record<string, number> | null {
  const count = mbBandCount(params);
  if (count >= MB_MAX_BANDS) return null;
  const xs = mbCrossovers(params);
  const b = mbBandAt(params, freq);
  const lo = b > 0 ? xs[b - 1] * MB_MIN_SPACING : MB_MIN_FREQ;
  const hi = b < xs.length ? xs[b] / MB_MIN_SPACING : MB_MAX_FREQ;
  if (freq < lo || freq > hi) return null;
  const nextXs = [...xs.slice(0, b), Math.round(freq), ...xs.slice(b)];
  const changes: Record<string, number> = { bands: count + 1 };
  nextXs.forEach((x, k) => (changes[`x${k + 1}`] = x));
  for (let dst = count; dst > b; dst--) {
    for (const f of MB_BAND_FIELDS) changes[mbKey(dst, f)] = params[mbKey(dst - 1, f)] ?? MB_BAND_DEFAULTS[f];
  }
  return changes;
}

/** The param changes that remove a band, handing its range to a neighbour
 * (the one below; the lowest band hands its range to the one above). */
export function mbRemoveChanges(params: Record<string, number>, band: number): Record<string, number> | null {
  const count = mbBandCount(params);
  if (count <= 1 || band < 0 || band >= count) return null;
  const xs = mbCrossovers(params);
  const nextXs = xs.filter((_, k) => k !== Math.max(0, band - 1));
  const changes: Record<string, number> = { bands: count - 1 };
  nextXs.forEach((x, k) => (changes[`x${k + 1}`] = x));
  for (let dst = band; dst < count - 1; dst++) {
    for (const f of MB_BAND_FIELDS) changes[mbKey(dst, f)] = params[mbKey(dst + 1, f)] ?? MB_BAND_DEFAULTS[f];
  }
  return changes;
}
