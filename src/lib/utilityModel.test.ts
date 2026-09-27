import { describe, expect, it } from "vitest";
import { UTILITY_SOURCE, balanceGains, utilitySettingsFromParams, type UtilitySettings } from "./utilityModel";

const SR = 48000;
interface Kernel {
  set(s: UtilitySettings): void;
  process(inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, n: number): void;
  takeMeters(): { peakL: number; peakR: number; correlation: number };
}
const Kernel = new Function(`${UTILITY_SOURCE}; return UtilityKernel;`)() as new (sr: number) => Kernel;

const settings = (s: Partial<UtilitySettings> = {}): UtilitySettings => ({ ...utilitySettingsFromParams({}), ...s });

/** Runs L/R signals through; returns the last half of the output. */
function run(s: UtilitySettings, left: (i: number) => number, right: (i: number) => number, n = SR / 2) {
  const k = new Kernel(SR);
  k.set(s);

  const inL = new Float32Array(n).map((_, i) => left(i));
  const inR = new Float32Array(n).map((_, i) => right(i));
  const outL = new Float32Array(n);
  const outR = new Float32Array(n);
  for (let i = 0; i < n; i += 128) {
    const m = Math.min(128, n - i);
    k.process(inL.subarray(i, i + m), inR.subarray(i, i + m), outL.subarray(i, i + m), outR.subarray(i, i + m), m);
  }
  return { l: outL.subarray(n / 2), r: outR.subarray(n / 2), meters: k.takeMeters() };
}
const rms = (d: Float32Array) => Math.sqrt(d.reduce((s, v) => s + v * v, 0) / d.length);
const sine = (f: number, a = 0.5) => (i: number) => a * Math.sin((2 * Math.PI * f * i) / SR);

describe("utility", () => {
  it("passes audio untouched by default", () => {
    const { l, r } = run(settings(), sine(440), sine(220));
    expect(rms(l)).toBeCloseTo(0.5 / Math.SQRT2, 4);
    expect(rms(r)).toBeCloseTo(0.5 / Math.SQRT2, 4);
  });

  it("gain, and silence at the floor or when muted", () => {
    expect(rms(run(settings({ gainDb: -6 }), sine(440), sine(440)).l)).toBeCloseTo((0.5 / Math.SQRT2) * Math.pow(10, -6 / 20), 4);
    expect(rms(run(settings({ gainDb: -60 }), sine(440), sine(440)).l)).toBe(0);
    expect(rms(run(settings({ mute: true }), sine(440), sine(440)).l)).toBe(0);
  });

  it("width 0 is mono; mono of an out-of-phase signal cancels", () => {
    const { l, r } = run(settings({ width: 0 }), sine(440), () => 0);
    expect(Array.from(l)).toEqual(Array.from(r));
    expect(rms(run(settings({ mono: true }), sine(440), (i) => -sine(440)(i)).l)).toBeLessThan(1e-6);
  });

  it("width 200% doubles the side", () => {
    // L only: mid = side = x/2. At 200%: L = 1.5x, R = -0.5x.
    const { l, r } = run(settings({ width: 2 }), sine(440), () => 0);
    expect(rms(l)).toBeCloseTo(1.5 * (0.5 / Math.SQRT2), 3);
    expect(rms(r)).toBeCloseTo(0.5 * (0.5 / Math.SQRT2), 3);
  });

  it("bass mono makes the lows mono but keeps the highs wide", () => {
    const s = settings({ bassMono: true, bassFreq: 200 });
    const low = run(s, sine(40), () => 0);
    // A 40 Hz tone on the left only ends up (nearly) equal on both sides.
    expect(rms(low.r) / rms(low.l)).toBeGreaterThan(0.9);
    const high = run(s, sine(4000), () => 0);
    // The mid and side are phase-matched, so a left-only high tone stays left.
    expect(rms(high.r)).toBeLessThan(0.002);
  });

  it("channel modes and polarity", () => {
    const left = run(settings({ channel: 1 }), sine(440), () => 0);
    expect(rms(left.r)).toBeCloseTo(rms(left.l), 5);
    const swap = run(settings({ channel: 3 }), sine(440), () => 0);
    expect(rms(swap.l)).toBe(0);
    expect(rms(swap.r)).toBeGreaterThan(0.3);
    const inv = run(settings({ invertR: true }), sine(440), sine(440));
    expect(inv.meters.correlation).toBeCloseTo(-1, 3);
    expect(run(settings(), sine(440), sine(440)).meters.correlation).toBeCloseTo(1, 3);
  });

  it("balance turns down the far side only", () => {
    expect(balanceGains(0)).toEqual([1, 1]);
    expect(balanceGains(0.5)).toEqual([0.5, 1]);
    expect(balanceGains(-1)).toEqual([1, 0]);
    const { l, r } = run(settings({ balance: 0.5 }), sine(440), sine(440));
    expect(rms(l) / rms(r)).toBeCloseTo(0.5, 3);
  });

  it("DC filter removes an offset", () => {
    const { l } = run(settings({ dcFilter: true }), (i) => 0.3 + sine(440, 0.2)(i), () => 0, SR * 2);
    const mean = l.reduce((s, v) => s + v, 0) / l.length;
    expect(Math.abs(mean)).toBeLessThan(0.005);
  });
});
