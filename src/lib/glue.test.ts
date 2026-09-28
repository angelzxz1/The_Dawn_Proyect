import { describe, expect, it } from "vitest";
import { defaultParams } from "./effects";
import { GLUE_AUTO_RELEASE, GLUE_OS_LATENCY, GLUE_SOURCE, glueSettingsFromParams, type GlueSettings } from "./glueModel";

const SR = 48000;
type Buf = Float32Array | null;
interface Kernel {
  set(s: GlueSettings): void;
  process(inL: Buf, inR: Buf, keyL: Buf, keyR: Buf, outL: Float32Array, outR: Float32Array | null, n: number): void;
  takeMeters(): { gainReduction: number; output: number; clipping: boolean };
  fast: number;
  slow: number;
  auto: boolean;
}
const Glue = new Function(`${GLUE_SOURCE}; return GlueKernel;`)() as new (sr: number) => Kernel;

const sine = (f: number, db: number, seconds = 0.5) =>
  new Float32Array(Math.round(seconds * SR)).map((_, i) => Math.pow(10, db / 20) * Math.sin((2 * Math.PI * f * i) / SR));
const peakDb = (d: Float32Array, from = 0.5) => 20 * Math.log10(d.subarray(Math.floor(d.length * from)).reduce((p, v) => Math.max(p, Math.abs(v)), 0) + 1e-12);

function make(params: Record<string, number>, external = false) {
  const k = new Glue(SR);
  k.set(glueSettingsFromParams({ ...defaultParams("glue"), ...params }, external));
  return k;
}
function run(k: Kernel, input: Float32Array, key: Buf = null): Float32Array {
  const out = new Float32Array(input.length);
  for (let i = 0; i < input.length; i += 128) {
    const n = Math.min(128, input.length - i);
    k.process(input.subarray(i, i + n), null, key ? key.subarray(i, i + n) : null, null, out.subarray(i, i + n), null, n);
  }
  return out;
}
const gr = (k: Kernel) => (k.auto ? Math.max(k.fast, k.slow) : k.fast);

describe("glue compressor", () => {
  it("compresses by the ratio above the threshold", () => {
    // -6 dB peaks, -20 threshold, 4:1: 14 dB over -> 3.5 dB over.
    expect(peakDb(run(make({ threshold: -20, ratio: 1, release: 2 }), sine(1000, -6)))).toBeCloseTo(-16.5, 0);
    expect(peakDb(run(make({ threshold: -20, ratio: 2, release: 2 }), sine(1000, -6)))).toBeCloseTo(-18.6, 0);
    // Below the threshold, untouched.
    expect(peakDb(run(make({ threshold: -20 }), sine(1000, -30)))).toBeCloseTo(-30, 2);
  });

  it("the knee narrows as the ratio goes up", () => {
    // Right at the threshold, a soft knee is already compressing a little.
    const at = (ratio: number) => -20 - peakDb(run(make({ threshold: -20, ratio, release: 2 }), sine(1000, -20)));
    expect(at(0)).toBeGreaterThan(at(2));
    expect(at(2)).toBeGreaterThan(0);
  });

  it("Range caps the gain reduction", () => {
    expect(peakDb(run(make({ threshold: -40, ratio: 2, range: -6, release: 2 }), sine(1000, -6)))).toBeCloseTo(-12, 1);
    expect(peakDb(run(make({ threshold: -40, ratio: 2, range: 0 }), sine(1000, -6)))).toBeCloseTo(-6, 2);
  });

  it("Auto release lets go of transients fast but holds sustained compression", () => {
    const bed = sine(200, -30, 1);
    const hit = (burstSeconds: number) => {
      const x = new Float32Array(Math.round(SR * (burstSeconds + 1)));
      x.set(sine(200, -2, burstSeconds));
      x.set(bed, Math.round(burstSeconds * SR));
      return x;
    };
    const grAfter = (release: number, burst: number, after: number) => {
      const k = make({ threshold: -20, ratio: 1, attack: 0, release });
      const x = hit(burst);
      run(k, x.subarray(0, Math.round((burst + after) * SR)));
      return gr(k);
    };
    // 150 ms after a 20 ms hit, Auto has let go more than a 1.2 s release.
    expect(grAfter(GLUE_AUTO_RELEASE, 0.02, 0.15)).toBeLessThan(grAfter(5, 0.02, 0.15) * 0.5);
    // 300 ms after 2 s of heavy compression, Auto still holds more than a
    // 0.2 s release.
    expect(grAfter(GLUE_AUTO_RELEASE, 2, 0.3)).toBeGreaterThan(grAfter(1, 2, 0.3) * 2);
  });

  it("Soft Clip never goes past -0.5 dB", () => {
    const k = make({ threshold: 0, makeup: 20, softClip: 1 });
    expect(peakDb(run(k, sine(100, -3)))).toBeLessThanOrEqual(-0.5 + 1e-9);
    expect(k.takeMeters().clipping).toBe(true);
    // Quiet audio passes it untouched.
    expect(peakDb(run(make({ threshold: 0, softClip: 1 }), sine(100, -12)))).toBeCloseTo(-12, 3);
  });

  it("oversampling keeps the level and adds 15 samples of latency", () => {
    const settings = { threshold: -20, ratio: 1, release: 2 };
    const plain = peakDb(run(make(settings), sine(1000, -6)));
    expect(peakDb(run(make({ ...settings, oversample: 1 }), sine(1000, -6)))).toBeCloseTo(plain, 0);
    const impulse = new Float32Array(256);
    impulse[10] = 0.01;
    const out = run(make({ threshold: 0, oversample: 1 }), impulse);
    const at = out.reduce((best, v, i) => (Math.abs(v) > Math.abs(out[best]) ? i : best), 0);
    expect(at - 10).toBe(GLUE_OS_LATENCY);
    // (A click loses a little height to the band-limiting.)
    expect(out[at]).toBeCloseTo(0.01, 2);
  });

  it("sidechain Mix blends the key with its own input", () => {
    const quiet = sine(1000, -30);
    const loudKey = sine(60, -3);
    // All key: the loud sidechain compresses the quiet input.
    expect(peakDb(run(make({ threshold: -20, ratio: 2, release: 2 }, true), quiet, loudKey))).toBeLessThan(-40);
    // All own input: the key is ignored.
    expect(peakDb(run(make({ threshold: -20, ratio: 2, release: 2, scMix: 0 }, true), quiet, loudKey))).toBeCloseTo(-30, 2);
  });

  it("Dry/Wet at 0 is untouched", () => {
    expect(peakDb(run(make({ threshold: -40, ratio: 2, dryWet: 0 }), sine(1000, -6)))).toBeCloseTo(-6, 3);
  });
});
