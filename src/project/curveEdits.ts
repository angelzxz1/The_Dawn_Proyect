// Drawing on an automation lane and on the piano roll's velocities:
// straight lines (ramps), freehand strokes, erasing a stretch, and bending
// a segment into a curve. Each takes what's there and gives back what it
// becomes. Pure.

import { curveThrough } from "../engine/automation";
import type { AutomationPoint } from "./types";

/** A place on a lane: a time (s) and a value. */
export interface CurvePoint {
  time: number;
  value: number;
}

const byTime = (a: { time: number }, b: { time: number }) => a.time - b.time;

const span = (a: number, b: number): [number, number] => (a <= b ? [a, b] : [b, a]);

/** The points with those from `from` to `to` (s, either order) taken out. */
export function eraseSpan(points: readonly AutomationPoint[], from: number, to: number): AutomationPoint[] {
  const [lo, hi] = span(from, to);
  return points.filter((p) => p.time < lo || p.time > hi);
}

/** A straight line (a ramp) from `a` to `b`: the points between them make
 * way for the line's two ends. */
export function drawLine(points: readonly AutomationPoint[], a: CurvePoint, b: CurvePoint, newId: () => string): AutomationPoint[] {
  const ends = a.time === b.time ? [b] : [a, b];
  return [...eraseSpan(points, a.time, b.time), ...ends.map((p) => ({ id: newId(), time: p.time, value: p.value }))].sort(byTime);
}

/** A freehand stroke (its points in any order, one per time): the points
 * in the stretch it covers make way for it, joined by straight lines. */
export function drawStroke(points: readonly AutomationPoint[], stroke: readonly CurvePoint[], newId: () => string): AutomationPoint[] {
  if (stroke.length === 0) return [...points];
  const drawn = [...stroke].sort(byTime);
  const kept = eraseSpan(points, drawn[0].time, drawn[drawn.length - 1].time);
  return [...kept, ...drawn.map((p) => ({ id: newId(), time: p.time, value: p.value }))].sort(byTime);
}

/** The segment at `time`: the index of its first point, or -1 outside
 * every segment. Points must be sorted by time. */
export function segmentAt(points: readonly AutomationPoint[], time: number): number {
  for (let i = 0; i < points.length - 1; i++) if (time >= points[i].time && time <= points[i + 1].time) return i;
  return -1;
}

/** The segment from point `i` bent so its middle passes through `value`
 * (or as near as a curve goes); a flat segment can't bend. A bend this
 * close to straight is straight. */
export function bendSegment(points: readonly AutomationPoint[], i: number, value: number): AutomationPoint[] {
  const a = points[i];
  const b = points[i + 1];
  if (!a || !b || a.value === b.value) return [...points];
  const curve = curveThrough((value - a.value) / (b.value - a.value));
  return points.map((p, j) => {
    if (j !== i) return p;
    const rest = { id: p.id, time: p.time, value: p.value };
    return Math.abs(curve) < 0.04 ? rest : { ...rest, curve };
  });
}

/** Velocities along a line from `a` to `b` (time s, velocity 0..1): each
 * note that starts within it takes the line's value there. `only` limits it
 * to those notes (a selection); `clamp` keeps a velocity in range. */
export function velocityLine<N extends { id: string; time: number; velocity: number }>(
  notes: readonly N[],
  a: CurvePoint,
  b: CurvePoint,
  clamp: (v: number) => number,
  only?: ReadonlySet<string>
): N[] {
  const [lo, hi] = span(a.time, b.time);
  const at = (t: number) => (b.time === a.time ? b.value : a.value + ((b.value - a.value) * (t - a.time)) / (b.time - a.time));
  return notes.map((n) => (n.time >= lo && n.time <= hi && (!only || only.has(n.id)) ? { ...n, velocity: clamp(at(n.time)) } : n));
}
