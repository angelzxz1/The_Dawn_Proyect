import { describe, expect, it } from "vitest";
import {
  MB_BAND_DEFAULTS,
  MB_SOURCE,
  mbBandResponses,
  mbCrossovers,
  mbRemoveChanges,
  mbSettingsFromParams,
  mbSplitChanges,
  mbStaticGain,
  mbTotalDb,
  type MbBand,
  type MbSettings,
} from "./multibandModel";

const SR = 48000;

interface Kernel {
  set(s: MbSettings): void;
  process(inL: Float32Array, inR: Float32Array | null, outL: Float32Array, outR: Float32Array | null, n: number): void;
  meterGain: Float64Array;
}
const Kernel = new Function(`${MB_SOURCE}; return MultibandKernel;`)() as new (sr: number) => Kernel;

const band = (b: Partial<MbBand> = {}): MbBand => ({
  thresh: 0,
  ratio: 1,
  attack: 0.005,
  release: 0.05,
  knee: 0,
  range: 60,
  gain: 0,
  mode: 0,
  bypass: 0,
  ...b,
});
const settings = (s: Partial<MbSettings> & { bands?: MbBand[] }): MbSettings => ({
  count: 4,
  crossovers: [120, 1000, 6000],
  outputDb: 0,
  mix: 1,
  solo: -1,
  ...s,
  bands: s.bands ?? Array.from({ length: 6 }, () => band()),
});

/** Runs a sine (amplitude `amp`) through the kernel; returns its output
 * level relative to the input, in dB, over the last half. */
function measure(s: MbSettings, freq: number, amp = 0.5, k = new Kernel(SR)) {
  k.set(s);
  const n = SR;
  const inL = new Float32Array(n).map((_, i) => amp * Math.sin((2 * Math.PI * freq * i) / SR));
  const outL = new Float32Array(n);
  const outR = new Float32Array(n);
  for (let i = 0; i < n; i += 128) k.process(inL.subarray(i, i + 128), inL.subarray(i, i + 128), outL.subarray(i, i + 128), outR.subarray(i, i + 128), 128);
  const rms = (d: Float32Array) => Math.sqrt(d.subarray(n / 2).reduce((sum, v) => sum + v * v, 0) / (n / 2));
  return 20 * Math.log10(rms(outL) / (amp / Math.SQRT2));
}

describe("gain computer", () => {
  it("compresses above the threshold by the ratio", () => {
    const b = { thresh: -20, ratio: 4, knee: 0, mode: 0, range: 60 };
    expect(mbStaticGain(-30, b)).toBeCloseTo(0, 9);
    expect(mbStaticGain(-8, b)).toBeCloseTo(-9, 6); // 12 dB over -> 3 dB over
  });

  it("soft knee eases in around the threshold", () => {
    const b = { thresh: -20, ratio: 4, knee: 10, mode: 0, range: 60 };
    expect(mbStaticGain(-26, b)).toBeCloseTo(0, 9);
    expect(mbStaticGain(-20, b)).toBeLessThan(0);
    expect(mbStaticGain(-20, b)).toBeGreaterThan(-2);
    expect(mbStaticGain(-8, b)).toBeCloseTo(-9, 6);
  });

  it("expands below the threshold, and lifts upward", () => {
    expect(mbStaticGain(-30, { thresh: -20, ratio: 2, knee: 0, mode: 1, range: 60 })).toBeCloseTo(-10, 6);
    expect(mbStaticGain(-10, { thresh: -20, ratio: 2, knee: 0, mode: 1, range: 60 })).toBeCloseTo(0, 9);
    expect(mbStaticGain(-40, { thresh: -20, ratio: 2, knee: 0, mode: 2, range: 60 })).toBeCloseTo(10, 6);
    expect(mbStaticGain(-10, { thresh: -20, ratio: 2, knee: 0, mode: 2, range: 60 })).toBeCloseTo(0, 9);
  });

  it("range caps how far the gain moves", () => {
    expect(mbStaticGain(0, { thresh: -40, ratio: 20, knee: 0, mode: 0, range: 12 })).toBe(-12);
    expect(mbStaticGain(-120, { thresh: -20, ratio: 4, knee: 0, mode: 2, range: 9 })).toBe(9);
  });
});

describe("crossovers", () => {
  const freqs = [20, 50, 120, 300, 1000, 2500, 6000, 12000, 19000];

  it.each([1, 2, 4, 6])("%i band(s) sum back to flat", (count) => {
    const xs = [100, 400, 1500, 5000, 12000].slice(0, count - 1);
    const responses = mbBandResponses(xs, freqs, SR);
    const total = mbTotalDb(responses, Array(count).fill(0), new Float64Array(freqs.length));
    total.forEach((v) => expect(Math.abs(v)).toBeLessThan(0.01));
  });

  it("each band is -6 dB at its crossovers and falls 24 dB/oct outside", () => {
    const [low, high] = mbBandResponses([1000], [250, 500, 1000], SR);
    const dbOf = (r: { re: Float64Array; im: Float64Array }, i: number) => 10 * Math.log10(r.re[i] ** 2 + r.im[i] ** 2);
    expect(dbOf(low, 2)).toBeCloseTo(-6.02, 1);
    expect(dbOf(high, 2)).toBeCloseTo(-6.02, 1);
    expect(dbOf(high, 0) - dbOf(high, 1)).toBeCloseTo(-24, 0);
  });

  it("the kernel is flat with nothing set, and each band's gain lands in its range", () => {
    for (const f of [60, 400, 3000, 12000]) expect(Math.abs(measure(settings({}), f))).toBeLessThan(0.05);
    const bands = Array.from({ length: 6 }, (_, i) => band({ gain: i === 1 ? 6 : 0 }));
    expect(measure(settings({ bands }), 350)).toBeCloseTo(6, 0);
    expect(Math.abs(measure(settings({ bands }), 40))).toBeLessThan(0.3);
    expect(Math.abs(measure(settings({ bands }), 12000))).toBeLessThan(0.3);
  });
});

describe("kernel dynamics", () => {
  // One band (no crossovers), so the amounts are exact.
  const single = (b: Partial<MbBand>) => settings({ count: 1, crossovers: [], bands: Array.from({ length: 6 }, () => band(b)) });

  it("compresses by the ratio", () => {
    // A tone peaking at -6 dBFS is 14 dB over -20: 4:1 leaves 3.5 dB over.
    expect(measure(single({ thresh: -20, ratio: 4 }), 1000, 0.5)).toBeCloseTo(-10.5, 1);
    expect(Math.abs(measure(single({ thresh: -20, ratio: 4 }), 1000, 0.01))).toBeLessThan(0.05);
    // A low tone too: its zero crossings don't read as the level dropping.
    expect(measure(single({ thresh: -20, ratio: 4 }), 50, 0.5)).toBeCloseTo(-10.5, 0);
  });

  it("expands and lifts by the ratio, up to Range", () => {
    // A tone peaking at -40 dBFS, 20 dB under a -20 dB threshold.
    expect(measure(single({ thresh: -20, ratio: 2, mode: 1 }), 1000, 0.01)).toBeCloseTo(-20, 1);
    expect(measure(single({ thresh: -20, ratio: 4, mode: 1, range: 24 }), 1000, 0.01)).toBeCloseTo(-24, 1);
    expect(measure(single({ thresh: -20, ratio: 2, mode: 2 }), 1000, 0.01)).toBeCloseTo(10, 1);
  });

  it("compresses only the band that's over its threshold", () => {
    const bands = Array.from({ length: 6 }, (_, i) => band(i === 2 ? { thresh: -20, ratio: 4 } : {}));
    expect(measure(settings({ bands }), 2500, 0.5)).toBeLessThan(-8);
    expect(Math.abs(measure(settings({ bands }), 60, 0.5))).toBeLessThan(0.1);
  });

  it("bypass, mix, output and solo", () => {
    const squash = Array.from({ length: 6 }, () => band({ thresh: -40, ratio: 20 }));
    const bypassed = squash.map((b) => ({ ...b, bypass: 1 }));
    expect(Math.abs(measure(settings({ bands: bypassed }), 2500))).toBeLessThan(0.05);
    expect(Math.abs(measure(settings({ bands: squash, mix: 0 }), 2500))).toBeLessThan(0.05);
    expect(measure(settings({ outputDb: -6 }), 2500)).toBeCloseTo(-6, 1);
    // Soloing band 1 (<120 Hz) keeps a 50 Hz tone and drops a 2.5 kHz one.
    expect(Math.abs(measure(settings({ solo: 0 }), 50))).toBeLessThan(0.3);
    expect(measure(settings({ solo: 0 }), 2500)).toBeLessThan(-60);
  });

  it("changes band count without blowing up, and reports its gain", () => {
    const k = new Kernel(SR);
    const buf = new Float32Array(128).map((_, i) => 0.8 * Math.sin(i / 5));
    const out = new Float32Array(128);
    for (let step = 0; step < 200; step++) {
      const count = 1 + (Math.floor(step / 10) % 6);
      const xs = [80 + step * 3, 500, 2000, 5000, 11000].slice(0, count - 1);
      k.set(settings({ count, crossovers: xs, bands: Array.from({ length: 6 }, () => band({ thresh: -30, ratio: 6 })) }));
      k.process(buf, buf, out, out, 128);
      out.forEach((v) => expect(Number.isFinite(v) && Math.abs(v) < 4).toBe(true));
    }
    expect(Math.min(...k.meterGain)).toBeLessThan(-3);
  });
});

describe("params", () => {
  const base: Record<string, number> = { bands: 3, x1: 200, x2: 2000, b1Thresh: -10, b2Thresh: -20, b3Thresh: -30 };

  it("splits a band, the new half copying it", () => {
    const c = mbSplitChanges(base, 600)!;
    const next = { ...base, ...c };
    expect(next.bands).toBe(4);
    expect(mbCrossovers(next)).toEqual([200, 600, 2000]);
    expect([next.b1Thresh, next.b2Thresh, next.b3Thresh, next.b4Thresh]).toEqual([-10, -20, -20, -30]);
    // Too close to an existing crossover, or already at six bands.
    expect(mbSplitChanges(base, 210)).toBeNull();
    expect(mbSplitChanges({ ...base, bands: 6, x3: 5000, x4: 8000, x5: 12000 }, 600)).toBeNull();
  });

  it("removes a band, a neighbour taking its range", () => {
    const middle = { ...base, ...mbRemoveChanges(base, 1)! };
    expect(middle.bands).toBe(2);
    expect(mbCrossovers(middle)).toEqual([2000]);
    expect([middle.b1Thresh, middle.b2Thresh]).toEqual([-10, -30]);
    const lowest = { ...base, ...mbRemoveChanges(base, 0)! };
    expect(mbCrossovers(lowest)).toEqual([2000]);
    expect([lowest.b1Thresh, lowest.b2Thresh]).toEqual([-20, -30]);
    expect(mbRemoveChanges({ bands: 1 }, 0)).toBeNull();
  });

  it("fills missing params with defaults", () => {
    const s = mbSettingsFromParams({});
    expect(s.count).toBe(4);
    expect(s.crossovers).toEqual([120, 1000, 6000]);
    expect(s.bands[5].thresh).toBe(MB_BAND_DEFAULTS.Thresh);
  });
});
