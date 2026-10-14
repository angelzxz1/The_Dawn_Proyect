import { describe, expect, it } from "vitest";
import { mixdown, sameChannels } from "./inputRecorder";

describe("stereo takes", () => {
  it("keeps a take whose sides match as one channel", () => {
    const l = new Float32Array([0.1, -0.2, 0.3]);
    expect(sameChannels([l, Float32Array.from(l)])).toBe(true);
    expect(sameChannels([l])).toBe(true);
  });

  it("keeps a real stereo take as two", () => {
    expect(sameChannels([new Float32Array([0.1, 0.2]), new Float32Array([0.1, 0.25])])).toBe(false);
  });

  it("draws a stereo take from both sides", () => {
    expect([...mixdown([new Float32Array([1, 0]), new Float32Array([0, 1])])]).toEqual([0.5, 0.5]);
    const mono = new Float32Array([0.4]);
    expect(mixdown([mono])).toBe(mono);
  });
});
