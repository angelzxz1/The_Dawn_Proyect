import { describe, expect, it } from "vitest";
import {
  convolverChannels,
  cutFiltersDb,
  effectiveHighCut,
  effectiveLowCut,
  irNormalizationGain,
  irResponseDb,
} from "./irModel";

const FREQS = [50, 100, 1000, 5000, 15000];

describe("IR normalization", () => {
  it("leaves a unit impulse alone", () => {
    const ir = new Float32Array(256);
    ir[0] = 1;
    expect(irNormalizationGain([ir])).toBeCloseTo(1, 6);
  });

  it("brings any IR to unit energy, averaged over channels", () => {
    const left = new Float32Array([0.5, 0.5, 0.5, 0.5]); // energy 1
    const right = new Float32Array([2, 0, 0, 0]); // energy 4
    const gain = irNormalizationGain([left, right]);
    expect(((1 + 4) / 2) * gain * gain).toBeCloseTo(1, 6);
  });

  it("doesn't blow up on a silent IR", () => {
    expect(irNormalizationGain([new Float32Array(64)])).toBe(1);
  });
});

describe("convolver channel layout", () => {
  it("keeps mono, stereo and true-stereo IRs, trims anything else to two channels", () => {
    expect(convolverChannels([1]).length).toBe(1);
    expect(convolverChannels([1, 2]).length).toBe(2);
    expect(convolverChannels([1, 2, 3, 4]).length).toBe(4);
    expect(convolverChannels([1, 2, 3])).toEqual([1, 2]);
    expect(convolverChannels([1, 2, 3, 4, 5, 6])).toEqual([1, 2]);
  });
});

describe("IR frequency response", () => {
  it("is flat at 0 dB for a unit impulse", () => {
    const ir = new Float32Array(1024);
    ir[0] = 1;
    irResponseDb([ir], 48000, FREQS).forEach((db) => expect(db).toBeCloseTo(0, 3));
  });

  it("applies the display gain", () => {
    const ir = new Float32Array(1024);
    ir[0] = 1;
    irResponseDb([ir], 48000, FREQS, 0.5).forEach((db) => expect(db).toBeCloseTo(-6.02, 1));
  });

  it("shows a lowpass IR rolling off", () => {
    // A one-pole lowpass at ~1 kHz.
    const ir = new Float32Array(8192);
    const a = Math.exp((-2 * Math.PI * 1000) / 48000);
    for (let i = 0; i < ir.length; i++) ir[i] = (1 - a) * Math.pow(a, i);
    const [lo, , , , hi] = irResponseDb([ir], 48000, FREQS);
    expect(lo).toBeGreaterThan(-0.5);
    expect(hi).toBeLessThan(-20);
  });
});

describe("low/high cut", () => {
  it("is out of the way at the Off settings", () => {
    expect(effectiveLowCut(20)).toBeLessThan(20);
    expect(effectiveHighCut(20000, 44100)).toBe(22050);
    FREQS.forEach((f) => expect(Math.abs(cutFiltersDb(f, 20, 20000, 48000))).toBeLessThan(0.05));
  });

  it("is 3 dB down at each corner", () => {
    expect(cutFiltersDb(100, 100, 20000, 48000)).toBeCloseTo(-3.01, 1);
    expect(cutFiltersDb(5000, 20, 5000, 48000)).toBeCloseTo(-3.01, 1);
  });
});
