import { describe, expect, it } from "vitest";
import { AMP_SOURCE, type AmpSettings } from "./ampKernel";
import { AMP_MODES, ampSettingsFromParams, ampToneCurve } from "./ampModel";
import { paramSpecs } from "./effects";
import { findPreset } from "./presets";

const SR = 48000;
const Kernel = new Function(`${AMP_SOURCE}; return AmpKernel;`)() as new (sr: number) => {
  set(s: AmpSettings): void;
  process(input: Float32Array | null, output: Float32Array, n: number): void;
};
const defaults = () => Object.fromEntries(paramSpecs("tubeAmp").map((s) => [s.key, s.default]));
function rms(params: Record<string, number>, input: Float32Array) {
  const k = new Kernel(SR);
  k.set(ampSettingsFromParams(params));
  const out = new Float32Array(input.length);
  for (let i = 0; i < input.length; i += 128) k.process(input.subarray(i, i + 128), out.subarray(i, i + 128), Math.min(128, input.length - i));
  let s = 0;
  for (let i = input.length / 2; i < input.length; i++) s += out[i] * out[i];
  return 10 * Math.log10(s / (input.length / 2));
}
const chord = new Float32Array(SR / 2).map((_, i) => 0.05 * [82.4, 123.5, 164.8].reduce((a, f) => a + Math.sin((2 * Math.PI * f * i) / SR), 0));

describe("Furnace params", () => {
  it("every mode gives the kernel a consistent voicing", () => {
    AMP_MODES.forEach((_, mode) => {
      const s = ampSettingsFromParams({ ...defaults(), mode });
      const n = s.stageGains.length;
      expect(n).toBeGreaterThanOrEqual(3);
      [s.shelfHz, s.shelfKeep, s.couplingHz, s.millerHz].forEach((a) => expect(a).toHaveLength(n));
    });
  });

  it("maps the 0-10 knobs to positions and the rectifier to sag", () => {
    const s = ampSettingsFromParams({ ...defaults(), gain: 10, bass: 0, master: 5 });
    expect(s.gain).toBe(1);
    expect(s.bass).toBe(0);
    expect(s.master).toBe(0.5);
    expect(ampSettingsFromParams({ rectifier: 0 }).sag).toBeGreaterThan(ampSettingsFromParams({ rectifier: 1 }).sag);
  });

  it("the tone curve follows the knobs", () => {
    const at = (p: Record<string, number>, f: number) => ampToneCurve({ ...defaults(), ...p }, [f])[0];
    expect(at({ bass: 10 }, 80)).toBeGreaterThan(at({ bass: 0 }, 80) + 3);
    expect(at({ mid: 10 }, 600)).toBeGreaterThan(at({ mid: 0 }, 600) + 3);
    expect(at({ presence: 10 }, 5000)).toBeGreaterThan(at({ presence: 0 }, 5000) + 3);
  });

  it("the modes and presets stay within a sensible level of each other", () => {
    const base = rms(defaults(), chord);
    expect(Number.isFinite(base)).toBe(true);
    for (const mode of [0, 1]) expect(Math.abs(rms({ ...defaults(), mode }, chord) - base)).toBeLessThan(8);
    for (const id of ["modern-lead", "vintage-crunch", "raw-edge"]) {
      const preset = findPreset(`factory:tubeAmp:${id}`);
      expect(preset).toBeTruthy();
      expect(Math.abs(rms({ ...defaults(), ...preset!.params }, chord) - base)).toBeLessThan(10);
    }
  });
});
