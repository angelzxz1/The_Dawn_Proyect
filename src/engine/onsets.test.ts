import { describe, expect, it } from "vitest";
import { detectOnsets } from "./onsets";

const SR = 48000;

/** Decaying blips at `times` (s), over `seconds`. */
function hits(times: number[], seconds: number, levels: number[] = []): Float32Array {
  const x = new Float32Array(Math.round(seconds * SR));
  times.forEach((t, n) => {
    const start = Math.round(t * SR);
    for (let i = 0; i < 0.12 * SR && start + i < x.length; i++) x[start + i] += (levels[n] ?? 0.6) * Math.sin((2 * Math.PI * 800 * i) / SR) * Math.exp(-i / (0.02 * SR));
  });
  return x;
}

describe("detectOnsets", () => {
  it("finds each hit to a few milliseconds, uneven ones too", () => {
    const times = [0.1, 0.53, 0.97, 1.55, 2.02, 2.4];
    const found = detectOnsets([hits(times, 3)], SR);
    expect(found).toHaveLength(times.length);
    found.forEach((t, i) => expect(Math.abs(t - times[i])).toBeLessThan(0.004));
  });

  it("finds quiet hits among loud ones, on every channel together", () => {
    const times = [0.2, 0.7, 1.2, 1.7];
    const x = hits(times, 2.2, [0.8, 0.2, 0.8, 0.2]);
    expect(detectOnsets([x, x], SR)).toHaveLength(4);
  });

  it("finds nothing in silence or a steady tone", () => {
    expect(detectOnsets([new Float32Array(SR)], SR)).toEqual([]);
    const tone = new Float32Array(2 * SR).map((_, i) => Math.sin((2 * Math.PI * 220 * i) / SR) * 0.3);
    // The tone's start is one onset; nothing after.
    expect(detectOnsets([tone], SR).length).toBeLessThanOrEqual(1);
  });
});
