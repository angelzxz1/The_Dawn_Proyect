import { describe, expect, it } from "vitest";
import { GATE_KERNEL_SOURCE, HYSTERESIS_DB, type GateSettings } from "./gateModel";

interface Kernel {
  set(s: GateSettings): void;
  process(
    inL: Float32Array,
    inR: Float32Array | null,
    outL: Float32Array,
    outR: Float32Array | null,
    n: number
  ): { peakIn: number; minGain: number };
  open: boolean;
}

// The exact source the worklet runs.
const Kernel = new Function(`${GATE_KERNEL_SOURCE}; return NoiseGateKernel;`)() as new (sampleRate: number) => Kernel;

const SR = 48000;
const DEFAULTS: GateSettings = { thresholdDb: -40, attack: 0.001, hold: 0.05, release: 0.05, rangeDb: -80 };
const amp = (db: number) => Math.pow(10, db / 20);

function sine(seconds: number, db: number, freq = 220): Float32Array {
  const out = new Float32Array(Math.round(seconds * SR));
  for (let i = 0; i < out.length; i++) out[i] = amp(db) * Math.sin((2 * Math.PI * freq * i) / SR);
  return out;
}

function run(settings: Partial<GateSettings>, ...segments: Float32Array[]) {
  const gate = new Kernel(SR);
  gate.set({ ...DEFAULTS, ...settings });
  const input = new Float32Array(segments.reduce((n, s) => n + s.length, 0));
  let offset = 0;
  segments.forEach((s) => {
    input.set(s, offset);
    offset += s.length;
  });
  const output = new Float32Array(input.length);
  for (let i = 0; i < input.length; i += 128) {
    const n = Math.min(128, input.length - i);
    gate.process(input.subarray(i, i + n), null, output.subarray(i, i + n), null, n);
  }
  return { input, output, gate };
}

function peakDb(data: Float32Array, fromS: number, toS: number): number {
  let p = 0;
  for (let i = Math.floor(fromS * SR); i < Math.min(data.length, Math.floor(toS * SR)); i++) p = Math.max(p, Math.abs(data[i]));
  return 20 * Math.log10(p + 1e-12);
}

describe("noise gate", () => {
  it("passes a signal above the threshold unchanged", () => {
    const { output } = run({}, sine(0.5, -20));
    expect(peakDb(output, 0.1, 0.5)).toBeCloseTo(-20, 1);
  });

  it("silences noise below the threshold", () => {
    const { output } = run({}, sine(0.5, -55));
    expect(peakDb(output, 0.1, 0.5)).toBeLessThan(-120);
  });

  it("turns down by Range instead of silencing when Range is set", () => {
    const { output } = run({ rangeDb: -20 }, sine(0.5, -55));
    expect(peakDb(output, 0.2, 0.5)).toBeCloseTo(-75, 0);
  });

  it("holds, then releases after the signal drops", () => {
    // Loud for 0.3 s, then quiet noise under the threshold.
    const { output } = run({ hold: 0.1, release: 0.02 }, sine(0.3, -20), sine(0.5, -60));
    // Inside the hold window the quiet part still passes...
    expect(peakDb(output, 0.33, 0.38)).toBeCloseTo(-60, 0);
    // ...and well after hold + release it's gone.
    expect(peakDb(output, 0.6, 0.8)).toBeLessThan(-100);
  });

  it("doesn't chatter for a level between the close and open thresholds", () => {
    // Opens on a loud note, then sits 2 dB under the threshold - inside the
    // hysteresis band - so it stays open.
    expect(HYSTERESIS_DB).toBeGreaterThan(2);
    const { output, gate } = run({}, sine(0.2, -20), sine(0.5, -42));
    expect(gate.open).toBe(true);
    expect(peakDb(output, 0.4, 0.7)).toBeCloseTo(-42, 0);
  });

  it("opens quickly on a new note (Attack)", () => {
    const { output } = run({ attack: 0.001 }, sine(0.2, -70), sine(0.2, -10));
    // 5 ms after the note starts it's within 1 dB of full level.
    expect(peakDb(output, 0.205, 0.215)).toBeGreaterThan(-11);
  });

  it("does nothing with Range at 0 dB", () => {
    const { input, output } = run({ rangeDb: 0 }, sine(0.3, -60));
    expect(peakDb(output, 0, 0.3)).toBeCloseTo(peakDb(input, 0, 0.3), 3);
  });
});
