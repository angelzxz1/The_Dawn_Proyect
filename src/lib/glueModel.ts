// The Glue Compressor's DSP: a bus-style compressor after the classic 80s
// console bus compressor (as Live's Glue Compressor is). It's kept as
// source text because it runs inside an AudioWorklet (glue.ts); the unit
// tests evaluate this same text.
//
// - Ratio, Attack and Release come in fixed steps, like the hardware's
//   switches. There's no knee control: the knee narrows as the ratio goes
//   up (7.5 dB wide at 2:1, 1.5 dB at 10:1).
// - Release "A" (Auto) runs two release times at once: a fast one that
//   lets go after transients and a slow one that holds the overall level,
//   and uses whichever is compressing more.
// - Range caps how much it can compress (-70 dB is effectively no cap).
// - Soft Clip is a fixed waveshaper on the output that never goes past
//   -0.5 dB.
// - Oversampling runs the gain and the clipper at twice the rate (a
//   31-tap filter each way, 15 samples of latency).
// - The detector hears the key: the input, or a sidechain blended with the
//   input by the sidechain Mix, through the sidechain gain and filters.

import { KEY_FILTER_SOURCE, keySettingsFromParams, type KeySettings } from "./sidechainModel";

export const GLUE_RATIOS = [2, 4, 10];
/** Attack steps, milliseconds. */
export const GLUE_ATTACKS_MS = [0.01, 0.1, 0.3, 1, 3, 10, 30];
/** Release steps, seconds; the last step is Auto. */
export const GLUE_RELEASES_S = [0.1, 0.2, 0.4, 0.6, 0.8, 1.2];
export const GLUE_AUTO_RELEASE = GLUE_RELEASES_S.length;
/** Soft Clip's ceiling. */
export const GLUE_CLIP_CEILING_DB = -0.5;
/** Oversampling's latency, in samples at the base rate. */
export const GLUE_OS_LATENCY = 15;

const step = (list: number[], v: number) => list[Math.max(0, Math.min(list.length - 1, Math.round(v)))];

export function glueRatio(v: number): number {
  return step(GLUE_RATIOS, v);
}
export function glueAttackMs(v: number): number {
  return step(GLUE_ATTACKS_MS, v);
}
/** Seconds, or null for Auto. */
export function glueRelease(v: number): number | null {
  const i = Math.max(0, Math.min(GLUE_AUTO_RELEASE, Math.round(v)));
  return i === GLUE_AUTO_RELEASE ? null : GLUE_RELEASES_S[i];
}
export function glueKneeDb(ratio: number): number {
  return 15 / ratio;
}

export const formatGlueAttack = (v: number) => {
  const ms = glueAttackMs(v);
  return `${ms < 1 ? ms : ms.toFixed(0)} ms`;
};
export const formatGlueRelease = (v: number) => {
  const s = glueRelease(v);
  return s === null ? "A" : `${s} s`;
};

export interface GlueSettings extends KeySettings {
  threshold: number;
  ratio: number;
  /** Seconds. */
  attack: number;
  /** Seconds, or 0 for Auto. */
  release: number;
  makeupDb: number;
  /** <= 0 dB. */
  rangeDb: number;
  dryWet: number;
  softClip: boolean;
  oversample: boolean;
  /** How much of the detector's input is the sidechain (vs the effect's
   * own input), while external. */
  scMix: number;
}

export function glueSettingsFromParams(params: Record<string, number>, external: boolean): GlueSettings {
  return {
    ...keySettingsFromParams(params, external),
    threshold: params.threshold ?? -10,
    ratio: glueRatio(params.ratio ?? 1),
    attack: glueAttackMs(params.attack ?? 5) / 1000,
    release: glueRelease(params.release ?? GLUE_AUTO_RELEASE) ?? 0,
    makeupDb: params.makeup ?? 0,
    rangeDb: Math.min(0, params.range ?? -70),
    dryWet: params.dryWet ?? 1,
    softClip: (params.softClip ?? 0) >= 0.5,
    oversample: (params.oversample ?? 0) >= 0.5,
    scMix: params.scMix ?? 1,
  };
}

export const GLUE_SOURCE = `
${KEY_FILTER_SOURCE}
const GLUE_DB = Math.LN10 / 20;
const GLUE_TAPS = 31;
const GLUE_CEIL = Math.pow(10, ${GLUE_CLIP_CEILING_DB} / 20);
const GLUE_CLIP_KNEE = 0.5;

// Low-pass for 2x oversampling: windowed sinc at the base rate's Nyquist.
const GLUE_FIR = (() => {
  const h = new Float64Array(GLUE_TAPS);
  const m = (GLUE_TAPS - 1) / 2;
  let sum = 0;
  for (let i = 0; i < GLUE_TAPS; i++) {
    const t = i - m;
    const sinc = t === 0 ? 0.5 : Math.sin(Math.PI * 0.5 * t) / (Math.PI * t);
    const w = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / (GLUE_TAPS - 1)) + 0.08 * Math.cos((4 * Math.PI * i) / (GLUE_TAPS - 1));
    h[i] = sinc * w;
    sum += h[i];
  }
  for (let i = 0; i < GLUE_TAPS; i++) h[i] /= sum;
  return h;
})();

function glueSoftClip(x) {
  const a = Math.abs(x);
  if (a <= GLUE_CLIP_KNEE) return x;
  const span = GLUE_CEIL - GLUE_CLIP_KNEE;
  return Math.sign(x) * (GLUE_CLIP_KNEE + span * Math.tanh((a - GLUE_CLIP_KNEE) / span));
}

// How much of "d dB past the threshold" counts, with a soft knee W dB wide.
function glueKnee(d, W) {
  if (2 * d >= W) return d;
  if (W > 0 && 2 * d > -W) return ((d + W / 2) * (d + W / 2)) / (2 * W);
  return 0;
}

class GlueFir {
  constructor() {
    this.buf = new Float64Array(GLUE_TAPS * 2);
    this.pos = 0;
  }
  push(x) {
    this.pos = (this.pos + 1) % GLUE_TAPS;
    this.buf[this.pos] = x;
    this.buf[this.pos + GLUE_TAPS] = x;
  }
  out() {
    let y = 0;
    const b = this.buf;
    const p = this.pos + 1;
    for (let i = 0; i < GLUE_TAPS; i++) y += GLUE_FIR[i] * b[p + i];
    return y;
  }
}

class GlueKernel {
  constructor(sampleRate) {
    this.sr = sampleRate;
    this.key = new KeyFilter(sampleRate);
    this.pkRel = Math.exp(-1 / (0.01 * sampleRate));
    this.slowAtk = Math.exp(-1 / (0.4 * sampleRate));
    this.slowRel = Math.exp(-1 / (1.5 * sampleRate));
    this.fastRelAuto = Math.exp(-1 / (0.1 * sampleRate));
    this.det = 0;
    this.fast = 0;
    this.slow = 0;
    this.gain = 1;
    this.smooth = 1 - Math.exp(-1 / (0.01 * sampleRate));
    this.makeup = 1;
    this.wet = 1;
    this.started = false;
    this.os = false;
    this.upL = new GlueFir();
    this.upR = new GlueFir();
    this.downL = new GlueFir();
    this.downR = new GlueFir();
    // Meters, read and reset by the processor.
    this.meterGr = 0;
    this.meterOut = 0;
    this.meterIn = 0;
    this.meterClipping = false;
  }

  set(s) {
    const sr = this.sr;
    this.T = s.threshold;
    this.R = Math.max(1, s.ratio);
    this.W = 15 / this.R;
    this.range = Math.max(0, -s.rangeDb);
    this.atk = Math.exp(-1 / (Math.max(0.000005, s.attack) * sr));
    this.auto = !(s.release > 0);
    this.rel = this.auto ? this.fastRelAuto : Math.exp(-1 / (s.release * sr));
    this.makeupTarget = Math.exp(s.makeupDb * GLUE_DB);
    this.wetTarget = Math.max(0, Math.min(1, s.dryWet));
    this.softClip = !!s.softClip;
    this.external = !!s.external;
    this.scMix = Math.max(0, Math.min(1, s.scMix == null ? 1 : s.scMix));
    this.listen = !!s.listen;
    this.key.set(s);
    this.os = !!s.oversample;
    if (!this.started) {
      this.makeup = this.makeupTarget;
      this.wet = this.wetTarget;
      this.started = true;
    }
  }

  get latency() {
    return this.os ? ${GLUE_OS_LATENCY} : 0;
  }

  // The gain (linear) for one sample of the key.
  detect(kl, kr) {
    const level = Math.max(Math.abs(kl), Math.abs(kr));
    this.det = level > this.det ? level : this.det * this.pkRel;
    const x = this.det > 1e-6 ? Math.log(this.det) / GLUE_DB : -120;
    let r = (1 - 1 / this.R) * glueKnee(x - this.T, this.W);
    if (r > this.range) r = this.range;
    this.fast = r > this.fast ? r + this.atk * (this.fast - r) : r + this.rel * (this.fast - r);
    let gr = this.fast;
    if (this.auto) {
      this.slow = r > this.slow ? r + this.slowAtk * (this.slow - r) : r + this.slowRel * (this.slow - r);
      if (this.slow > gr) gr = this.slow;
    }
    if (gr > this.meterGr) this.meterGr = gr;
    return Math.exp(-gr * GLUE_DB);
  }

  // Makeup, dry/wet and the clipper for one output sample.
  finish(x, dry, g) {
    const w = this.wet;
    let y = dry * (1 - w) + x * g * this.makeup * w;
    if (this.softClip) {
      if (Math.abs(y) > GLUE_CLIP_KNEE) this.meterClipping = true;
      y = glueSoftClip(y);
    }
    return y;
  }

  // n frames of inL/inR into outL/outR; keyL/keyR is the sidechain (null
  // when nothing is connected - silence, while external).
  process(inL, inR, keyL, keyR, outL, outR, n) {
    const kf = this.key;
    const smooth = this.smooth;
    for (let i = 0; i < n; i++) {
      const l = inL ? inL[i] : 0;
      const r = inR ? inR[i] : l;
      if (Math.abs(l) > this.meterIn) this.meterIn = Math.abs(l);
      if (Math.abs(r) > this.meterIn) this.meterIn = Math.abs(r);
      let kl = l;
      let kr = r;
      if (this.external) {
        const el = keyL ? keyL[i] : 0;
        const er = keyR ? keyR[i] : el;
        kl = el * this.scMix + l * (1 - this.scMix);
        kr = er * this.scMix + r * (1 - this.scMix);
      }
      kl = kf.run(kl, 0);
      kr = kf.run(kr, 1);
      const g = this.detect(kl, kr);
      this.makeup += (this.makeupTarget - this.makeup) * smooth;
      this.wet += (this.wetTarget - this.wet) * smooth;
      let yl;
      let yr;
      if (this.listen) {
        yl = kl;
        yr = kr;
      } else if (!this.os) {
        yl = this.finish(l, l, g);
        yr = this.finish(r, r, g);
      } else {
        // Up (zero-stuffed, x2 to keep the level), process - the dry is
        // the same upsampled input, so it stays in line - then down.
        const gPrev = this.gain;
        for (let k = 0; k < 2; k++) {
          this.upL.push(k === 0 ? 2 * l : 0);
          this.upR.push(k === 0 ? 2 * r : 0);
          const gk = k === 0 ? (gPrev + g) / 2 : g;
          const xl = this.upL.out();
          const xr = this.upR.out();
          this.downL.push(this.finish(xl, xl, gk));
          this.downR.push(this.finish(xr, xr, gk));
          // Keep the even-phase output: an exact 15-sample delay.
          if (k === 0) {
            yl = this.downL.out();
            yr = this.downR.out();
          }
        }
      }
      this.gain = g;
      outL[i] = yl;
      if (outR) outR[i] = yr;
      const a = Math.max(Math.abs(yl), Math.abs(yr));
      if (a > this.meterOut) this.meterOut = a;
    }
  }

  takeMeters() {
    const m = { gainReduction: this.meterGr, output: this.meterOut, input: this.meterIn, clipping: this.meterClipping };
    this.meterGr = 0;
    this.meterOut = 0;
    this.meterIn = 0;
    this.meterClipping = false;
    return m;
  }
}
`;
