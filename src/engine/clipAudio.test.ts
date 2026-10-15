import { describe, expect, it } from "vitest";
import { mixClip, renderClips, reverseChannels, reversedSourceOffset } from "./clipAudio";
import type { AudioClipInstance } from "../project/types";

// 10 samples a second keeps the numbers readable.
const RATE = 10;

const clip = (over: Partial<AudioClipInstance> = {}): AudioClipInstance => ({
  id: "a",
  kind: "audio",
  offset: 0,
  length: 1,
  url: "blob:x",
  fileName: "x.wav",
  durationSeconds: 2,
  peaks: [],
  sourceOffset: 0,
  fadeIn: 0,
  fadeOut: 0,
  gainDb: 0,
  loopLength: null,
  ...over,
});

/** A file whose sample i is i / 100 (so where it read from shows). */
const ramp = (frames: number) => Float32Array.from({ length: frames }, (_, i) => i / 100);
const round = (a: Float32Array) => Array.from(a, (v) => Math.round(v * 1000) / 1000);

describe("mixClip", () => {
  it("plays the clip's part of its file where the clip is", () => {
    const out = [new Float32Array(20)];
    mixClip(out, 0, RATE, { clip: clip({ offset: 0.5, length: 0.4, sourceOffset: 0.2 }), channels: [ramp(20)] });
    expect(round(out[0]).slice(4, 10)).toEqual([0, 0.02, 0.03, 0.04, 0.05, 0]);
  });

  it("repeats a looping clip's loop, and applies its gain", () => {
    const out = [new Float32Array(10)];
    mixClip(out, 0, RATE, { clip: clip({ length: 0.8, loopLength: 0.3, gainDb: 20 * Math.log10(2) }), channels: [ramp(20)] });
    expect(round(out[0])).toEqual([0, 0.02, 0.04, 0, 0.02, 0.04, 0, 0.02, 0, 0]);
  });

  it("fades in and out in straight lines", () => {
    const out = [new Float32Array(10)];
    mixClip(out, 0, RATE, { clip: clip({ length: 1, fadeIn: 0.4, fadeOut: 0.2 }), channels: [new Float32Array(20).fill(1)] });
    expect(round(out[0])).toEqual([0, 0.25, 0.5, 0.75, 1, 1, 1, 1, 1, 0.5]);
  });

  it("a mono file plays in both channels of a stereo render", () => {
    const out = [new Float32Array(4), new Float32Array(4)];
    mixClip(out, 0, RATE, { clip: clip({ length: 0.4 }), channels: [new Float32Array(10).fill(0.5)] });
    expect(round(out[1])).toEqual([0.5, 0.5, 0.5, 0.5]);
  });
});

describe("renderClips", () => {
  it("mixes the clips over a span, from its start; stereo when any is", () => {
    const one = { clip: clip({ offset: 1, length: 0.3 }), channels: [new Float32Array(10).fill(0.25)] };
    const two = { clip: clip({ offset: 1.2, length: 0.3 }), channels: [new Float32Array(10).fill(0.5), new Float32Array(10).fill(-0.5)] };
    const [left, right] = renderClips([one, two], { start: 1, end: 1.6 }, RATE);
    expect(round(left)).toEqual([0.25, 0.25, 0.75, 0.5, 0.5, 0]);
    expect(round(right)).toEqual([0.25, 0.25, -0.25, -0.5, -0.5, 0]);
  });
});

describe("reverse", () => {
  it("turns the samples back to front", () => {
    expect(reverseChannels([Float32Array.from([1, 2, 3])]).map((c) => Array.from(c))).toEqual([[3, 2, 1]]);
  });

  it("a reversed file plays what the clip played, back to front", () => {
    // A 10 s file; the clip played 2-5 s, so the reversed file's 5-8 s.
    expect(reversedSourceOffset({ sourceOffset: 2, length: 3, loopLength: null }, 10)).toBe(5);
    // A looping one turns around its loop.
    expect(reversedSourceOffset({ sourceOffset: 2, length: 8, loopLength: 1 }, 10)).toBe(7);
  });
});
