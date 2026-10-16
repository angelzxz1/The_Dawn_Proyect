import { describe, expect, it } from "vitest";
import { makeTempoMap } from "./tempoMap";
import { notesAtBeats, remapMidiClip, retimeProject, sameTempo, secondsForBeats } from "./tempoEdits";
import type { AudioClipInstance, ChannelConfig, MidiClipInstance } from "./types";

const AT_120 = makeTempoMap(120);
// 120 bpm for two bars (4 s), then 60.
const SLOWER = makeTempoMap(120, [{ beat: 8, bpm: 60 }]);

const midi = (offset: number, length: number, notes: [number, number][], over: Partial<MidiClipInstance> = {}): MidiClipInstance => ({
  id: `m${offset}`,
  kind: "midi",
  offset,
  length,
  notes: notes.map(([time, duration]) => ({ note: "C4", time, duration, velocity: 0.8 })),
  loopLength: null,
  ...over,
});

const audio: AudioClipInstance = {
  id: "a1",
  kind: "audio",
  offset: 5,
  length: 2,
  url: "blob:a",
  fileName: "a.wav",
  durationSeconds: 2,
  peaks: [],
  sourceOffset: 0,
  fadeIn: 0,
  fadeOut: 0,
  gainDb: 0,
  loopLength: null,
};

const track = (id: string, type: ChannelConfig["type"], times: number[]): ChannelConfig =>
  ({
    id,
    name: id,
    type,
    volume: 0,
    pan: 0,
    automationLanes: [{ id: `${id}-vol`, target: { kind: "volume" }, points: times.map((time, i) => ({ id: `${id}-p${i}`, time, value: 0 })) }],
  }) as unknown as ChannelConfig;

describe("sameTempo", () => {
  it("compares where the beats fall", () => {
    expect(sameTempo(makeTempoMap(120), makeTempoMap(120))).toBe(true);
    expect(sameTempo(AT_120, SLOWER)).toBe(false);
    expect(sameTempo(SLOWER, makeTempoMap(120, [{ beat: 8, bpm: 60 }]))).toBe(true);
  });
});

describe("secondsForBeats / notesAtBeats", () => {
  it("follow the map from a start", () => {
    // A bar from beat 6 (3 s): 2 beats at 120, 2 at 60.
    expect(secondsForBeats(SLOWER, 3, 4)).toBeCloseTo(3);
    const notes = notesAtBeats([{ note: "C4", time: 1, duration: 2, velocity: 1 }], SLOWER, 3);
    // Beat 7 (3.5 s) to beat 9 (5 s).
    expect(notes[0].time).toBeCloseTo(0.5);
    expect(notes[0].duration).toBeCloseTo(1.5);
  });
});

describe("remapMidiClip", () => {
  it("keeps the box, the notes and the loop on their beats", () => {
    // From beat 6 for a bar at 120: notes on beats 6 and 9.
    const clip = midi(3, 2, [
      [0, 0.5],
      [1.5, 0.5],
    ], { loopLength: 2 });
    const moved = remapMidiClip(clip, AT_120, SLOWER);
    expect(moved.offset).toBeCloseTo(3);
    // To beat 10: 6 s.
    expect(moved.length).toBeCloseTo(3);
    expect(moved.loopLength).toBeCloseTo(3);
    expect(moved.notes[0].time).toBeCloseTo(0);
    expect(moved.notes[0].duration).toBeCloseTo(0.5);
    // Beat 9 is 5 s on the new map, where half a beat lasts a second.
    expect(moved.notes[1].time).toBeCloseTo(2);
    expect(moved.notes[1].duration).toBeCloseTo(1);
  });

  it("is the same clip when nothing in it moves", () => {
    const early = midi(0, 2, [[0.5, 0.5]]);
    expect(remapMidiClip(early, AT_120, SLOWER)).toBe(early);
  });

  it("scales everything for a new starting tempo", () => {
    const clip = midi(2, 2, [[1, 0.5]]);
    const moved = remapMidiClip(clip, AT_120, makeTempoMap(60));
    expect([moved.offset, moved.length, moved.notes[0].time, moved.notes[0].duration]).toEqual([4, 4, 2, 1]);
  });
});

describe("retimeProject", () => {
  const state = {
    channels: [track("keys", "midi", [1, 6]), track("vox", "audio", [1, 6])],
    clipsByChannel: { keys: [midi(5, 1, [[0, 0.5]])], vox: [audio] },
    takesByChannel: { keys: [{ id: "t1", name: "Take 1", clips: [midi(6, 1, [])] }], vox: [{ id: "t2", name: "Take 1", clips: [audio] }] },
  };

  it("moves MIDI, MIDI takes and MIDI tracks' automation; audio stays", () => {
    const next = retimeProject(state, AT_120, SLOWER);
    // Beat 10 (5 s at 120) is 6 s on the new map.
    expect(next.clipsByChannel.keys[0].offset).toBeCloseTo(6);
    expect(next.takesByChannel.keys[0].clips[0].offset).toBeCloseTo(8);
    expect(next.channels[0].automationLanes![0].points.map((p) => p.time)).toEqual([1, expect.closeTo(8)]);
    // The audio track, its clips, takes and automation are untouched.
    expect(next.clipsByChannel.vox).toBe(state.clipsByChannel.vox);
    expect(next.takesByChannel.vox).toBe(state.takesByChannel.vox);
    expect(next.channels[1]).toBe(state.channels[1]);
  });

  it("changes nothing for the same map", () => {
    expect(retimeProject(state, SLOWER, makeTempoMap(120, [{ beat: 8, bpm: 60 }]))).toBe(state);
  });
});
