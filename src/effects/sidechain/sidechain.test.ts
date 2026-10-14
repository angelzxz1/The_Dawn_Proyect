import { describe, expect, it } from "vitest";
import { COMPRESSOR_SOURCE, compressorSettingsFromParams, type CompressorSettings } from "../compressor/compressorModel";
import { compressorTransfer } from "../compressor/compressorCurve";
import { defaultParams } from "../registry";
import { GATE_KERNEL_SOURCE, type GateKernelSettings } from "../gate/gateModel";
import { MB_SOURCE, mbSettingsFromParams, type MbSettings } from "../multiband/multibandModel";

const SR = 48000;
type Buf = Float32Array | null;

interface CompKernel {
  set(s: CompressorSettings): void;
  process(inL: Buf, inR: Buf, keyL: Buf, keyR: Buf, outL: Float32Array, outR: Float32Array | null, n: number): void;
}
interface GateKernel {
  set(s: GateKernelSettings): void;
  process(inL: Buf, inR: Buf, outL: Float32Array, outR: Float32Array | null, n: number, keyL: Buf, keyR: Buf): unknown;
}
interface MbKernel {
  set(s: MbSettings): void;
  process(inL: Buf, inR: Buf, outL: Float32Array, outR: Float32Array | null, n: number, keyL: Buf, keyR: Buf): void;
}
const Comp = new Function(`${COMPRESSOR_SOURCE}; return CompressorKernel;`)() as new (sr: number) => CompKernel;
const Gate = new Function(`${GATE_KERNEL_SOURCE}; return NoiseGateKernel;`)() as new (sr: number) => GateKernel;
const Mb = new Function(`${MB_SOURCE}; return MultibandKernel;`)() as new (sr: number) => MbKernel;

const N = SR / 2;
const sine = (f: number, db: number) => new Float32Array(N).map((_, i) => Math.pow(10, db / 20) * Math.sin((2 * Math.PI * f * i) / SR));
const silence = () => new Float32Array(N);
/** Peak level (dB) over the last half. */
const peakDb = (d: Float32Array) => 20 * Math.log10(d.subarray(N / 2).reduce((p, v) => Math.max(p, Math.abs(v)), 0) + 1e-12);

/** Runs `input` (mono, on both sides) through a kernel's process in
 * 128-frame blocks, with `key` on the sidechain (null: not connected). */
function block(run: (i: number, n: number, out: Float32Array) => void): Float32Array {
  const out = new Float32Array(N);
  for (let i = 0; i < N; i += 128) run(i, Math.min(128, N - i), out.subarray(i, i + 128));
  return out;
}
const sub = (b: Buf, i: number, n: number) => (b ? b.subarray(i, i + n) : null);

function comp(params: Record<string, number>, external: boolean, input: Float32Array, key: Buf): Float32Array {
  const k = new Comp(SR);
  k.set(compressorSettingsFromParams({ ...defaultParams("compressor"), makeupAuto: 0, makeup: 0, ...params }, external));
  return block((i, n, out) => k.process(input.subarray(i, i + n), null, sub(key, i, n), null, out, null, n));
}

describe("compressor", () => {
  it("follows its transfer curve on a steady tone", () => {
    for (const [threshold, ratio, knee] of [
      [-24, 4, 0],
      [-30, 2, 6],
      [-12, 10, 12],
    ]) {
      const out = comp({ threshold, ratio, knee }, false, sine(1000, -6), null);
      expect(peakDb(out)).toBeCloseTo(compressorTransfer(-6, threshold, ratio, knee), 0);
    }
    // Below the threshold: untouched.
    expect(peakDb(comp({ threshold: -24 }, false, sine(1000, -40), null))).toBeCloseTo(-40, 2);
  });

  it("ducks from the sidechain, not its own input", () => {
    const quiet = sine(200, -30);
    // Its own input is under the threshold; a loud key pulls it down by
    // what the key's level calls for (-24 dB, 4:1, key at 0 dB: 18 dB).
    const keyed = comp({ threshold: -24, ratio: 4, knee: 0 }, true, quiet, sine(60, 0));
    expect(peakDb(keyed)).toBeCloseTo(-48, 0);
    // A silent or unconnected key leaves it alone - even a loud input.
    expect(peakDb(comp({ threshold: -24 }, true, sine(200, -6), silence()))).toBeCloseTo(-6, 2);
    expect(peakDb(comp({ threshold: -24 }, true, sine(200, -6), null))).toBeCloseTo(-6, 2);
  });

  it("filters and scales the key", () => {
    const input = sine(1000, -30);
    const settings = { threshold: -24, ratio: 4, knee: 0, scHpf: 1000 };
    // A 60 Hz key through a 1 kHz low cut barely registers...
    expect(peakDb(comp(settings, true, input, sine(60, -6)))).toBeGreaterThan(-31);
    // ...a 5 kHz one passes.
    expect(peakDb(comp(settings, true, input, sine(5000, -6)))).toBeLessThan(-40);
    // Sidechain gain moves the key's level: -30 dB + 12 dB is 6 dB over
    // -24, so at 4:1 it takes 4.5 dB off.
    expect(peakDb(comp({ threshold: -24, knee: 0 }, true, input, sine(1000, -30)))).toBeCloseTo(-30, 1);
    expect(peakDb(comp({ threshold: -24, knee: 0, scGain: 12 }, true, input, sine(1000, -30)))).toBeCloseTo(-34.5, 0);
  });

  it("Listen outputs what the detector hears", () => {
    const out = comp({ scListen: 1, scLpf: 500 }, true, sine(1000, -10), sine(5000, -6));
    // The 5 kHz key through a 500 Hz high cut (12 dB/oct, ~3.3 octaves).
    expect(peakDb(out)).toBeLessThan(-40);
    expect(peakDb(comp({ scListen: 1 }, true, sine(1000, -10), sine(5000, -6)))).toBeCloseTo(-6, 1);
  });

  it("Dry/Wet at 0 is untouched", () => {
    expect(peakDb(comp({ threshold: -40, dryWet: 0 }, false, sine(1000, -6), null))).toBeCloseTo(-6, 3);
  });
});

describe("noise gate sidechain", () => {
  const base: GateKernelSettings = { thresholdDb: -40, attack: 0.001, hold: 0.01, release: 0.02, rangeDb: -80 };
  function gate(settings: Partial<GateKernelSettings>, input: Float32Array, key: Buf) {
    const k = new Gate(SR);
    k.set({ ...base, ...settings });
    return block((i, n, out) => k.process(input.subarray(i, i + n), null, out, null, n, sub(key, i, n), null));
  }

  it("opens on the key, not its own input", () => {
    // A quiet pad keyed by a loud hat opens...
    expect(peakDb(gate({ external: true }, sine(200, -50), sine(8000, -10)))).toBeCloseTo(-50, 1);
    // ...and stays shut with the key silent, however loud the pad is.
    expect(peakDb(gate({ external: true }, sine(200, -6), silence()))).toBeLessThan(-100);
    // Without the sidechain it's its own level that counts.
    expect(peakDb(gate({}, sine(200, -50), sine(8000, -10)))).toBeLessThan(-100);
  });

  it("filters the key", () => {
    // A 100 Hz key through a 2 kHz low cut (-52 dB) stays under -40.
    expect(peakDb(gate({ external: true, scHpf: 2000 }, sine(1000, -20), sine(100, -10)))).toBeLessThan(-100);
  });
});

describe("multiband sidechain", () => {
  const params = { bands: 2, x1: 500, b1Thresh: -30, b1Ratio: 10, b1Knee: 0, b2Thresh: -30, b2Ratio: 10, b2Knee: 0 };
  function mb(input: Float32Array, key: Buf): Float32Array {
    const k = new Mb(SR);
    k.set(mbSettingsFromParams({ ...params }, -1, true));
    return block((i, n, out) => k.process(input.subarray(i, i + n), null, out, null, n, sub(key, i, n), null));
  }

  it("each band reacts to the key's energy in that band", () => {
    const high = sine(4000, -40);
    // A bass key leaves the high band alone...
    expect(peakDb(mb(high, sine(60, -6)))).toBeCloseTo(-40, 0);
    // ...a key in the high band compresses it.
    expect(peakDb(mb(high, sine(4000, -6)))).toBeLessThan(-55);
  });
});
