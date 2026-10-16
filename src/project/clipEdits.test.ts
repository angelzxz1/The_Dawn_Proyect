import { describe, expect, it } from "vitest";
import {
  cleanClipName,
  consolidateMidi,
  normalizeGain,
  presetFades,
  reverseNotes,
  spansOfClips,
  taggedFileName,
} from "./clipEdits";
import type { ClipInstance, MidiClipInstance } from "./types";

function ids() {
  let n = 0;
  return () => `n${++n}`;
}

const midi = (offset: number, length: number, notes: [string, number, number][] = [], over: Partial<MidiClipInstance> = {}): MidiClipInstance => ({
  id: `m${offset}`,
  kind: "midi",
  offset,
  length,
  notes: notes.map(([note, time, duration]) => ({ note, time, duration, velocity: 0.8 })),
  loopLength: null,
  ...over,
});

const timesOf = (notes: { note: string; time: number; duration: number }[]) => notes.map((n) => [n.note, n.time, n.duration]);

describe("clip names", () => {
  it("keeps one trimmed line, at most 80 characters, and nothing for a blank one", () => {
    expect(cleanClipName("  Big \n chorus  ")).toBe("Big chorus");
    expect(cleanClipName("a".repeat(100))).toHaveLength(80);
    expect(cleanClipName(" \t ")).toBeUndefined();
  });

  it("tags a rendered file's name once, or takes the tag off again", () => {
    expect(taggedFileName("take.wav", "consolidated")).toBe("take consolidated.wav");
    expect(taggedFileName("take consolidated.wav", "consolidated")).toBe("take consolidated.wav");
    expect(taggedFileName("take.mp3", "reversed", true)).toBe("take reversed.wav");
    expect(taggedFileName("take reversed.wav", "reversed", true)).toBe("take.wav");
  });
});

describe("reverseNotes", () => {
  it("turns the clip's notes back to front, cutting one that ran past its end", () => {
    const clip = midi(0, 4, [["C4", 0, 1], ["E4", 2.5, 1], ["G4", 3.5, 2]]);
    expect(timesOf(reverseNotes(clip))).toEqual([
      ["G4", 0, 0.5],
      ["E4", 0.5, 1],
      ["C4", 3, 1],
    ]);
  });

  it("turns a looping clip's notes around within its loop, so it loops as before", () => {
    const clip = midi(0, 8, [["C4", 0, 0.5]], { loopLength: 2 });
    expect(timesOf(reverseNotes(clip))).toEqual([["C4", 1.5, 0.5]]);
  });

  it("twice gives the notes back", () => {
    const clip = midi(0, 4, [["C4", 0.25, 1], ["D4", 1, 0.5]]);
    const twice = reverseNotes({ ...clip, notes: reverseNotes(clip) });
    expect(timesOf(twice)).toEqual(timesOf(clip.notes));
  });
});

describe("fades and gain", () => {
  it("a preset fades in and out the same, each at most half the clip", () => {
    // 120 bpm: a beat is 0.5 s, a bar 2 s.
    expect(presetFades("beat", 4, 120, 4)).toEqual({ fadeIn: 0.5, fadeOut: 0.5 });
    expect(presetFades("bar", 3, 120, 4)).toEqual({ fadeIn: 1.5, fadeOut: 1.5 });
    expect(presetFades("declick", 4, 120, 4)).toEqual({ fadeIn: 0.01, fadeOut: 0.01 });
    expect(presetFades("none", 4, 120, 4)).toEqual({ fadeIn: 0, fadeOut: 0 });
  });

  it("normalizing brings the peak to full scale, within the clip gain's range", () => {
    expect(normalizeGain(0.5)).toBeCloseTo(6.02, 2);
    expect(normalizeGain(2)).toBeCloseTo(-6.02, 2);
    expect(normalizeGain(0.001)).toBe(24);
    expect(normalizeGain(0)).toBeNull();
  });
});

describe("consolidate", () => {
  it("joins a MIDI track's clips over the span into one, loops played out, named after the first", () => {
    const clips: ClipInstance[] = [
      midi(0, 2, [["C4", 0, 0.5]], { loopLength: 1, name: "Riff", color: "#112233" }),
      midi(3, 2, [["E4", 0.5, 2]]),
      midi(6, 1, [["G4", 0, 0.5]]),
    ];
    const next = consolidateMidi(clips, { start: 0, end: 5 }, ids());
    expect(next.map((c) => [c.offset, c.length])).toEqual([
      [6, 1],
      [0, 5],
    ]);
    const joined = next[1] as MidiClipInstance;
    expect(joined).toMatchObject({ name: "Riff", color: "#112233", loopLength: null });
    // The loop's two C4s, and the E4 cut at its clip's end.
    expect(timesOf(joined.notes)).toEqual([
      ["C4", 0, 0.5],
      ["C4", 1, 0.5],
      ["E4", 3.5, 1.5],
    ]);
  });

  it("leaves a track with nothing in the span alone", () => {
    const clips = [midi(6, 1)];
    expect(consolidateMidi(clips, { start: 0, end: 4 }, ids())).toBe(clips);
  });

  it("selected clips: on each track, from the first one's start to the last one's end", () => {
    const spans = spansOfClips({ a: [midi(0, 1), midi(4, 2)], b: [midi(1, 1)], c: [midi(9, 1)] }, new Set(["m0", "m4", "m1"]));
    expect([...spans]).toEqual([
      ["a", { start: 0, end: 6 }],
      ["b", { start: 1, end: 2 }],
    ]);
  });
});
