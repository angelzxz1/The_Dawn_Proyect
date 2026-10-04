import { describe, expect, it } from "vitest";
import { clicksAhead, isDownbeat } from "./metronome";

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
