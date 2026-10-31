import { describe, expect, it } from "vitest";
import { snapEdges, snapEnd, snapMove } from "./clipSnap";

// A grid of whole seconds.
const grid = (s: number) => Math.round(s);

describe("snapping a dragged clip", () => {
  const spans = [
    { id: "a", start: 1.3, end: 2.7 },
    { id: "b", start: 2.7, end: 4.1 },
    { id: "me", start: 6, end: 7 },
  ];

  it("snaps to every other clip's edges, not those moving along", () => {
    expect(snapEdges(spans, new Set(["me"]))).toEqual([1.3, 2.7, 4.1]);
    expect(snapEdges(spans, new Set(["me", "b"]))).toEqual([1.3, 2.7]);
  });

  it("puts its start or end on an edge within reach, the nearer one", () => {
    const edges = [1.3, 2.7, 4.1];
    // Its start near 4.1.
    expect(snapMove(4.05, 1, edges, 0.1, grid)).toBe(4.1);
    // Its end (start + 1) near 2.7.
    expect(snapMove(1.75, 1, edges, 0.1, grid)).toBeCloseTo(1.7, 9);
    // Both in reach: the nearer wins (end 2.72 is 0.02 off, start 1.72 isn't near).
    expect(snapMove(1.72, 1, edges, 0.1, grid)).toBeCloseTo(1.7, 9);
    // Out of reach: the grid.
    expect(snapMove(5.4, 1, edges, 0.1, grid)).toBe(5);
  });

  it("never goes before the start", () => {
    // Its end on 0.3 would put its start before 0: the grid instead.
    expect(snapMove(-0.65, 1, [0.3], 0.1, grid)).toBe(0);
    expect(snapMove(-0.3, 1, [], 0.1, grid)).toBe(0);
  });

  it("ends a resized clip on an edge within reach, past its shortest", () => {
    expect(snapEnd(2.65, [1.3, 2.7], 0.1, 1.5, grid)).toBe(2.7);
    // 1.3 is in reach but shorter than it can be.
    expect(snapEnd(1.35, [1.3], 0.1, 1.5, grid)).toBe(1);
    expect(snapEnd(3.4, [1.3, 2.7], 0.1, 1.5, grid)).toBe(3);
  });
});
