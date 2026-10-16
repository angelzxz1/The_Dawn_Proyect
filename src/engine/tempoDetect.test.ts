import { describe, expect, it } from "vitest";
import { detectTempo } from "./tempoDetect";

const SR = 22050;

/** A beat: a decaying noise burst on every beat (louder on the bar), and
 * quieter hats in between if asked. */
function beat(bpm: number, seconds: number, eighths = false, seed = 1): Float32Array {
  const x = new Float32Array(Math.round(seconds * SR));
  let r = seed;
  const noise = () => {
    r = (r * 16807) % 2147483647;
    return r / 2147483647 - 0.5;
  };
  const hit = (at: number, level: number, decay: number) => {
    const start = Math.round(at * SR);
    for (let i = 0; i < decay * SR * 5 && start + i < x.length; i++) x[start + i] += level * noise() * Math.exp(-i / (decay * SR));
  };
  const spb = 60 / bpm;
  for (let k = 0; k * spb < seconds; k++) {
    hit(k * spb, k % 4 === 0 ? 0.9 : 0.6, 0.03);
    if (eighths) hit(k * spb + spb / 2, 0.25, 0.01);
  }
  return x;
}

describe("detectTempo", () => {
  it.each([90, 100, 120, 128, 140])("finds %i BPM in a plain beat", (bpm) => {
    const found = detectTempo([beat(bpm, 12)], SR);
    expect(found).not.toBeNull();
    expect(Math.abs(found!.bpm - bpm)).toBeLessThan(0.6);
  });

  it("isn't thrown by eighth notes in between, or a stereo file", () => {
    const found = detectTempo([beat(110, 12, true, 3), beat(110, 12, true, 7)], SR);
    expect(Math.abs(found!.bpm - 110)).toBeLessThan(0.6);
  });

  it("finds nothing in steady noise, or in too little", () => {
    let r = 5;
    const noise = new Float32Array(10 * SR).map(() => ((r = (r * 16807) % 2147483647) / 2147483647 - 0.5) * 0.2);
    const tone = new Float32Array(10 * SR).map((_, i) => Math.sin((2 * Math.PI * 220 * i) / SR) * 0.3);
    expect(detectTempo([noise], SR)).toBeNull();
    expect(detectTempo([tone], SR)).toBeNull();
    expect(detectTempo([beat(120, 2)], SR)).toBeNull();
  });
});
