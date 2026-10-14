// The Compressor's DSP. It's kept as source text because it runs inside an
// AudioWorklet (compressor.ts); the unit tests evaluate this same text.
//
// Detection is stereo-linked on the key signal (the effect's own input, or
// a sidechain), after the sidechain gain and filters: a peak follower that
// falls at the Release time (so a wave's own zero crossings don't read as
// the level dropping), smoothed by the Attack time. The gain computer is
// the same quadratic soft knee the window's curve draws
// (compressorCurve.ts). Makeup, dry/wet and output are smoothed so moving
// them never clicks. No lookahead, so no added latency.

import { KEY_FILTER_SOURCE, keySettingsFromParams, type KeySettings } from "../sidechain/sidechainModel";

export interface CompressorSettings extends KeySettings {
  threshold: number;
  ratio: number;
  knee: number;
  /** Seconds. */
  attack: number;
  release: number;
  /** The makeup actually applied (auto already worked out), dB. */
  makeupDb: number;
  dryWet: number;
  outputDb: number;
}

export function compressorSettingsFromParams(params: Record<string, number>, external: boolean): CompressorSettings {
  const auto = (params.makeupAuto ?? 1) >= 0.5;
  return {
    ...keySettingsFromParams(params, external),
    threshold: params.threshold,
    ratio: params.ratio,
    knee: params.knee,
    attack: params.attack,
    release: params.release,
    makeupDb: auto ? autoMakeupDb(params.threshold, params.ratio) : params.makeup,
    dryWet: params.dryWet,
    outputDb: params.output,
  };
}

export const COMPRESSOR_SOURCE = `
${KEY_FILTER_SOURCE}
const COMP_DB = Math.LN10 / 20;

// Output level (dB) for a level of x dB - see compressorCurve.ts.
function compTransfer(x, T, R, W) {
  const start = T - W / 2;
  if (x <= start) return x;
  if (x >= T + W / 2 || W <= 0) return T + (x - T) / R;
  const d = x - start;
  return x + ((1 / R - 1) * d * d) / (2 * W);
}

class CompressorKernel {
  constructor(sampleRate) {
    this.sr = sampleRate;
    this.key = new KeyFilter(sampleRate);
    this.peak = 0;
    this.det = 0;
    this.smooth = 1 - Math.exp(-1 / (0.01 * sampleRate));
    this.makeup = 1;
    this.wet = 1;
    this.out = 1;
    this.started = false;
    this.external = false;
    this.listen = false;
    // Meters, read and reset by the processor: input/output/key peaks
    // (linear) and the most gain reduction (dB, <= 0) since the last read.
    this.meterIn = 0;
    this.meterOut = 0;
    this.meterKey = 0;
    this.meterGr = 0;
  }

  set(s) {
    const sr = this.sr;
    this.T = s.threshold;
    this.R = Math.max(1, s.ratio);
    this.W = Math.max(0, s.knee);
    this.atk = Math.exp(-1 / (Math.max(0.00005, s.attack) * sr));
    this.rel = Math.exp(-1 / (Math.max(0.001, s.release) * sr));
    this.makeupTarget = Math.exp(s.makeupDb * COMP_DB);
    this.wetTarget = Math.max(0, Math.min(1, s.dryWet));
    this.outTarget = Math.exp(s.outputDb * COMP_DB);
    this.external = !!s.external;
    this.listen = !!s.listen;
    this.key.set(s);
    if (!this.started) {
      this.makeup = this.makeupTarget;
      this.wet = this.wetTarget;
      this.out = this.outTarget;
      this.started = true;
    }
  }

  // n frames of inL/inR into outL/outR; keyL/keyR is the sidechain (null
  // when nothing is connected - silence, while external).
  process(inL, inR, keyL, keyR, outL, outR, n) {
    const smooth = this.smooth;
    const kf = this.key;
    for (let i = 0; i < n; i++) {
      const l = inL ? inL[i] : 0;
      const r = inR ? inR[i] : l;
      let kl;
      let kr;
      if (this.external) {
        kl = keyL ? keyL[i] : 0;
        kr = keyR ? keyR[i] : kl;
      } else {
        kl = l;
        kr = r;
      }
      kl = kf.run(kl, 0);
      kr = kf.run(kr, 1);
      const level = Math.max(Math.abs(kl), Math.abs(kr));
      const peak = this.peak;
      this.peak = level > peak ? level : level + this.rel * (peak - level);
      this.det = this.peak + this.atk * (this.det - this.peak);
      const x = this.det > 1e-6 ? Math.log(this.det) / COMP_DB : -120;
      const gr = compTransfer(x, this.T, this.R, this.W) - x;
      this.makeup += (this.makeupTarget - this.makeup) * smooth;
      this.wet += (this.wetTarget - this.wet) * smooth;
      this.out += (this.outTarget - this.out) * smooth;
      let yl;
      let yr;
      if (this.listen) {
        yl = kl;
        yr = kr;
      } else {
        const g = Math.exp(gr * COMP_DB) * this.makeup;
        const w = this.wet;
        yl = (l * (1 - w) + l * g * w) * this.out;
        yr = (r * (1 - w) + r * g * w) * this.out;
      }
      outL[i] = yl;
      if (outR) outR[i] = yr;
      const aIn = Math.max(Math.abs(l), Math.abs(r));
      if (aIn > this.meterIn) this.meterIn = aIn;
      if (level > this.meterKey) this.meterKey = level;
      const aOut = Math.max(Math.abs(yl), Math.abs(yr));
      if (aOut > this.meterOut) this.meterOut = aOut;
      if (gr < this.meterGr) this.meterGr = gr;
    }
  }

  takeMeters() {
    const m = { input: this.meterIn, output: this.meterOut, key: this.meterKey, gainReduction: this.meterGr };
    this.meterIn = 0;
    this.meterOut = 0;
    this.meterKey = 0;
    this.meterGr = 0;
    return m;
  }
}
`;

/** A standard "half the average gain reduction" heuristic for automatic
 * makeup gain: at signal levels well above threshold, a compressor at this
 * ratio reduces gain by `-threshold * (1 - 1/ratio)` dB, and this recovers
 * roughly half of that. Shared by the audio engine (to actually apply it)
 * and the Compressor UI (to display the live "AUTO +N dB" readout) so both
 * always agree without the UI having to poll the engine. */
export function autoMakeupDb(threshold: number, ratio: number): number {
  const reduction = -threshold * (1 - 1 / ratio);
  return Math.max(0, Math.min(24, reduction / 2));
}
