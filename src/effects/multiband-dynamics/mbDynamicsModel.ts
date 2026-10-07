// Multiband Dynamics (after Live's device of that name): up to three bands,
// each with an Above and a Below threshold, so every band can do two kinds
// of dynamics at once:
//
//   Above ratio > 1: downward compression (loud parts quieter)
//   Above ratio < 1: upward expansion (loud parts louder)
//   Below ratio > 1: downward expansion (quiet parts quieter)
//   Below ratio < 1: upward compression (quiet parts louder)
//
// The kernel is kept as source text because it runs inside an AudioWorklet
// (mbDynamics.ts); the unit tests evaluate this same text and the display
// uses the same static curve. Crossovers are the Multiband Compressor's
// Linkwitz-Riley 24 dB/oct ones (bands sum back flat). The Low and High
// buttons switch their crossover in or out: with both off it's a
// single-band processor using the Mid settings.

import { MB_SOURCE } from "../multiband/multibandModel";
import { keySettingsFromParams, type KeySettings } from "../sidechain/sidechainModel";

export const MBD_BANDS = ["l", "m", "h"] as const;
export type MbdBand = (typeof MBD_BANDS)[number];
export const MBD_BAND_LABELS: Record<MbdBand, string> = { l: "Low", m: "Mid", h: "High" };
/** Per-band fields, stored flat as `<band><Field>` (e.g. `hAboveT`). */
export const MBD_FIELDS = ["On", "Solo", "In", "Out", "AboveT", "AboveR", "BelowT", "BelowR", "Attack", "Release"] as const;
export type MbdField = (typeof MBD_FIELDS)[number];

export const MBD_FIELD_DEFAULTS: Record<MbdField, number> = {
  On: 1,
  Solo: 0,
  In: 0,
  Out: 0,
  AboveT: -20,
  AboveR: 1,
  BelowT: -50,
  BelowR: 1,
  Attack: 0.01,
  Release: 0.06,
};

/** The display's dB range, and the knee Soft Knee adds. */
export const MBD_MIN_DB = -80;
export const MBD_KNEE_DB = 6;
/** Most an upward move can lift (dB). */
export const MBD_MAX_BOOST = 24;
/** A ratio this big reads as infinite. */
export const MBD_RATIO_INF = 49.5;

export const mbdKey = (band: MbdBand, field: MbdField) => `${band}${field}`;

export interface MbdBandSettings {
  on: boolean;
  solo: boolean;
  inDb: number;
  outDb: number;
  aboveT: number;
  aboveR: number;
  belowT: number;
  belowR: number;
  attack: number;
  release: number;
}

export interface MbdSettings extends KeySettings {
  lowOn: boolean;
  highOn: boolean;
  xLow: number;
  xHigh: number;
  bands: Record<MbdBand, MbdBandSettings>;
  softKnee: boolean;
  rms: boolean;
  outputDb: number;
  /** Scales every attack and release. */
  time: number;
  /** 0..1: how much of each ratio applies. */
  amount: number;
  scMix: number;
}

export function mbdBandFromParams(params: Record<string, number>, band: MbdBand): MbdBandSettings {
  const v = (f: MbdField) => params[mbdKey(band, f)] ?? MBD_FIELD_DEFAULTS[f];
  return {
    on: v("On") >= 0.5,
    solo: v("Solo") >= 0.5,
    inDb: v("In"),
    outDb: v("Out"),
    aboveT: v("AboveT"),
    aboveR: v("AboveR"),
    belowT: v("BelowT"),
    belowR: v("BelowR"),
    attack: v("Attack"),
    release: v("Release"),
  };
}

export function mbdSettingsFromParams(params: Record<string, number>, external = false): MbdSettings {
  return {
    ...keySettingsFromParams(params, external),
    lowOn: (params.lowOn ?? 1) >= 0.5,
    highOn: (params.highOn ?? 1) >= 0.5,
    xLow: params.xLow ?? 120,
    xHigh: params.xHigh ?? 2500,
    bands: { l: mbdBandFromParams(params, "l"), m: mbdBandFromParams(params, "m"), h: mbdBandFromParams(params, "h") },
    softKnee: (params.softKnee ?? 1) >= 0.5,
    rms: (params.rms ?? 0) >= 0.5,
    outputDb: params.output ?? 0,
    time: params.time ?? 1,
    amount: params.amount ?? 1,
    scMix: params.scMix ?? 1,
  };
}

/** Which bands exist, low to high. */
export function mbdActiveBands(s: Pick<MbdSettings, "lowOn" | "highOn">): MbdBand[] {
  return [...(s.lowOn ? (["l"] as const) : []), "m", ...(s.highOn ? (["h"] as const) : [])];
}

export const formatMbdRatio = (r: number) => (r >= MBD_RATIO_INF ? "∞" : r >= 10 ? r.toFixed(0) : r.toFixed(2));

export const MBD_SOURCE = `
${MB_SOURCE}
const MBD_KNEE = ${MBD_KNEE_DB};
const MBD_MAX_BOOST = ${MBD_MAX_BOOST};
const MBD_INF = ${MBD_RATIO_INF};
const MBD_FADE = 128;
const MBD_BANDS = ["l", "m", "h"];

// Gain (dB) for a level of x dB: the Above part plus the Below part.
// amount scales each slope toward 1 (no effect).
function mbdStaticGain(x, b, knee, amount) {
  const W = knee ? MBD_KNEE : 0;
  // Above: output slope 1/ratio past the threshold.
  const sa = b.aboveR >= MBD_INF ? 0 : 1 / Math.max(0.01, b.aboveR);
  const ga = mbKnee(x - b.aboveT, W) * (1 + amount * (sa - 1) - 1);
  // Below: output slope = ratio under the threshold.
  const sb = b.belowR >= MBD_INF ? 50 : b.belowR;
  const gb = mbKnee(b.belowT - x, W) * (1 - (1 + amount * (sb - 1)));
  return [ga, gb];
}

class MbdKernel {
  constructor(sampleRate) {
    this.sr = sampleRate;
    this.key = new KeyFilter(sampleRate);
    this.pkRel = Math.exp(-1 / (0.01 * sampleRate));
    this.rmsCoef = 1 - Math.exp(-1 / (0.015 * sampleRate));
    this.smooth = 1 - Math.exp(-1 / (0.01 * sampleRate));
    // Up to 2 crossovers; per crossover LP/HP/AP biquads (15 coefs).
    this.coefs = new Float64Array(2 * 15);
    this.curLog = new Float64Array(2);
    this.targetLog = new Float64Array(2);
    this.xCount = 0;
    // Filter state: 4 channels (L, R, key L, key R) x 2 crossovers x 6
    // biquads (2 LP, 2 HP, 2 AP slots) x 2.
    this.state = new Float64Array(4 * 2 * 6 * 2);
    this.names = ["m"];
    this.bL = new Float64Array(3);
    this.bR = new Float64Array(3);
    this.kL = new Float64Array(3);
    this.kR = new Float64Array(3);
    this.env = new Float64Array(3);
    this.ga = new Float64Array(3);
    this.gb = new Float64Array(3);
    this.act = new Float64Array(3).fill(1);
    this.inG = new Float64Array(3).fill(1);
    this.outG = new Float64Array(3).fill(1);
    this.bands = {};
    this.out = 1;
    this.outTarget = 1;
    this.fade = 1;
    this.pending = null;
    this.started = false;
    // Meters, per active band: input level (after Input) and output level.
    this.meterIn = new Float64Array(3);
    this.meterOut = new Float64Array(3);
  }

  set(s) {
    const names = ["l", "m", "h"].filter((n) => n === "m" || (n === "l" ? s.lowOn : s.highOn));
    // Switching bands in or out rebuilds the split: fade out, switch, fade in.
    if (this.started && names.join() !== this.names.join()) {
      this.pending = s;
      return;
    }
    if (this.pending) this.pending = s;
    else this.apply(s, !this.started);
    this.started = true;
  }

  apply(s, snap) {
    const names = ["l", "m", "h"].filter((n) => n === "m" || (n === "l" ? s.lowOn : s.highOn));
    const rebuilt = names.join() !== this.names.join();
    this.names = names;
    const xs = [];
    if (s.lowOn) xs.push(s.xLow);
    if (s.highOn) xs.push(s.xHigh);
    xs.sort((a, b) => a - b);
    if (xs.length === 2 && xs[1] < xs[0] * 1.25) xs[1] = xs[0] * 1.25;
    this.xCount = xs.length;
    for (let k = 0; k < xs.length; k++) {
      this.targetLog[k] = Math.log(Math.min(this.sr * 0.45, Math.max(10, xs[k])));
      if (snap || rebuilt) {
        this.curLog[k] = this.targetLog[k];
        this.design(k);
      }
    }
    this.bands = s.bands;
    this.knee = !!s.softKnee;
    this.rms = !!s.rms;
    this.amount = Math.max(0, Math.min(1, s.amount));
    const time = Math.max(0.01, s.time);
    this.anySolo = names.some((n) => s.bands[n].solo);
    this.coef = names.map((n) => {
      const b = s.bands[n];
      return {
        atk: Math.exp(-1 / (Math.max(0.00005, b.attack * time) * this.sr)),
        rel: Math.exp(-1 / (Math.max(0.0005, b.release * time) * this.sr)),
        inT: b.on ? Math.pow(10, b.inDb / 20) : 1,
        outT: b.on ? Math.pow(10, b.outDb / 20) : 1,
        on: b.on ? 1 : 0,
      };
    });
    if (snap || rebuilt) {
      for (let i = 0; i < names.length; i++) {
        this.inG[i] = this.coef[i].inT;
        this.outG[i] = this.coef[i].outT;
        this.act[i] = this.coef[i].on;
        this.ga[i] = 0;
        this.gb[i] = 0;
        this.env[i] = 0;
      }
    }
    this.outTarget = Math.pow(10, s.outputDb / 20);
    if (snap) this.out = this.outTarget;
    this.external = !!s.external;
    this.scMix = Math.max(0, Math.min(1, s.scMix == null ? 1 : s.scMix));
    this.listen = !!s.listen;
    this.key.set(s);
    if (rebuilt) this.state.fill(0);
  }

  design(k) {
    const c = mbCoefs(Math.exp(this.curLog[k]), this.sr);
    for (let f = 0; f < 3; f++) for (let i = 0; i < 5; i++) this.coefs[k * 15 + f * 5 + i] = c[f][i];
  }

  bq(ci, si, x) {
    const c = this.coefs;
    const s = this.state;
    const y = c[ci] * x + s[si];
    s[si] = c[ci + 1] * x - c[ci + 3] * y + s[si + 1];
    s[si + 1] = c[ci + 2] * x - c[ci + 4] * y;
    return y;
  }

  // Splits one sample of channel ch into out[0..count-1], low to high.
  split(x, ch, out) {
    const n = this.xCount;
    let rem = x;
    for (let k = 0; k < n; k++) {
      const base = (ch * 2 + k) * 12;
      let lo = this.bq(k * 15, base, rem);
      lo = this.bq(k * 15, base + 2, lo);
      // Keep the low band in phase with what's above: the next
      // crossover's all-pass.
      if (k + 1 < n) lo = this.bq((k + 1) * 15 + 10, base + 8, lo);
      out[k] = lo;
      rem = this.bq(k * 15 + 5, base + 4, rem);
      rem = this.bq(k * 15 + 5, base + 6, rem);
    }
    out[n] = rem;
  }

  process(inL, inR, keyL, keyR, outL, outR, n) {
    const glide = 1 - Math.exp(-n / (0.01 * this.sr));
    for (let k = 0; k < this.xCount; k++) {
      const d = this.targetLog[k] - this.curLog[k];
      if (Math.abs(d) > 1e-5) {
        this.curLog[k] += Math.abs(d) < 1e-3 ? d : d * glide;
        this.design(k);
      }
    }
    const kf = this.key;
    const keyed = this.external || kf.active;
    const count = this.names.length;
    const smooth = this.smooth;
    for (let i = 0; i < n; i++) {
      const l = inL ? inL[i] : 0;
      const r = inR ? inR[i] : l;
      this.split(l, 0, this.bL);
      this.split(r, 1, this.bR);
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
      let dL = this.bL;
      let dR = this.bR;
      let keyGain = kf.gain;
      if (keyed) {
        this.split(kl, 2, this.kL);
        this.split(kr, 3, this.kR);
        dL = this.kL;
        dR = this.kR;
        keyGain = 1;
      }
      let yl = 0;
      let yr = 0;
      for (let b = 0; b < count; b++) {
        const c = this.coef[b];
        const band = this.bands[this.names[b]];
        this.inG[b] += (c.inT - this.inG[b]) * smooth;
        this.outG[b] += (c.outT - this.outG[b]) * smooth;
        this.act[b] += (c.on - this.act[b]) * smooth;
        const inG = this.inG[b];
        // Detector: the key's level in this band, after Input.
        const lv = keyGain * inG;
        const a = Math.abs(dL[b] * lv);
        const bb = Math.abs(dR[b] * lv);
        let level;
        if (this.rms) {
          this.env[b] += ((a * a + bb * bb) / 2 - this.env[b]) * this.rmsCoef;
          level = Math.sqrt(this.env[b]);
        } else {
          const p = a > bb ? a : bb;
          this.env[b] = p > this.env[b] ? p : this.env[b] * this.pkRel;
          level = this.env[b];
        }
        const x = level > 1e-6 ? 20 * Math.log10(level) : -120;
        const g = mbdStaticGain(x, band, this.knee, this.amount);
        // Attack: moving toward more processing; Release: back to none.
        this.ga[b] = Math.abs(g[0]) > Math.abs(this.ga[b]) ? g[0] + c.atk * (this.ga[b] - g[0]) : g[0] + c.rel * (this.ga[b] - g[0]);
        this.gb[b] = Math.abs(g[1]) > Math.abs(this.gb[b]) ? g[1] + c.atk * (this.gb[b] - g[1]) : g[1] + c.rel * (this.gb[b] - g[1]);
        let gdb = this.ga[b] + this.gb[b];
        if (gdb > MBD_MAX_BOOST) gdb = MBD_MAX_BOOST;
        if (gdb < -80) gdb = -80;
        const act = this.act[b];
        const gain = 1 - act + act * inG * Math.pow(10, gdb / 20) * this.outG[b];
        const ol = this.bL[b] * gain;
        const or = this.bR[b] * gain;
        const inPk = Math.max(Math.abs(this.bL[b]), Math.abs(this.bR[b])) * (1 - act + act * inG);
        if (inPk > this.meterIn[b]) this.meterIn[b] = inPk;
        const outPk = Math.max(Math.abs(ol), Math.abs(or));
        if (outPk > this.meterOut[b]) this.meterOut[b] = outPk;
        if (this.anySolo && !band.solo) continue;
        yl += ol;
        yr += or;
      }
      this.out += (this.outTarget - this.out) * smooth;
      if (this.pending) {
        this.fade -= 1 / MBD_FADE;
        if (this.fade <= 0) {
          this.fade = 0;
          const next = this.pending;
          this.pending = null;
          this.apply(next, false);
        }
      } else if (this.fade < 1) {
        this.fade = Math.min(1, this.fade + 1 / MBD_FADE);
      }
      if (this.listen) {
        outL[i] = kl;
        if (outR) outR[i] = kr;
        continue;
      }
      const og = this.out * this.fade;
      outL[i] = yl * og;
      if (outR) outR[i] = yr * og;
    }
  }

  // Per band (by name): peak input and output levels since the last read.
  takeMeters() {
    const m = {};
    this.names.forEach((name, b) => {
      m[name] = { input: this.meterIn[b], output: this.meterOut[b] };
    });
    this.meterIn.fill(0);
    this.meterOut.fill(0);
    return m;
  }
}
`;

const evaluated = new Function(`${MBD_SOURCE}; return { mbdStaticGain };`)() as {
  mbdStaticGain: (x: number, b: MbdBandSettings, knee: boolean, amount: number) => [number, number];
};

/** A band's gain (dB) at a steady input level (dB): its static curve. */
export function mbdStaticGain(levelDb: number, band: MbdBandSettings, softKnee: boolean, amount: number): number {
  const [ga, gb] = evaluated.mbdStaticGain(levelDb, band, softKnee, amount);
  return Math.max(-80, Math.min(MBD_MAX_BOOST, ga + gb));
}
