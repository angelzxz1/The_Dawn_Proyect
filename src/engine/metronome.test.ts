import { describe, expect, it } from "vitest";
import { METRONOME_KERNEL_SOURCE } from "./metronomeKernel";

type Click = { elapsed: number; beat: number };
type Loop = { start: number; end: number } | null;
interface Kernel {
  command(m: Record<string, unknown>): void;
  render(out: Float32Array, time: number): void;
}
const { clicksAhead, isDownbeat, MetronomeKernel } = new Function(
  `${METRONOME_KERNEL_SOURCE}; return { clicksAhead, isDownbeat, MetronomeKernel };`
)() as {
  clicksAhead: (pos: number, span: number, loop: Loop, inclusive?: boolean) => Click[];
  isDownbeat: (beat: number, beatsPerBar: number) => boolean;
  MetronomeKernel: new (sampleRate: number) => Kernel;
};

describe("metronome clicks", () => {
  it("clicks on whole beats from a position, counting a beat right at the start", () => {
    expect(clicksAhead(4, 2.5, null)).toEqual([
      { elapsed: 0, beat: 4 },
      { elapsed: 1, beat: 5 },
      { elapsed: 2, beat: 6 },
    ]);
    expect(clicksAhead(4, 1, null, false)).toEqual([{ elapsed: 1, beat: 5 }]);
  });

  it("starting mid-beat waits for the next beat", () => {
    expect(clicksAhead(2.5, 2, null)).toEqual([
      { elapsed: 0.5, beat: 3 },
      { elapsed: 1.5, beat: 4 },
    ]);
  });

  it("follows the loop back to its start", () => {
    // Loop over bar 2 (beats 4-8), starting at beat 6.
    expect(clicksAhead(6, 4, { start: 4, end: 8 }).map((c) => c.beat)).toEqual([6, 7, 4, 5, 6]);
    // A loop ending mid-beat jumps back before reaching the next beat.
    expect(clicksAhead(4, 2.9, { start: 4, end: 5.5 })).toEqual([
      { elapsed: 0, beat: 4 },
      { elapsed: 1, beat: 5 },
      { elapsed: 1.5, beat: 4 },
      { elapsed: 2.5, beat: 5 },
    ]);
  });

  it("the count-in runs into negative beats on the same grid", () => {
    expect(clicksAhead(-4, 4, null).map((c) => c.beat)).toEqual([-4, -3, -2, -1, 0]);
  });

  it("accents each bar's first beat by position, not by when play started", () => {
    expect(isDownbeat(0, 4)).toBe(true);
    expect(isDownbeat(6, 4)).toBe(false);
    expect(isDownbeat(8, 4)).toBe(true);
    expect(isDownbeat(-4, 4)).toBe(true);
    expect(isDownbeat(-2, 4)).toBe(false);
    expect(isDownbeat(3, 3)).toBe(true);
  });
});

const SR = 48000;
const BLOCK = 128;

/** Runs the kernel from context time 0 for `seconds`, with `at(time)`
 * sending commands before each block. Returns each click: the frame it
 * starts at (its first sample is silent - the attack starts from zero) and
 * how many times it crosses zero in its first 10 ms (its pitch). */
function run(kernel: Kernel, seconds: number, at: (time: number) => void = () => {}) {
  const total = Math.ceil((seconds * SR) / BLOCK) * BLOCK;
  const audio = new Float32Array(total);
  for (let frame = 0; frame < total; frame += BLOCK) {
    at(frame / SR);
    kernel.render(audio.subarray(frame, frame + BLOCK), frame / SR);
  }
  const clicks: { frame: number; crossings: number }[] = [];
  let quiet = Infinity;
  for (let i = 0; i < total; i++) {
    if (audio[i] !== 0) {
      if (quiet > SR * 0.02) {
        let crossings = 0;
        for (let j = i + 1; j < Math.min(total, i + SR * 0.01); j++) if (Math.sign(audio[j]) !== Math.sign(audio[j - 1])) crossings++;
        clicks.push({ frame: i - 1, crossings });
      }
      quiet = 0;
    } else quiet++;
  }
  return clicks;
}

describe("metronome kernel", () => {
  it("places each click at its exact sample, across block edges", () => {
    const k = new MetronomeKernel(SR);
    k.command({ type: "enabled", enabled: true });
    k.command({ type: "tempo", bpm: 100 });
    k.command({ type: "start", time: 0.25, pos: 0, countInBeats: 0 });
    const onsets = run(k, 2.2);
    // 100 BPM: a beat every 0.6 s - 28800 frames, which isn't a whole number of blocks.
    expect(onsets.map((o) => o.frame)).toEqual([12000, 40800, 69600, 98400]);
  });

  it("accents the first beat of each bar", () => {
    const k = new MetronomeKernel(SR);
    k.command({ type: "enabled", enabled: true });
    k.command({ type: "meter", beatsPerBar: 3 });
    k.command({ type: "start", time: 0, pos: 0, countInBeats: 0 });
    const clicks = run(k, 3.1);
    // The accent is an octave up: about twice the zero crossings.
    expect(clicks.map((c) => c.crossings > 15)).toEqual([true, false, false, true, false, false, true]);
  });

  it("plays the count-in even with the metronome off, and nothing after it", () => {
    const k = new MetronomeKernel(SR);
    k.command({ type: "start", time: 2, pos: 0, countInBeats: 4 });
    const onsets = run(k, 4);
    expect(onsets.map((o) => o.frame)).toEqual([0, 24000, 48000, 72000]);
  });

  it("follows the loop", () => {
    const k = new MetronomeKernel(SR);
    k.command({ type: "enabled", enabled: true });
    k.command({ type: "loop", loop: { start: 0, end: 1.5 } });
    k.command({ type: "start", time: 0, pos: 0, countInBeats: 0 });
    // Beats 0 and 1, then back to 0 at 0.75 s (1.5 beats), and so on.
    expect(run(k, 2).map((o) => o.frame / SR)).toEqual([0, 0.5, 0.75, 1.25, 1.5]);
  });

  it("stops at once, and a resync carries on from the new position", () => {
    const k = new MetronomeKernel(SR);
    k.command({ type: "enabled", enabled: true });
    k.command({ type: "start", time: 0, pos: 0, countInBeats: 0 });
    let done = false;
    const onsets = run(k, 3, (t) => {
      if (!done && t >= 1.01) {
        // Jumped to beat 10.25 at 1.1 s: the next click is beat 11, 0.375 s later.
        k.command({ type: "resync", time: 1.1, pos: 10.25 });
        done = true;
      }
      if (t >= 2.0) k.command({ type: "stop" });
    });
    expect(onsets.map((o) => o.frame / SR)).toEqual([0, 0.5, 1, 1.475, 1.975]);
  });

  it("skips a click whose start arrived more than 5 ms late", () => {
    const k = new MetronomeKernel(SR);
    k.command({ type: "enabled", enabled: true });
    k.command({ type: "start", time: -0.01, pos: 0, countInBeats: 0 });
    expect(run(k, 1.1).map((o) => o.frame)).toEqual([0.49 * SR, 0.99 * SR]);
  });
});
