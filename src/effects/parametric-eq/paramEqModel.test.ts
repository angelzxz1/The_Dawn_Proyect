import { describe, expect, it } from "vitest";
import { EQ_SHAPES, EQ_SOURCE, designEqBand, eqSectionsDb, type EqBand } from "./paramEqModel";

const SR = 48000;
const shape = (name: (typeof EQ_SHAPES)[number]) => EQ_SHAPES.indexOf(name);
const db = (sections: ReturnType<typeof designEqBand>, f: number) => eqSectionsDb(sections, f, SR);

interface Kernel {
  set(state: { bands: EqBand[]; outputDb: number; solo: number }): void;
  process(inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, n: number): void;
}
const Kernel = new Function(`${EQ_SOURCE}; return ParamEqKernel;`)() as new (sr: number) => Kernel;

const band = (b: Partial<EqBand>): EqBand => ({ on: 1, shape: 0, freq: 1000, gain: 0, q: 1, slope: 12, place: 0, ...b });

/** Runs L/R sines through the kernel and returns each side's gain in dB. */
function measure(bands: EqBand[], freq: number, opts: { right?: "same" | "invert" | "silent"; outputDb?: number; solo?: number } = {}) {
  const k = new Kernel(SR);
  k.set({ bands, outputDb: opts.outputDb ?? 0, solo: opts.solo ?? -1 });
  const n = SR / 2;
  const inL = new Float32Array(n);
  const inR = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = 0.5 * Math.sin((2 * Math.PI * freq * i) / SR);
    inL[i] = x;
    inR[i] = opts.right === "invert" ? -x : opts.right === "silent" ? 0 : x;
  }
  const outL = new Float32Array(n);
  const outR = new Float32Array(n);
  for (let i = 0; i < n; i += 128) k.process(inL.subarray(i, i + 128), inR.subarray(i, i + 128), outL.subarray(i, i + 128), outR.subarray(i, i + 128), 128);
  const rms = (d: Float32Array) => Math.sqrt(d.subarray(n / 2).reduce((s, v) => s + v * v, 0) / (n / 2));
  const ref = 0.5 / Math.SQRT2;
  return { l: 20 * Math.log10(rms(outL) / ref), r: 20 * Math.log10(rms(outR) / ref + 1e-12) };
}

describe("band design", () => {
  it("bell: full gain at its frequency, flat far away", () => {
    const s = designEqBand(shape("bell"), 1000, 6, 1, 12, SR);
    expect(db(s, 1000)).toBeCloseTo(6, 3);
    expect(Math.abs(db(s, 30))).toBeLessThan(0.1);
    expect(Math.abs(db(s, 18000))).toBeLessThan(0.2);
  });

  it("shelves reach their gain on their side and stay flat on the other", () => {
    const low = designEqBand(shape("lowShelf"), 200, -9, Math.SQRT1_2, 12, SR);
    expect(db(low, 20)).toBeCloseTo(-9, 1);
    expect(Math.abs(db(low, 10000))).toBeLessThan(0.05);
    const high = designEqBand(shape("highShelf"), 5000, 4, Math.SQRT1_2, 12, SR);
    expect(db(high, 20000)).toBeCloseTo(4, 0);
    expect(Math.abs(db(high, 100))).toBeLessThan(0.05);
  });

  it.each([6, 12, 18, 24, 36, 48, 72, 96])("cuts are -3 dB at the cutoff and fall %i dB/oct", (slope) => {
    const hp = designEqBand(shape("lowCut"), 1000, 0, Math.SQRT1_2, slope, SR);
    expect(db(hp, 1000)).toBeCloseTo(-3.01, 1);
    expect(Math.abs(db(hp, 16000))).toBeLessThan(0.2);
    // Two octaves further down each octave costs ~slope dB.
    expect(db(hp, 125) - db(hp, 250)).toBeCloseTo(-slope, 0);
    const lp = designEqBand(shape("highCut"), 1000, 0, Math.SQRT1_2, slope, SR);
    expect(db(lp, 1000)).toBeCloseTo(-3.01, 1);
    expect(Math.abs(db(lp, 40))).toBeLessThan(0.2);
  });

  it("cut Q adds resonance at the cutoff", () => {
    const flat = db(designEqBand(shape("lowCut"), 500, 0, Math.SQRT1_2, 24, SR), 500);
    const resonant = db(designEqBand(shape("lowCut"), 500, 0, 4, 24, SR), 500);
    expect(resonant - flat).toBeGreaterThan(10);
  });

  it("notch removes its frequency; band pass keeps only its region", () => {
    expect(db(designEqBand(shape("notch"), 60, 0, 4, 12, SR), 60)).toBeLessThan(-60);
    const bp = designEqBand(shape("bandPass"), 1000, 0, 2, 12, SR);
    expect(db(bp, 1000)).toBeCloseTo(0, 3);
    expect(db(bp, 100)).toBeLessThan(-18);
  });

  it("tilt shelf pivots around its frequency", () => {
    const t = designEqBand(shape("tiltShelf"), 1000, 6, Math.SQRT1_2, 12, SR);
    expect(db(t, 20)).toBeCloseTo(-3, 0);
    expect(db(t, 20000)).toBeCloseTo(3, 0);
    expect(Math.abs(db(t, 1000))).toBeLessThan(0.1);
  });
});

describe("kernel", () => {
  it("sounds like the drawn curve", () => {
    const bands = [band({ shape: shape("bell"), freq: 2000, gain: 8, q: 2 }), band({ shape: shape("lowCut"), freq: 200, slope: 24 })];
    const drawn = bands.reduce((sum, b) => sum + db(designEqBand(b.shape, b.freq, b.gain, b.q, b.slope, SR), 2000), 0);
    expect(measure(bands, 2000).l).toBeCloseTo(drawn, 1);
    const drawnLow = bands.reduce((sum, b) => sum + db(designEqBand(b.shape, b.freq, b.gain, b.q, b.slope, SR), 100), 0);
    expect(measure(bands, 100).l).toBeCloseTo(drawnLow, 1);
  });

  it("skips empty and bypassed bands, and applies output gain", () => {
    expect(measure([band({ on: 0, gain: 12 }), band({ on: 2, gain: 12 })], 1000).l).toBeCloseTo(0, 2);
    expect(measure([], 1000, { outputDb: -6 }).l).toBeCloseTo(-6, 1);
  });

  it("places bands on one side, or on mid/side", () => {
    const left = measure([band({ gain: 12, place: 1 })], 1000);
    expect(left.l).toBeCloseTo(12, 1);
    expect(left.r).toBeCloseTo(0, 1);
    // A mono (L = R) signal is all mid: a side band leaves it alone...
    expect(measure([band({ gain: 12, place: 4 })], 1000).l).toBeCloseTo(0, 1);
    // ...and a mid band boosts it.
    expect(measure([band({ gain: 12, place: 3 })], 1000).l).toBeCloseTo(12, 1);
    // An out-of-phase (all side) signal is the reverse.
    expect(measure([band({ gain: 12, place: 4 })], 1000, { right: "invert" }).l).toBeCloseTo(12, 1);
    expect(measure([band({ gain: 12, place: 3 })], 1000, { right: "invert" }).l).toBeCloseTo(0, 1);
  });

  it("solo lets only the band's region through", () => {
    const bands = [band({ freq: 1000, q: 2, gain: 6 })];
    expect(measure(bands, 1000, { solo: 0 }).l).toBeCloseTo(0, 1);
    expect(measure(bands, 100, { solo: 0 }).l).toBeLessThan(-18);
  });

  it("glides to new settings without blowing up", () => {
    const k = new Kernel(SR);
    const buf = new Float32Array(128).map((_, i) => Math.sin(i / 3));
    const out = new Float32Array(128);
    for (let step = 0; step < 200; step++) {
      k.set({ bands: [band({ freq: 50 + step * 90, gain: (step % 30) - 15, q: 0.3 + (step % 7) })], outputDb: 0, solo: -1 });
      k.process(buf, buf, out, out, 128);
      out.forEach((v) => expect(Number.isFinite(v) && Math.abs(v) < 20).toBe(true));
    }
  });
});
