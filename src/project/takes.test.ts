import { describe, expect, it } from "vitest";
import { compFrom, compSpans, mergedMidiTake, midiPassTakes, recordTakes, recordingPasses, removeTake } from "./takes";
import type { AudioClipInstance, ClipInstance, MidiClipInstance, NoteEvent, TakeLane } from "./types";

function ids(prefix = "n") {
  let n = 0;
  return () => `${prefix}${++n}`;
}

const audio = (id: string, offset: number, length: number, sourceOffset = 0): AudioClipInstance => ({
  id,
  kind: "audio",
  offset,
  length,
  url: `blob:${id}`,
  fileName: `${id}.wav`,
  durationSeconds: 60,
  peaks: [],
  sourceOffset,
  fadeIn: 0,
  fadeOut: 0,
  gainDb: 0,
  loopLength: null,
});

const note = (time: number, duration = 0.5, name = "C4"): NoteEvent => ({ note: name, time, duration, velocity: 0.8 });
const spans = (clips: ClipInstance[]) => clips.map((c) => [c.offset, c.length]);

describe("recordingPasses", () => {
  it("is one pass when not looping, or when started past the loop", () => {
    expect(recordingPasses(2, 5, null)).toEqual([{ start: 2, end: 7, at: 0 }]);
    expect(recordingPasses(9, 5, { start: 4, end: 8 })).toEqual([{ start: 9, end: 14, at: 0 }]);
  });

  it("goes round the loop: the first pass to its end, then a pass each time round", () => {
    // From bar 2 (2 s) with the loop at 4-8 s: 2-8, then 4-8 twice, then 4-5.
    expect(recordingPasses(2, 15, { start: 4, end: 8 })).toEqual([
      { start: 2, end: 8, at: 0 },
      { start: 4, end: 8, at: 6 },
      { start: 4, end: 8, at: 10 },
      { start: 4, end: 5, at: 14 },
    ]);
  });

  it("drops a last pass shorter than asked (stopped just after the loop came round)", () => {
    expect(recordingPasses(4, 8.2, { start: 4, end: 8 }, 0.5)).toEqual([
      { start: 4, end: 8, at: 0 },
      { start: 4, end: 8, at: 4 },
    ]);
  });
});

describe("recordTakes", () => {
  it("one take over nothing is just a new clip", () => {
    const take = audio("t1", 4, 2);
    const result = recordTakes([audio("a", 0, 2)], [], [take], ids(), ids("lane"));
    expect(result.lanes).toEqual([]);
    expect(result.main.map((c) => c.id)).toEqual(["a", "t1"]);
  });

  it("recording over a clip keeps what was there as Take 1; the new one plays", () => {
    const main = [audio("old", 0, 8)];
    const result = recordTakes(main, [], [audio("t1", 2, 4, 0)], ids(), ids("lane"));
    expect(result.lanes.map((l) => l.name)).toEqual(["Take 1", "Take 2"]);
    // Take 1: the old clip over the time recorded.
    expect(spans(result.lanes[0].clips)).toEqual([[2, 4]]);
    expect((result.lanes[0].clips[0] as AudioClipInstance).sourceOffset).toBe(2);
    // The track: the old clip around the new take, which is marked as from Take 2.
    expect(spans(result.main)).toEqual([
      [0, 2],
      [6, 2],
      [2, 4],
    ]);
    expect(result.main[2].take).toBe(result.lanes[1].id);
  });

  it("a loop recording's passes are takes; the track plays the latest at each point", () => {
    const passes = [audio("p1", 4, 4, 0), audio("p2", 4, 4, 4), audio("p3", 4, 2, 8)];
    const result = recordTakes([], [], passes, ids(), ids("lane"));
    expect(result.lanes.map((l) => l.name)).toEqual(["Take 1", "Take 2", "Take 3"]);
    // Pass 3 for 4-6 s, pass 2 for the rest.
    expect(result.main.map((c) => [c.offset, c.length, (c as AudioClipInstance).sourceOffset, c.take])).toEqual([
      [6, 2, 6, "lane2"],
      [4, 2, 8, "lane3"],
    ]);
  });

  it("numbers new takes after the ones a track has", () => {
    const lanes: TakeLane[] = [{ id: "x", name: "Take 4", clips: [] }];
    const result = recordTakes([], lanes, [audio("t", 0, 1)], ids(), ids("lane"));
    expect(result.lanes.map((l) => l.name)).toEqual(["Take 4", "Take 5"]);
  });
});

describe("comping", () => {
  const lanes: TakeLane[] = [
    { id: "L1", name: "Take 1", clips: [audio("a", 0, 8, 0)] },
    { id: "L2", name: "Take 2", clips: [audio("b", 0, 8, 10)] },
  ];

  it("puts a take's part in over what's there, remembering where it came from", () => {
    const main = [{ ...audio("c", 0, 8, 10), take: "L2" }];
    const next = compFrom(main, lanes[0], { start: 2, end: 4 }, ids());
    expect(next.map((c) => [c.offset, c.length, (c as AudioClipInstance).sourceOffset, c.take])).toEqual([
      [0, 2, 10, "L2"],
      [4, 4, 14, "L2"],
      [2, 2, 2, "L1"],
    ]);
    expect(compSpans(next, "L1")).toEqual([{ start: 2, end: 4 }]);
  });

  it("silence where the take has none", () => {
    const sparse: TakeLane = { id: "L3", name: "Take 3", clips: [audio("s", 0, 1)] };
    const next = compFrom([audio("c", 0, 8)], sparse, { start: 0, end: 4 }, ids());
    expect(spans(next)).toEqual([
      [4, 4],
      [0, 1],
    ]);
  });

  it("deleting a take keeps what the comp has from it, unmarked", () => {
    const main = [{ ...audio("c", 0, 8), take: "L1" }];
    const next = removeTake(main, lanes, "L1");
    expect(next.lanes.map((l) => l.id)).toEqual(["L2"]);
    expect(next.main[0].take).toBeUndefined();
  });
});

describe("MIDI passes", () => {
  const passes = [
    { start: 2, end: 6, at: 0 },
    { start: 4, end: 6, at: 4 },
  ];

  it("each pass's notes from its start, a held note cut at the pass's end; an empty pass makes none", () => {
    const takes = midiPassTakes([note(0.5), note(3.5, 1), note(4.5)], passes, ids());
    expect(takes.map((t) => [t.offset, t.length, t.notes.map((n) => [n.time, n.duration])])).toEqual([
      [2, 4, [[0.5, 0.5], [3.5, 0.5]]],
      [4, 2, [[0.5, 0.5]]],
    ]);
    expect(midiPassTakes([note(0.5)], passes, ids())).toHaveLength(1);
  });

  it("overdub: every pass's notes in one clip, where they were played", () => {
    const merged = mergedMidiTake([note(0.5), note(4.5, 0.25)], passes, ids()) as MidiClipInstance;
    expect([merged.offset, merged.length]).toEqual([2, 4]);
    // 0.5 s into the first pass (2.5 s), and 0.5 s into the second (4.5 s).
    expect(merged.notes.map((n) => [n.time, n.duration])).toEqual([
      [0.5, 0.5],
      [2.5, 0.25],
    ]);
  });
});
