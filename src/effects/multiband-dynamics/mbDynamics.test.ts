import { describe, expect, it } from "vitest";
import { defaultParams } from "../registry";
import { MBD_SOURCE, mbdBandFromParams, mbdSettingsFromParams, mbdStaticGain, type MbdSettings } from "./mbDynamicsModel";

const SR = 48000;
type Buf = Float32Array | null;
interface Kernel {
  set(s: MbdSettings): void;
  process(inL: Buf, inR: Buf, keyL: Buf, keyR: Buf, outL: Float32Array, outR: Float32Array | null, n: number): void;
  takeMeters(): Record<string, { input: number; output: number }>;
}
const Mbd = new Function(`${MBD_SOURCE}; return MbdKernel;`)() as new (sr: number) => Kernel;

const sine = (f: number, db: number, seconds = 0.5) =>
  new Float32Array(Math.round(seconds * SR)).map((_, i) => Math.pow(10, db / 20) * Math.sin((2 * Math.PI * f * i) / SR));
const mix = (...xs: Float32Array[]) => xs[0].map((_, i) => xs.reduce((s, x) => s + x[i], 0));
const peakDb = (d: Float32Array) => 20 * Math.log10(d.subarray(d.length / 2).reduce((p, v) => Math.max(p, Math.abs(v)), 0) + 1e-12);
const rmsDb = (d: Float32Array) => {
  const h = d.subarray(d.length / 2);
  return 10 * Math.log10(h.reduce((s, v) => s + v * v, 0) / h.length + 1e-20);
};

/** Single band (Low and High off), no knee, peak detection by default. */
const single = { lowOn: 0, highOn: 0, softKnee: 0 };
function run(params: Record<string, number>, input: Float32Array, key: Buf = null, external = false): Float32Array {
  const k = new Mbd(SR);
  k.set(mbdSettingsFromParams({ ...defaultParams("mbDynamics"), ...params }, external));
  const out = new Float32Array(input.length);
  for (let i = 0; i < input.length; i += 128) {
    const n = Math.min(128, input.length - i);
    k.process(input.subarray(i, i + n), null, key ? key.subarray(i, i + n) : null, null, out.subarray(i, i + n), null, n);
  }
  return out;
}

describe("multiband dynamics: the four kinds of processing", () => {
  it("Above > 1 compresses down; Above < 1 expands up", () => {
    // -6 dB peaks over a -20 threshold: 14 dB over.
    expect(peakDb(run({ ...single, mAboveT: -20, mAboveR: 4 }, sine(1000, -6)))).toBeCloseTo(-16.5, 0);
    // Slope 2 over the threshold: -14 in (6 over) comes out 12 over.
    expect(peakDb(run({ ...single, mAboveT: -20, mAboveR: 0.5 }, sine(1000, -14)))).toBeCloseTo(-8, 0);
  });

  it("Below > 1 expands down; Below < 1 compresses up", () => {
    // -50 dB is 10 under a -40 threshold: slope 2 puts it 20 under.
    expect(peakDb(run({ ...single, mBelowT: -40, mBelowR: 2 }, sine(1000, -50)))).toBeCloseTo(-60, 0);
    // Slope 0.5 lifts -60 (20 under) to 10 under.
    expect(peakDb(run({ ...single, mBelowT: -40, mBelowR: 0.5 }, sine(1000, -60)))).toBeCloseTo(-50, 0);
  });

  it("does both at once in one band, and nothing in between", () => {
    const p = { ...single, mAboveT: -20, mAboveR: 4, mBelowT: -50, mBelowR: 2 };
    expect(peakDb(run(p, sine(1000, -35)))).toBeCloseTo(-35, 1);
    expect(peakDb(run(p, sine(1000, -6)))).toBeCloseTo(-16.5, 0);
    expect(peakDb(run(p, sine(1000, -55)))).toBeCloseTo(-60, 0);
  });

  it("the static curve matches", () => {
    const band = mbdBandFromParams({ mAboveT: -20, mAboveR: 4, mBelowT: -50, mBelowR: 2 }, "m");
    expect(mbdStaticGain(-6, band, false, 1)).toBeCloseTo(-10.5, 6);
    expect(mbdStaticGain(-55, band, false, 1)).toBeCloseTo(-5, 6);
    expect(mbdStaticGain(-35, band, false, 1)).toBeCloseTo(0, 9);
  });

  it("Amount scales every ratio toward 1", () => {
    const p = { ...single, mAboveT: -20, mAboveR: 4 };
    expect(peakDb(run({ ...p, amount: 0 }, sine(1000, -6)))).toBeCloseTo(-6, 1);
    // Half the slope change: 1 -> 0.25 becomes 1 -> 0.625; 14 over -> 8.75.
    expect(peakDb(run({ ...p, amount: 0.5 }, sine(1000, -6)))).toBeCloseTo(-11.25, 0);
  });

  it("RMS detection reads a sine 3 dB lower than Peak", () => {
    const p = { ...single, mAboveT: -20, mAboveR: 50, mRelease: 0.3 };
    // Nearly limiting: Peak holds the peaks at -20, RMS the RMS at -20.
    expect(peakDb(run(p, sine(1000, -6)))).toBeCloseTo(-20, 0);
    expect(peakDb(run({ ...p, rms: 1 }, sine(1000, -6)))).toBeCloseTo(-17, 0);
  });

  it("Input and Output gains, and the band switch", () => {
    expect(peakDb(run({ ...single, mIn: -6, mOut: 3 }, sine(1000, -10)))).toBeCloseTo(-13, 1);
    // Input drives the band into its threshold.
    expect(peakDb(run({ ...single, mIn: 6, mAboveT: -20, mAboveR: 50 }, sine(1000, -20)))).toBeCloseTo(-20, 0);
    // Off: all of it bypassed.
    expect(peakDb(run({ ...single, mOn: 0, mIn: -12, mAboveT: -40, mAboveR: 10 }, sine(1000, -10)))).toBeCloseTo(-10, 1);
  });
});

describe("multiband dynamics: bands", () => {
  const low = () => sine(80, -12, 1);
  const high = () => sine(6000, -12, 1);

  it("sums flat with nothing set", () => {
    const x = mix(low(), sine(1000, -12, 1), high());
    expect(rmsDb(run({}, x))).toBeCloseTo(rmsDb(x), 1);
  });

  it("each band only touches its own range", () => {
    const p = { hAboveT: -30, hAboveR: 20 };
    expect(peakDb(run(p, low()))).toBeCloseTo(-12, 0);
    expect(peakDb(run(p, high()))).toBeLessThan(-25);
  });

  it("solo mutes the others", () => {
    const x = mix(low(), high());
    const soloHigh = run({ hSolo: 1 }, x);
    expect(rmsDb(soloHigh)).toBeCloseTo(rmsDb(high()), 0);
  });

  it("with Low off, the high crossover alone splits two bands", () => {
    const p = { lowOn: 0, xHigh: 5000, hAboveT: -30, hAboveR: 20 };
    expect(peakDb(run(p, sine(1000, -12, 1)))).toBeCloseTo(-12, 0);
    expect(peakDb(run(p, sine(9000, -12, 1)))).toBeLessThan(-25);
  });
});

describe("multiband dynamics: timing and sidechain", () => {
  it("Time scales the attack", () => {
    // 5 ms into a loud tone with a 20 ms attack, less has happened when
    // Time is 400%.
    const at = (time: number) => {
      const out = run({ ...single, mAboveT: -30, mAboveR: 50, mAttack: 0.02, time }, sine(1000, -6, 0.2));
      return 20 * Math.log10(out.subarray(240, 480).reduce((p, v) => Math.max(p, Math.abs(v)), 0));
    };
    expect(at(4)).toBeGreaterThan(at(1) + 2);
  });

  it("the sidechain Mix blends the key with its own input", () => {
    const quiet = sine(1000, -30);
    const loud = sine(1000, -3);
    const p = { ...single, mAboveT: -20, mAboveR: 10, mRelease: 0.3 };
    expect(peakDb(run(p, quiet, loud, true))).toBeLessThan(-40);
    expect(peakDb(run({ ...p, scMix: 0 }, quiet, loud, true))).toBeCloseTo(-30, 1);
  });
});
