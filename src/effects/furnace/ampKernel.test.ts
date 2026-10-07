import { describe, expect, it } from "vitest";
import { AMP_LATENCY, AMP_SOURCE, type AmpSettings } from "./ampKernel";

const SR = 48000;
type Stack = AmpSettings["stack"];
interface Kernel {
  set(s: AmpSettings): void;
  process(input: Float32Array | null, output: Float32Array, n: number): void;
}
const lib = new Function(`${AMP_SOURCE}; return { AmpKernel, stackResponse, fitStack, bilinear3 };`)() as {
  AmpKernel: new (sr: number) => Kernel;
  stackResponse(st: Stack, t: number, l: number, m: number, w: number): [number, number];
  fitStack(st: Stack, t: number, l: number, m: number): { b: number[]; a: number[] };
  bilinear3(b: number[], a: number[], fs: number): { b: number[]; a: number[] };
};

const STACK: Stack = { c1: 250e-12, c2: 20e-9, c3: 20e-9, r1: 250e3, r2: 1e6, r3: 25e3, r4: 56e3 };
const SETTINGS: AmpSettings = {
  gain: 0.6, bass: 0.5, mid: 0.5, treble: 0.5, presence: 0.5, master: 0.5, output: 0,
  stageGains: [20, 20, 8, 5], shelfHz: [300, 300, 300, 300], shelfKeep: [0.5, 0.5, 0.5, 0.5],
  couplingHz: [20, 100, 30, 30], millerHz: [12000, 10000, 9000, 8000], inputHz: 80,
  asymmetry: 2, bias: 0.4, bright: 4, stack: STACK, stackGain: 3, powerDrive: 5,
  presenceHz: 3500, presenceDb: 8, depthHz: 90, depthDb: 3, sag: 0.5, lowHz: 40, highHz: 12000,
};

const dB = (x: number) => 20 * Math.log10(Math.max(x, 1e-12));
const mag = (re: number, im: number) => Math.hypot(re, im);
/** |H(e^jw)| of a digital filter. */
function digitalMag(b: number[], a: number[], f: number, fs: number) {
  const w = (2 * Math.PI * f) / fs;
  let nr = 0, ni = 0, dr = 0, di = 0;
  b.forEach((c, k) => { nr += c * Math.cos(-w * k); ni += c * Math.sin(-w * k); });
  a.forEach((c, k) => { dr += c * Math.cos(-w * k); di += c * Math.sin(-w * k); });
  return mag(nr, ni) / mag(dr, di);
}
/** |H(jw)| of the fitted analog response. */
function analogMag(b: number[], a: number[], f: number) {
  const w = 2 * Math.PI * f;
  const ev = (c: number[]) => {
    let re = 0, im = 0;
    c.forEach((v, k) => { const p = Math.pow(w, k), ph = k % 4; if (ph === 0) re += v * p; else if (ph === 1) im += v * p; else if (ph === 2) re -= v * p; else im -= v * p; });
    return mag(re, im);
  };
  return ev(b) / ev(a);
}
const sine = (f: number, db: number, seconds = 0.4) =>
  new Float32Array(Math.round(seconds * SR)).map((_, i) => Math.pow(10, db / 20) * Math.sin((2 * Math.PI * f * i) / SR));
function run(s: Partial<AmpSettings>, input: Float32Array) {
  const k = new lib.AmpKernel(SR);
  k.set({ ...SETTINGS, ...s });
  const out = new Float32Array(input.length);
  for (let i = 0; i < input.length; i += 128) {
    const n = Math.min(128, input.length - i);
    k.process(input.subarray(i, i + n), out.subarray(i, i + n), n);
  }
  return out;
}
/** Amplitude of frequency f over the second half (Hann-windowed DFT bin). */
function amp(x: Float32Array, f: number) {
  const a = Math.floor(x.length / 2), b = x.length;
  let re = 0, im = 0, ws = 0;
  for (let i = a; i < b; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * (i - a)) / (b - a - 1));
    re += w * x[i] * Math.cos((2 * Math.PI * f * i) / SR); im += w * x[i] * Math.sin((2 * Math.PI * f * i) / SR); ws += w;
  }
  return (2 * Math.hypot(re, im)) / ws;
}

describe("amp tone stack", () => {
  const knobs: [number, number, number][] = [[0.5, 0.5, 0.5], [0.9, 0.1, 0.2], [0.1, 0.9, 0.9], [0.5, 0.05, 0.02]];
  it("the fitted response matches the circuit, in shape and level", () => {
    for (const [t, l, m] of knobs) {
      const fit = lib.fitStack(STACK, t, l, m);
      for (const f of [30, 80, 200, 500, 1000, 2500, 6000, 15000]) {
        const [re, im] = lib.stackResponse(STACK, t, l, m, 2 * Math.PI * f);
        expect(Math.abs(dB(analogMag(fit.b, fit.a, f)) - dB(mag(re, im)))).toBeLessThan(0.1);
      }
    }
  });

  it("the digital filter follows the analog one through the audio band", () => {
    const fs = SR * 4;
    for (const [t, l, m] of knobs) {
      const fit = lib.fitStack(STACK, t, l, m);
      const d = lib.bilinear3(fit.b, fit.a, fs);
      for (const f of [40, 200, 1000, 5000, 12000]) expect(Math.abs(dB(digitalMag(d.b, d.a, f, fs)) - dB(analogMag(fit.b, fit.a, f)))).toBeLessThan(0.3);
    }
  });

  it("bass, mid and treble move the response the right way", () => {
    const at = (t: number, l: number, m: number, f: number) => { const [re, im] = lib.stackResponse(STACK, t, l, m, 2 * Math.PI * f); return dB(mag(re, im)); };
    expect(at(0.5, 0.9, 0.5, 80)).toBeGreaterThan(at(0.5, 0.1, 0.5, 80) + 3);
    expect(at(0.5, 0.5, 0.9, 600)).toBeGreaterThan(at(0.5, 0.5, 0.1, 600) + 3);
    expect(at(0.9, 0.5, 0.5, 5000)).toBeGreaterThan(at(0.1, 0.5, 0.5, 5000) + 3);
  });
});

describe("amp kernel", () => {
  it("more gain, more distortion", () => {
    const thd = (gain: number) => {
      const out = run({ gain }, sine(220, -30));
      const f = amp(out, 220), h = Math.hypot(amp(out, 440), amp(out, 660), amp(out, 880), amp(out, 1100));
      return h / f;
    };
    expect(thd(0.9)).toBeGreaterThan(thd(0.2) * 1.5);
  });

  it("keeps aliasing low on a high note at full gain", () => {
    // 3.1 kHz at full gain: every harmonic above 24 kHz would fold back between them.
    const out = run({ gain: 1 }, sine(3100, -12));
    const fund = amp(out, 3100);
    const folded = Math.max(...[1700, 2500, 4700, 5300, 7900].map((f) => amp(out, f)));
    expect(dB(folded / fund)).toBeLessThan(-40);
  });

  it("is silent on silence, and stays finite on a full-scale burst", () => {
    const silent = run({}, new Float32Array(SR / 4));
    expect(Math.max(...silent.map(Math.abs))).toBeLessThan(1e-6);
    const burst = run({ gain: 1, master: 1 }, sine(110, 0, 0.3));
    expect(burst.every(Number.isFinite)).toBe(true);
  });

  it("reports the oversampling latency", () => {
    expect(AMP_LATENCY).toBe(16);
  });
});
