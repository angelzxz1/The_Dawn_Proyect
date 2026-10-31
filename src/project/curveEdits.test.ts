import { describe, expect, it } from "vitest";
import { bendSegment, drawLine, drawStroke, eraseSpan, segmentAt, velocityLine } from "./curveEdits";
import { curveShape, curveThrough, interpolateAutomation } from "../engine/automation";
import { normalizeProject } from "./projectSchema";
import type { AutomationPoint } from "./types";

const pts = (...pairs: [number, number][]): AutomationPoint[] => pairs.map(([time, value], i) => ({ id: `p${i}`, time, value }));
let n = 0;
const newId = () => `new${++n}`;
const shape = (points: AutomationPoint[]) => points.map((p) => [p.time, p.value, p.curve ?? 0]);

describe("curves", () => {
  it("bend a segment either way, straight at 0", () => {
    expect(curveShape(0.5)).toBe(0.5);
    expect(curveShape(0, 1)).toBe(0);
    expect(curveShape(1, -1)).toBeCloseTo(1, 12);
    // Above 0, slow then fast; below, fast then slow.
    expect(curveShape(0.5, 0.5)).toBeLessThan(0.5);
    expect(curveShape(0.5, -0.5)).toBeGreaterThan(0.5);
  });

  it("can be made to pass through a middle value", () => {
    for (const m of [0.1, 0.3, 0.5, 0.8]) expect(curveShape(0.5, curveThrough(m))).toBeCloseTo(m, 9);
    // As bent as a curve goes.
    expect(curveThrough(0)).toBe(1);
  });

  it("are what the engine plays", () => {
    const lane = [{ time: 0, value: 0, curve: 0.5 }, { time: 2, value: 10 }];
    expect(interpolateAutomation(lane, 1)).toBeCloseTo(10 * curveShape(0.5, 0.5), 9);
    expect(interpolateAutomation(lane, 3)).toBe(10);
  });
});

describe("drawing on an automation lane", () => {
  it("draws a line over what was there", () => {
    const before = pts([0, 0], [1, 5], [2, 3], [4, 1]);
    // From 0.5 s to 2.5 s, either way round.
    expect(shape(drawLine(before, { time: 2.5, value: 8 }, { time: 0.5, value: 2 }, newId))).toEqual([
      [0, 0, 0],
      [0.5, 2, 0],
      [2.5, 8, 0],
      [4, 1, 0],
    ]);
  });

  it("draws a freehand stroke, joining its points", () => {
    const before = pts([0, 0], [1, 5], [3, 1]);
    const out = drawStroke(before, [{ time: 2, value: 4 }, { time: 0.5, value: 6 }, { time: 1.5, value: 7 }], newId);
    expect(shape(out)).toEqual([
      [0, 0, 0],
      [0.5, 6, 0],
      [1.5, 7, 0],
      [2, 4, 0],
      [3, 1, 0],
    ]);
  });

  it("erases a stretch", () => {
    expect(shape(eraseSpan(pts([0, 0], [1, 5], [2, 3]), 2.5, 0.5))).toEqual([[0, 0, 0]]);
  });

  it("bends a segment through a value, and back to straight", () => {
    const before = pts([0, 0], [2, 10], [3, 10]);
    expect(segmentAt(before, 1)).toBe(0);
    expect(segmentAt(before, 5)).toBe(-1);
    const bent = bendSegment(before, 0, 2);
    expect(interpolateAutomation(bent, 1)).toBeCloseTo(2, 9);
    expect(bent[0].curve).toBeGreaterThan(0);
    expect(bendSegment(bent, 0, 5.01)[0]).not.toHaveProperty("curve");
    // A flat one stays as it is.
    expect(bendSegment(before, 1, 3)).toEqual(before);
  });
});

describe("drawing velocities", () => {
  const notes = [
    { id: "a", time: 0, velocity: 0.5 },
    { id: "b", time: 1, velocity: 0.5 },
    { id: "c", time: 2, velocity: 0.5 },
    { id: "d", time: 3, velocity: 0.5 },
  ];
  const clamp = (v: number) => Math.min(1, Math.max(1 / 127, v));

  it("puts the notes a line spans on it", () => {
    const out = velocityLine(notes, { time: 0, value: 0.2 }, { time: 2, value: 1.2 }, clamp);
    expect(out.map((x) => x.velocity)).toEqual([0.2, 0.7, 1, 0.5]);
  });

  it("only the selected ones, with a selection", () => {
    const out = velocityLine(notes, { time: 3, value: 0.9 }, { time: 0, value: 0.9 }, clamp, new Set(["b", "d"]));
    expect(out.map((x) => x.velocity)).toEqual([0.5, 0.9, 0.5, 0.9]);
  });
});

describe("a saved lane", () => {
  it("keeps its bends, within ±1, and drops straight ones", () => {
    const lane = {
      id: "l",
      target: { kind: "volume" },
      points: [
        { id: "p", time: 0, value: 0, curve: 0.5 },
        { id: "q", time: 1, value: -6, curve: 3 },
        { id: "r", time: 2, value: -6, curve: 0 },
      ],
    };
    const project = normalizeProject({ channels: [{ id: "a", name: "A", type: "audio", automationLanes: [lane] }] });
    const points = project?.channels[0].automationLanes?.[0].points;
    expect(points?.map((p) => p.curve)).toEqual([0.5, 1, undefined]);
  });
});
