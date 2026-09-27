import { describe, expect, it } from "vitest";
import { WAVE_BUCKET, WaveformBuilder, waveformFromChannels, waveformFromPeaks, waveformSpan } from "./waveform";

describe("waveform", () => {
  const sr = 48000;
  // 0.1 s of silence, then a 0.5-amplitude sine, then silence.
  const data = new Float32Array(sr).map((_, i) => (i >= 4800 && i < 9600 ? 0.5 * Math.sin(i / 7) : 0));

  it("keeps each bucket's true min and max", () => {
    const wf = waveformFromChannels([data], sr);
    expect(wf.length).toBe(Math.ceil(sr / WAVE_BUCKET));
    const [lo, hi] = waveformSpan(wf, 0.1, 0.2)!;
    expect(hi).toBeCloseTo(0.5, 2);
    expect(lo).toBeCloseTo(-0.5, 2);
    expect(waveformSpan(wf, 0.3, 0.4)).toEqual([0, 0]);
    // Past the end: nothing.
    expect(waveformSpan(wf, 1.5, 1.6)).toBeNull();
  });

  it("uses the loudest channel", () => {
    const quiet = new Float32Array(sr);
    const [, hi] = waveformSpan(waveformFromChannels([quiet, data], sr), 0.1, 0.2)!;
    expect(hi).toBeCloseTo(0.5, 2);
  });

  it("a growing waveform matches one computed at once", () => {
    const b = new WaveformBuilder(sr);
    for (let i = 0; i < data.length; i += 1000) b.add(i, data.subarray(i, i + 1000));
    const whole = waveformFromChannels([data], sr);
    expect(b.waveform.length).toBe(whole.length);
    expect(Array.from(b.waveform.max.subarray(0, whole.length))).toEqual(Array.from(whole.max));
    expect(Array.from(b.waveform.min.subarray(0, whole.length))).toEqual(Array.from(whole.min));
    // Samples before the take's start are dropped.
    const early = new WaveformBuilder(sr);
    early.add(-100, new Float32Array(100).fill(1));
    expect(early.waveform.length).toBe(0);
  });

  it("stands in with saved peaks", () => {
    const wf = waveformFromPeaks([0.1, 0.8, 0.2], 3)!;
    expect(waveformSpan(wf, 1, 2)).toEqual([expect.closeTo(-0.8, 5), expect.closeTo(0.8, 5)]);
    expect(waveformFromPeaks([], 3)).toBeNull();
  });
});
