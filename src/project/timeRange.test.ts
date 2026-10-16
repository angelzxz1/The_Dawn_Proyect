import { describe, expect, it } from "vitest";
import { clearRange, clipPart, deleteTime, extractRange, insertTime, placeRange } from "./timeRange";
import type { AudioClipInstance, ClipInstance, MidiClipInstance } from "./types";

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

const audio = (offset: number, length: number, over: Partial<AudioClipInstance> = {}): AudioClipInstance => ({
  id: `a${offset}`,
  kind: "audio",
  offset,
  length,
  url: "blob:take",
  fileName: "take.wav",
  durationSeconds: 20,
  peaks: [],
  sourceOffset: 1,
  fadeIn: 0.5,
  fadeOut: 0.5,
  gainDb: 0,
  loopLength: null,
  ...over,
});

/** Where each clip is: [offset, length]. */
const spans = (clips: ClipInstance[]) => clips.map((c) => [c.offset, c.length]);

describe("clipPart", () => {
  it("takes a MIDI clip's notes in the part, from its start, cutting the last", () => {
    const clip = midi(2, 4, [["C4", 0.5, 1], ["E4", 1.5, 2], ["G4", 3, 0.5]]);
    const part = clipPart(clip, 3, 5, ids()) as MidiClipInstance;
    expect([part.offset, part.length]).toEqual([3, 2]);
    // C4 began before the part: left out. E4 runs past its end: cut.
    expect(part.notes.map((n) => [n.note, n.time, n.duration])).toEqual([
      ["E4", 0.5, 1.5],
    ]);
  });

  it("plays a looping MIDI clip's notes out", () => {
    const clip = midi(0, 4, [["C4", 0, 0.5]], { loopLength: 1 });
    const part = clipPart(clip, 1, 3, ids()) as MidiClipInstance;
    expect(part.notes.map((n) => n.time)).toEqual([0, 1]);
    expect(part.loopLength).toBeNull();
  });

  it("moves an audio clip's start into its file, keeping only the fades of the ends it keeps", () => {
    const clip = audio(2, 4);
    const left = clipPart(clip, 0, 3, ids()) as AudioClipInstance;
    expect([left.offset, left.length, left.sourceOffset, left.fadeIn, left.fadeOut]).toEqual([2, 1, 1, 0.5, 0]);
    const right = clipPart(clip, 3, 10, ids()) as AudioClipInstance;
    expect([right.offset, right.length, right.sourceOffset, right.fadeIn, right.fadeOut]).toEqual([3, 3, 2, 0, 0.5]);
  });

  it("lets a looping audio clip's part loop on when it starts where a repeat does", () => {
    const clip = audio(0, 8, { loopLength: 2 });
    const onRepeat = clipPart(clip, 4, 8, ids()) as AudioClipInstance;
    expect([onRepeat.sourceOffset, onRepeat.loopLength]).toEqual([1, 2]);
    // Half a second into a repeat: it plays from there, once.
    const inside = clipPart(clip, 4.5, 8, ids()) as AudioClipInstance;
    expect([inside.sourceOffset, inside.loopLength]).toEqual([1.5, null]);
  });

  it("is nothing where the clip isn't", () => {
    expect(clipPart(midi(2, 2), 4, 6, ids())).toBeNull();
    expect(clipPart(midi(2, 2), 0, 2, ids())).toBeNull();
  });
});

describe("clearRange", () => {
  it("cuts clips at the range's edges and drops what's inside", () => {
    const clips = [midi(0, 2), midi(2, 4), audio(8, 2)];
    expect(spans(clearRange(clips, { start: 3, end: 5 }, ids()))).toEqual([
      [0, 2],
      [2, 1],
      [5, 1],
      [8, 2],
    ]);
  });

  it("drops a clip wholly inside, and leaves the list alone when nothing's in it", () => {
    const clips = [midi(2, 1), midi(6, 1)];
    expect(spans(clearRange(clips, { start: 1, end: 4 }, ids()))).toEqual([[6, 1]]);
    expect(clearRange(clips, { start: 3, end: 5 }, ids())).toBe(clips);
  });
});

describe("extract and place", () => {
  it("copies a range from its start, and lays it down over what's there", () => {
    const clips = [midi(0, 4, [["C4", 1, 0.5], ["E4", 3, 0.5]])];
    const content = extractRange(clips, { start: 2, end: 4 }, ids());
    expect(spans(content)).toEqual([[0, 2]]);
    expect((content[0] as MidiClipInstance).notes.map((n) => n.time)).toEqual([1]);

    // Duplicated after itself: the copy sits at 4-6, over nothing.
    const placed = placeRange(clips, content, 4, 2, ids());
    expect(spans(placed)).toEqual([
      [0, 4],
      [4, 2],
    ]);
    // Over the clip's own second half: it's cut back to make room.
    expect(spans(placeRange(clips, content, 1, 2, ids()))).toEqual([
      [0, 1],
      [3, 1],
      [1, 2],
    ]);
  });
});

describe("insert and delete time", () => {
  it("opens a gap, cutting the clip across it and moving later ones", () => {
    const clips = [midi(0, 4), midi(6, 2)];
    expect(spans(insertTime(clips, 2, 3, ids()))).toEqual([
      [0, 2],
      [5, 2],
      [9, 2],
    ]);
    expect(insertTime(clips, 10, 3, ids())).toBe(clips);
  });

  it("takes time out, closing the gap", () => {
    const clips = [midi(0, 4), midi(6, 2)];
    // The first clip's last 2 s were in the range; the second moves 3 s earlier.
    expect(spans(deleteTime(clips, { start: 2, end: 5 }, ids()))).toEqual([
      [0, 2],
      [3, 2],
    ]);
    // A clip across the range's end keeps its part after it, moved up.
    expect(spans(deleteTime([midi(0, 8)], { start: 2, end: 5 }, ids()))).toEqual([
      [0, 2],
      [2, 3],
    ]);
  });
});
