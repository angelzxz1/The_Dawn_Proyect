import { describe, expect, it } from "vitest";
import { countInBeatsLeft } from "./transport";

describe("the count-in", () => {
  // A bar of four at 120 BPM before a start at 2 s: beats at 0, 0.5, 1, 1.5 s.
  const left = (now: number) => countInBeatsLeft(2, 120, now);

  it("counts the beats left down, the one sounding included", () => {
    expect([0, 0.25, 0.5, 1.2, 1.5, 1.99].map(left)).toEqual([4, 4, 3, 2, 1, 1]);
  });

  it("is over when the transport starts", () => {
    expect(left(2)).toBeNull();
    expect(left(3)).toBeNull();
  });
});
