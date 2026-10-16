import { describe, expect, it } from "vitest";
import {
  beatAtSeconds,
  bpmAtBeat,
  bpmAtSeconds,
  fixedGrid,
  isConstant,
  makeGrid,
  makeTempoMap,
  maxBpm,
  NO_GRID,
  remapSeconds,
  roundUpToBarFrom,
  secondsAtBeat,
} from "./tempoMap";

// 120 bpm for two bars (8 beats = 4 s), then 60 bpm.
const SLOWER = makeTempoMap(120, [{ beat: 8, bpm: 60 }]);

describe("makeTempoMap", () => {
  it("is one stretch at one tempo", () => {
    const map = makeTempoMap(90);
    expect(isConstant(map)).toBe(true);
    expect(map.segments).toEqual([{ beat: 0, seconds: 0, bpm: 90 }]);
  });

  it("sorts the changes and works out where each starts", () => {
    const map = makeTempoMap(120, [
      { beat: 12, bpm: 90 },
      { beat: 8, bpm: 60 },
    ]);
    expect(map.changes).toEqual([
      { beat: 8, bpm: 60 },
      { beat: 12, bpm: 90 },
    ]);
    // 8 beats at 120 = 4 s; then 4 beats at 60 = 4 s more.
    expect(map.segments.map((s) => s.seconds)).toEqual([0, 4, 8]);
  });

  it("leaves out changes at the start, ones that change nothing, and repeats of a beat", () => {
    const map = makeTempoMap(120, [
      { beat: 0, bpm: 100 },
      { beat: 4, bpm: 120 },
      { beat: 8, bpm: 140 },
      { beat: 8, bpm: 150 },
      { beat: 12, bpm: 150 },
    ]);
    expect(map.changes).toEqual([{ beat: 8, bpm: 150 }]);
  });

  it("keeps tempos in range", () => {
    const map = makeTempoMap(1000, [{ beat: 4, bpm: 1 }]);
    expect(map.bpm).toBe(300);
    expect(map.changes[0].bpm).toBe(20);
  });
});

describe("beats and seconds", () => {
  it("follow the changes", () => {
    expect(secondsAtBeat(SLOWER, 4)).toBeCloseTo(2);
    expect(secondsAtBeat(SLOWER, 8)).toBeCloseTo(4);
    expect(secondsAtBeat(SLOWER, 10)).toBeCloseTo(6);
    expect(beatAtSeconds(SLOWER, 6)).toBeCloseTo(10);
    expect(beatAtSeconds(SLOWER, 3)).toBeCloseTo(6);
  });

  it("go on back before the start at the first tempo", () => {
    expect(secondsAtBeat(SLOWER, -2)).toBeCloseTo(-1);
    expect(beatAtSeconds(SLOWER, -1)).toBeCloseTo(-2);
  });

  it("say the tempo anywhere", () => {
    expect(bpmAtSeconds(SLOWER, 3.99)).toBe(120);
    expect(bpmAtSeconds(SLOWER, 4)).toBe(60);
    expect(bpmAtBeat(SLOWER, 9)).toBe(60);
    expect(maxBpm(SLOWER)).toBe(120);
  });

  it("move a time to the same beat on another map", () => {
    const faster = makeTempoMap(120, [{ beat: 8, bpm: 240 }]);
    // Beat 10: 6 s on the slower map, 4.5 s on the faster one.
    expect(remapSeconds(6, SLOWER, faster)).toBeCloseTo(4.5);
    // Before the change, nothing moves.
    expect(remapSeconds(3, SLOWER, faster)).toBeCloseTo(3);
  });
});

describe("the grid", () => {
  it("snaps to beats on the tempo map", () => {
    const beats = makeGrid(SLOWER, 1);
    expect(beats.snap(0.74)).toBeCloseTo(0.5);
    // After the change a beat is a second long.
    expect(beats.snap(5.4)).toBeCloseTo(5);
    expect(beats.floor(5.9)).toBeCloseTo(5);
    expect(beats.ceil(5.1)).toBeCloseTo(6);
    expect(beats.stepAt(1)).toBeCloseTo(0.5);
    expect(beats.stepAt(5)).toBeCloseTo(1);
  });

  it("counts a time a hair off a line as on it", () => {
    const beats = makeGrid(SLOWER, 1);
    expect(beats.floor(5 - 1e-9)).toBeCloseTo(5);
    expect(beats.ceil(5 + 1e-9)).toBeCloseTo(5);
  });

  it("can start from a beat off the bar", () => {
    const bars = makeGrid(makeTempoMap(60), 4, 1);
    expect(bars.snap(2)).toBe(1);
    expect(bars.snap(4)).toBe(5);
  });

  it("can be fixed seconds, or none", () => {
    expect(fixedGrid(0.5).snap(0.8)).toBeCloseTo(1);
    expect(NO_GRID.snap(0.8)).toBe(0.8);
    expect(NO_GRID.stepAt(3)).toBe(0);
  });
});

describe("roundUpToBarFrom", () => {
  it("runs to the end of the bar, on the tempo map", () => {
    // From the start, 2.5 s is into bar 2 (4 s at 120 bpm): to its end.
    expect(roundUpToBarFrom(SLOWER, 0, 2.5, 4)).toBeCloseTo(4);
    // Bars count from where it starts: from beat 6 (3 s), 2 s on is beat
    // 9 (into the 60 bpm part), inside the bar to beat 10 (6 s).
    expect(roundUpToBarFrom(SLOWER, 3, 2, 4)).toBeCloseTo(3);
    // 4 s on is beat 11: two bars, to beat 14.
    expect(roundUpToBarFrom(SLOWER, 3, 4, 4)).toBeCloseTo(secondsAtBeat(SLOWER, 14) - 3);
    // At least a bar.
    expect(roundUpToBarFrom(SLOWER, 0, 0, 4)).toBeCloseTo(2);
  });
});
