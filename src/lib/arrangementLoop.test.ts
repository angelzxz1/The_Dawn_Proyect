import { describe, expect, it } from "vitest";
import {
  MIN_LOOP_BEATS,
  defaultLoop,
  formatLength,
  formatPosition,
  loopAround,
  loopsFrom,
  moveLoop,
  normalizeArrangementLoop,
  nudgeLoop,
  parseLength,
  parsePosition,
  setLoopEdge,
} from "./arrangementLoop";

describe("arrangement loop", () => {
  it("writes and reads positions and lengths as bars.beats.sixteenths", () => {
    expect(formatPosition(0, 4)).toBe("1.1.1");
    expect(formatPosition(16 + 1.25, 4)).toBe("5.2.2");
    expect(formatLength(16, 4)).toBe("4.0.0");
    expect(formatLength(2.5, 4)).toBe("0.2.2");
    expect(formatPosition(7, 3)).toBe("3.2.1"); // 3/4
    expect(parsePosition("5.2.2", 4)).toBe(17.25);
    expect(parsePosition("5", 4)).toBe(16);
    expect(parsePosition("0.1.1", 4)).toBeNull();
    expect(parsePosition("x", 4)).toBeNull();
    expect(parseLength("4", 4)).toBe(16);
    expect(parseLength("0.2", 4)).toBe(2);
    expect(parseLength("1.0.2", 4)).toBe(4.5);
    expect(parseLength("0", 4)).toBeNull();
    for (const b of [0, 3.75, 17.25, 40]) expect(parsePosition(formatPosition(b, 4), 4)).toBe(b);
  });

  it("moves, resizes and never collapses", () => {
    const loop = { on: true, start: 4, end: 8 };
    expect(moveLoop(loop, 10)).toEqual({ on: true, start: 10, end: 14 });
    expect(moveLoop(loop, -3)).toEqual({ on: true, start: 0, end: 4 });
    expect(setLoopEdge(loop, "end", 2)).toEqual({ on: true, start: 4, end: 4 + MIN_LOOP_BEATS });
    expect(setLoopEdge(loop, "start", 9)).toEqual({ on: true, start: 8 - MIN_LOOP_BEATS, end: 8 });
  });

  it("nudges like Ableton's selected loop brace", () => {
    const loop = { on: true, start: 4, end: 8 };
    expect(nudgeLoop(loop, "ArrowUp", 1, false)).toMatchObject({ start: 8, end: 12 });
    expect(nudgeLoop(loop, "ArrowDown", 1, false)).toMatchObject({ start: 0, end: 4 });
    expect(nudgeLoop({ ...loop, start: 0, end: 4 }, "ArrowDown", 1, false)).toBeNull();
    expect(nudgeLoop(loop, "ArrowRight", 1, false)).toMatchObject({ start: 5, end: 9 });
    expect(nudgeLoop(loop, "ArrowRight", 1, true)).toMatchObject({ start: 4, end: 9 });
    expect(nudgeLoop(loop, "ArrowLeft", 1, true)).toMatchObject({ start: 4, end: 7 });
    expect(nudgeLoop(loop, "Enter", 1, false)).toBeNull();
  });

  it("loops around a selection", () => {
    expect(loopAround([{ start: 8, end: 12 }, { start: 4, end: 6 }])).toEqual({ start: 4, end: 12 });
    expect(loopAround([])).toBeNull();
  });

  it("plays on past the loop when started after it", () => {
    const loop = { on: true, start: 4, end: 8 };
    expect(loopsFrom(loop, 0)).toBe(true);
    expect(loopsFrom(loop, 6)).toBe(true);
    expect(loopsFrom(loop, 8)).toBe(false);
    expect(loopsFrom({ ...loop, on: false }, 0)).toBe(false);
  });

  it("repairs saved loops", () => {
    expect(normalizeArrangementLoop(undefined, 4)).toEqual(defaultLoop(4));
    expect(normalizeArrangementLoop({ on: true, start: 12, end: 4 })).toEqual({ on: true, start: 4, end: 12 });
    expect(normalizeArrangementLoop({ on: "yes", start: -1, end: 2 })).toEqual({ on: false, start: 0, end: 2 });
    expect(normalizeArrangementLoop({ start: 4, end: 4 }).end).toBe(4 + MIN_LOOP_BEATS);
  });
});
