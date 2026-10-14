import { describe, expect, it } from "vitest";
import { notesWithinClip } from "./project";
import type { MidiClipInstance } from "./types";

const clip = (notes: MidiClipInstance["notes"], over: Partial<MidiClipInstance> = {}): MidiClipInstance => ({
  id: "c",
  kind: "midi",
  offset: 4,
  length: 2,
  notes,
  loopLength: null,
  ...over,
});

describe("notesWithinClip", () => {
  it("plays the notes inside the clip, cut at its end", () => {
    const notes = notesWithinClip(clip([{ note: "C4", time: 1.5, duration: 1, velocity: 0.8 }]));
    expect(notes).toEqual([{ note: "C4", time: 1.5, duration: 0.5, velocity: 0.8 }]);
  });

  it("doesn't play notes slid before the clip's start (the slip tool)", () => {
    const slid = clip([
      { note: "C4", time: -0.5, duration: 1, velocity: 0.8 },
      { note: "E4", time: 0.5, duration: 0.25, velocity: 0.8 },
    ]);
    expect(notesWithinClip(slid).map((n) => n.note)).toEqual(["E4"]);
    expect(notesWithinClip({ ...slid, loopLength: 1, length: 2 }).map((n) => [n.note, n.time])).toEqual([
      ["E4", 0.5],
      ["E4", 1.5],
    ]);
  });
});
