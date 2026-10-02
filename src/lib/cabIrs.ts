// Dawn's own speaker-cabinet impulse responses, generated in code (so
// they're ours to ship): each cab is a designed frequency response - the
// speaker's low resonance, body, presence peaks, cone breakup ripple and
// the steep top-end rolloff - turned into a short minimum-phase IR, which
// like a close-miked cab puts nearly all its energy in the first moments.

import { fft } from "./wavetableModel";

export interface CabPeak {
  hz: number;
  db: number;
  q: number;
}

export interface CabDesign {
  /** The speaker's low resonance: a resonant high-pass. */
  lowHz: number;
  lowQ: number;
  /** Bells for body, mids and presence. */
  peaks: CabPeak[];
  /** Where the top end rolls off, and how steeply (Butterworth order). */
  highHz: number;
  highOrder: number;
  /** Cone breakup: ripple (±dB) between about 1 and 7 kHz. */
  ripple: number;
  seed: number;
}

/** The designed response in dB at frequency `f`. */
export function cabResponseDb(d: CabDesign, f: number): number {
  const x = f / d.lowHz;
  const hp = (x * x) / Math.sqrt((1 - x * x) ** 2 + (x / d.lowQ) ** 2);
  let db = 20 * Math.log10(Math.max(1e-9, hp));
  for (const p of d.peaks) {
    const r = f / p.hz - p.hz / f;
    db += p.db / (1 + r * r * p.q * p.q);
  }
  db -= 10 * Math.log10(1 + Math.pow(f / d.highHz, 2 * d.highOrder));
  if (d.ripple > 0 && f > 600) {
    // A few deterministic wiggles on a log-frequency scale, faded in above
    // 1 kHz and out past the rolloff.
    const oct = Math.log2(f / 1000);
    const window = Math.min(1, Math.max(0, (f - 600) / 600)) / (1 + Math.pow(f / (d.highHz * 1.4), 4));
    let w = 0;
    for (let k = 1; k <= 3; k++) w += Math.sin(oct * (3.1 + 1.7 * k) * Math.PI + d.seed * k * 1.37) / k;
    db += d.ripple * window * w * 0.6;
  }
  return db;
}

/** A minimum-phase impulse response with the given magnitude response
 * (dB as a function of Hz), via the real cepstrum. */
export function minimumPhaseIr(responseDb: (f: number) => number, sampleRate: number, length = 2048, fftSize = 16384): Float32Array {
  const n = fftSize;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  // Log magnitude (natural log), symmetric so the cepstrum is real.
  for (let k = 0; k <= n / 2; k++) {
    const f = Math.max(1, (k * sampleRate) / n);
    const ln = (responseDb(f) / 20) * Math.LN10;
    re[k] = ln;
    if (k > 0 && k < n / 2) re[n - k] = ln;
  }
  fft(re, im, true);
  for (let i = 0; i < n; i++) {
    re[i] /= n;
    im[i] = 0;
  }
  // Fold the cepstrum onto positive quefrencies: that's the minimum-phase one.
  for (let i = 1; i < n / 2; i++) {
    re[i] *= 2;
    re[n - i] = 0;
  }
  fft(re, im);
  for (let k = 0; k < n; k++) {
    const mag = Math.exp(re[k]);
    const ph = im[k];
    re[k] = mag * Math.cos(ph);
    im[k] = mag * Math.sin(ph);
  }
  fft(re, im, true);
  const out = new Float32Array(length);
  const fadeStart = Math.floor(length * 0.75);
  for (let i = 0; i < length; i++) {
    const fade = i < fadeStart ? 1 : 0.5 * (1 + Math.cos((Math.PI * (i - fadeStart)) / (length - fadeStart)));
    out[i] = (re[i] / n) * fade;
  }
  return out;
}

/** Magnitude (dB) of an IR at frequency `f` - for tests and the graph. */
export function irResponseDb(ir: Float32Array, sampleRate: number, f: number, fftSize = 16384): number {
  const re = new Float64Array(fftSize);
  const im = new Float64Array(fftSize);
  re.set(ir.subarray(0, fftSize));
  fft(re, im);
  const k = Math.round((f * fftSize) / sampleRate);
  return 20 * Math.log10(Math.hypot(re[k], im[k]) + 1e-12);
}

export interface FactoryCab {
  id: string;
  name: string;
  description: string;
  use: "guitar" | "bass";
  design: CabDesign;
}

/** The factory cabinets. Ids are kept forever: projects refer to them. */
export const FACTORY_CABS: FactoryCab[] = [
  {
    id: "factory-ir:1x12-open",
    name: "1x12 Open Back",
    description: "Airy combo: loose lows and a sparkly top, for cleans and edge of breakup.",
    use: "guitar",
    design: { lowHz: 95, lowQ: 0.9, peaks: [{ hz: 120, db: 1.5, q: 1 }, { hz: 2200, db: 3, q: 1.2 }, { hz: 4300, db: 2, q: 2 }], highHz: 5600, highOrder: 4, ripple: 2, seed: 1 },
  },
  {
    id: "factory-ir:2x12-combo",
    name: "2x12 Combo",
    description: "Balanced and warm, with a forward upper mid: the all-rounder.",
    use: "guitar",
    design: { lowHz: 85, lowQ: 1.1, peaks: [{ hz: 110, db: 3, q: 1.2 }, { hz: 800, db: 1, q: 0.8 }, { hz: 2500, db: 4, q: 1.2 }], highHz: 5200, highOrder: 5, ripple: 2.5, seed: 2 },
  },
  {
    id: "factory-ir:4x12-closed",
    name: "4x12 Closed Back",
    description: "Tight, thumping lows and a cutting presence peak, for crunch and high gain.",
    use: "guitar",
    design: {
      lowHz: 75,
      lowQ: 1.4,
      peaks: [{ hz: 120, db: 4, q: 1.3 }, { hz: 400, db: -3, q: 1 }, { hz: 2800, db: 5, q: 1.4 }, { hz: 4000, db: -4, q: 3 }],
      highHz: 5000,
      highOrder: 6,
      ripple: 3,
      seed: 3,
    },
  },
  {
    id: "factory-ir:4x12-dark",
    name: "4x12 Vintage Dark",
    description: "Woody and rounded, the top end rolled off early: classic rock and smooth leads.",
    use: "guitar",
    design: { lowHz: 80, lowQ: 1.2, peaks: [{ hz: 130, db: 2.5, q: 1 }, { hz: 700, db: 1.5, q: 0.9 }, { hz: 1800, db: 3, q: 1.1 }], highHz: 3800, highOrder: 6, ripple: 2, seed: 4 },
  },
  {
    id: "factory-ir:1x15-bass",
    name: "1x15 Bass Cab",
    description: "Deep and round, for warm fingerstyle and dub lows.",
    use: "bass",
    design: { lowHz: 45, lowQ: 1, peaks: [{ hz: 80, db: 3, q: 1 }, { hz: 800, db: -2, q: 0.8 }, { hz: 1500, db: 2, q: 1 }], highHz: 4500, highOrder: 4, ripple: 1.5, seed: 5 },
  },
  {
    id: "factory-ir:8x10-bass",
    name: "8x10 Bass Cab",
    description: "Punchy low mids and growl that sit in a rock mix.",
    use: "bass",
    design: { lowHz: 55, lowQ: 1.3, peaks: [{ hz: 100, db: 3, q: 1.2 }, { hz: 500, db: -1, q: 1 }, { hz: 2000, db: 3, q: 1.2 }], highHz: 5000, highOrder: 5, ripple: 2, seed: 6 },
  },
];

export function factoryCab(id: string): FactoryCab | undefined {
  return FACTORY_CABS.find((c) => c.id === id);
}

/** The cab's IR at `sampleRate`: about 43 ms at 48 kHz. */
export function cabImpulse(cab: FactoryCab, sampleRate = 48000): Float32Array {
  return minimumPhaseIr((f) => cabResponseDb(cab.design, f), sampleRate, Math.round((2048 * sampleRate) / 48000));
}
