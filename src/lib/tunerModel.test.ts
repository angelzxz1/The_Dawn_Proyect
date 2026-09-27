import { describe, expect, it } from "vitest";
import { detectPitch, fft, noteFor } from "./tunerModel";

const SR = 48000;
const N = 4096;
const cents = (a: number, b: number) => 1200 * Math.log2(a / b);

/** A buffer of `f` with harmonics (amplitude of harmonic k: amps[k-1]). */
function tone(f: number, amps: number[] = [1], level = 0.4): Float32Array {
  return new Float32Array(N).map((_, i) => level * amps.reduce((s, a, k) => s + a * Math.sin((2 * Math.PI * f * (k + 1) * i) / SR + k), 0));
}

describe("fft", () => {
  it("round-trips", () => {
    const re = new Float64Array([1, 2, 3, 4, 0, -1, 0.5, 2]);
    const orig = Array.from(re);
    const im = new Float64Array(8);
    fft(re, im);
    fft(re, im, true);
    re.forEach((v, i) => expect(v / 8).toBeCloseTo(orig[i], 10));
  });
});

describe("pitch detection", () => {
  it.each([
    ["low B (5-string bass)", 30.87],
    ["low E (guitar)", 82.41],
    ["A2", 110],
    ["G3", 196],
    ["A4", 440],
    ["high E (guitar 24th fret)", 1318.5],
  ])("finds %s to within a cent", (_, f) => {
    const r = detectPitch(tone(f), SR)!;
    expect(r).not.toBeNull();
    expect(Math.abs(cents(r.freq, f))).toBeLessThan(1);
    expect(r.clarity).toBeGreaterThan(0.9);
  });

  it("doesn't jump an octave on a bright tone with a weak fundamental", () => {
    // A plucked-string-like spectrum: 2nd and 3rd harmonics louder than the 1st.
    const r = detectPitch(tone(82.41, [0.3, 1, 0.8, 0.5, 0.4, 0.3]), SR)!;
    expect(Math.abs(cents(r.freq, 82.41))).toBeLessThan(2);
  });

  it("ignores silence and noise", () => {
    expect(detectPitch(new Float32Array(N), SR)).toBeNull();
    expect(detectPitch(tone(440, [1], 0.0005), SR)).toBeNull();
    let seed = 1;
    const noise = new Float32Array(N).map(() => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.5);
    expect(detectPitch(noise, SR)).toBeNull();
  });
});

describe("notes", () => {
  it("names the nearest note and how far off it is", () => {
    expect(noteFor(440)).toMatchObject({ name: "A", octave: 4, midi: 69 });
    expect(noteFor(440).cents).toBeCloseTo(0, 6);
    expect(noteFor(445).cents).toBeCloseTo(19.56, 1);
    expect(noteFor(82.41)).toMatchObject({ name: "E", octave: 2 });
    expect(noteFor(277.18, 440, true).name).toBe("Db");
    expect(noteFor(277.18).name).toBe("C#");
    // A different reference moves the target.
    expect(noteFor(432, 432).cents).toBeCloseTo(0, 6);
    expect(noteFor(440, 432).cents).toBeCloseTo(31.77, 1);
  });
});
