import { describe, expect, it } from "vitest";
import { renderNow } from "./timeStretch";

const SR = 8000;

const sine = (freq: number, seconds: number, amp = 0.5) => {
  const x = new Float32Array(Math.round(seconds * SR));
  for (let i = 0; i < x.length; i++) x[i] = amp * Math.sin((2 * Math.PI * freq * i) / SR);
  return x;
};

/** Upward zero crossings a second, over [from, to) s. */
function pitch(x: Float32Array, from: number, to: number): number {
  let n = 0;
  for (let i = Math.round(from * SR) + 1; i < Math.round(to * SR); i++) if (x[i - 1] < 0 && x[i] >= 0) n++;
  return n / (to - from);
}

function rms(x: Float32Array, from: number, to: number): number {
  let sum = 0;
  const a = Math.round(from * SR);
  const b = Math.round(to * SR);
  for (let i = a; i < b; i++) sum += x[i] * x[i];
  return Math.sqrt(sum / (b - a));
}

describe("renderNow", () => {
  it("copies what plays at the file's own speed, sample for sample", () => {
    const x = sine(220, 1);
    const [y] = renderNow([x], SR, [{ t0: 0, t1: 0.5, s0: 0.25, s1: 0.75 }], SR / 2, "stretch");
    expect(y[0]).toBe(x[SR / 4]);
    expect(y[1000]).toBe(x[SR / 4 + 1000]);
  });

  it("repitches: twice as fast is an octave up", () => {
    const [y] = renderNow([sine(200, 2)], SR, [{ t0: 0, t1: 1, s0: 0, s1: 2 }], SR, "repitch");
    expect(pitch(y, 0.1, 0.9)).toBeCloseTo(400, -1);
  });

  it("stretches: half as fast keeps the pitch and the level", () => {
    const x = sine(200, 1);
    const [y] = renderNow([x], SR, [{ t0: 0, t1: 2, s0: 0, s1: 1 }], 2 * SR, "stretch");
    expect(pitch(y, 0.2, 1.8)).toBeCloseTo(200, -1);
    expect(rms(y, 0.2, 1.8)).toBeCloseTo(rms(x, 0.1, 0.9), 1);
  });

  it("stretches faster too, on every channel, and leaves silence where nothing plays", () => {
    const [l, r] = renderNow([sine(200, 2), sine(300, 2)], SR, [{ t0: 0, t1: 0.5, s0: 0, s1: 1 }], SR, "stretch");
    expect(pitch(l, 0.1, 0.4)).toBeCloseTo(200, -1);
    expect(pitch(r, 0.1, 0.4)).toBeCloseTo(300, -1);
    expect(rms(l, 0.6, 1)).toBe(0);
  });

  it("goes round a loop without blowing up", () => {
    const pieces = [0, 1, 2].map((k) => ({ t0: k * 0.6, t1: (k + 1) * 0.6, s0: 0, s1: 0.5 }));
    const [y] = renderNow([sine(250, 1)], SR, pieces, Math.round(1.8 * SR), "stretch");
    expect(y.every(Number.isFinite)).toBe(true);
    expect(Math.max(...y.map(Math.abs))).toBeLessThan(1);
    expect(pitch(y, 0.1, 1.7)).toBeCloseTo(250, -1);
  });
});
