import { describe, expect, it } from "vitest";
import { makeTempoMap } from "@/project/tempoMap";
import { barStepFor, computeAdaptiveMarks, MAX_PX_PER_SECOND, MIN_PX_PER_SECOND, rowHeightOf, snapUnitFor } from "./layout";
import { clampZoom, fitSpan, scrollKeeping, wheelZoomFactor } from "./zoom";

describe("zooming", () => {
  it("stays in range", () => {
    expect(clampZoom(1)).toBe(MIN_PX_PER_SECOND);
    expect(clampZoom(1e6)).toBe(MAX_PX_PER_SECOND);
    expect(clampZoom(70)).toBe(70);
  });

  it("zooms in for a wheel turned up (or a pinch out), out for down, a notch about a step", () => {
    expect(wheelZoomFactor(-100)).toBeGreaterThan(1.3);
    expect(wheelZoomFactor(100)).toBeLessThan(0.75);
    expect(wheelZoomFactor(100) * wheelZoomFactor(-100)).toBeCloseTo(1);
    // A trackpad's pinch: small and smooth.
    expect(wheelZoomFactor(-2)).toBeCloseTo(1.012, 3);
    // Lines (Firefox) count as about 16 px each.
    expect(wheelZoomFactor(3, 1)).toBeCloseTo(wheelZoomFactor(48));
  });

  it("keeps the time under the pointer where it is", () => {
    // 10 s, 300 px from the view's left, at 140 px/s.
    expect(scrollKeeping(10, 300, 140)).toBe(1100);
    expect(scrollKeeping(1, 300, 140)).toBe(0);
  });

  it("fits a span into the view with a little room either side", () => {
    const fit = fitSpan(10, 30, 1000);
    expect(fit.pxPerSecond).toBeCloseTo((1000 - 80) / 20);
    expect(fit.scrollLeft).toBeCloseTo(10 * fit.pxPerSecond - 40);
    // From the song's start: room after only.
    expect(fitSpan(0, 8, 1000)).toEqual({ pxPerSecond: (1000 - 40) / 8, scrollLeft: 0 });
    // A whole long song zooms right out (no further than the most).
    expect(fitSpan(0, 3600, 1000).pxPerSecond).toBe(MIN_PX_PER_SECOND);
  });
});

describe("zoomed far out", () => {
  const tempo = makeTempoMap(120);

  it("draws every few bars, so they stay apart", () => {
    // A bar is 2 s: at 70 px/s, 140 px - every bar; at 4 px/s, 8 px - every 8th.
    expect(barStepFor(tempo, 70, 4)).toBe(1);
    expect(barStepFor(tempo, 4, 4)).toBe(8);
    const marks = computeAdaptiveMarks(tempo, 64, 4, 4);
    expect(marks.map((m) => m.label)).toEqual(["1", "9", "17", "25", "33"]);
    expect(marks.every((m) => m.strength === "bar")).toBe(true);
    // And the ruler snaps to the bars drawn.
    expect(snapUnitFor(tempo, 4, 4)).toBe(32);
  });
});

describe("track heights", () => {
  it("are the track's own, in range, and short when folded", () => {
    expect(rowHeightOf({})).toBe(118);
    expect(rowHeightOf({ height: 200 })).toBe(200);
    expect(rowHeightOf({ height: 5 })).toBe(40);
    expect(rowHeightOf({ height: 900 })).toBe(320);
    expect(rowHeightOf({ height: 200, folded: true })).toBe(30);
  });
});
