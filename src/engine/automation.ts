// Automation lanes: the value a lane has at a given time, and the shape of
// its segments. Shared by the live engine (audioEngine.ts), the export
// (bounce.ts) and the lane's drawing (AutomationLane.tsx), so what's drawn
// is what's heard.

/** How steep the most bent curve (`curve` ±1) is. */
const CURVE_STEEPNESS = 6;

/** Where a segment is `r` (0..1) of the way along, bent by `curve` (-1..1):
 * 0 is a straight line; above 0 it starts slow and ends fast, below 0 the
 * other way round. */
export function curveShape(r: number, curve = 0): number {
  if (Math.abs(curve) < 1e-6) return r;
  const k = CURVE_STEEPNESS * curve;
  return Math.expm1(k * r) / Math.expm1(k);
}

/** The bend that puts a segment's middle `fraction` (0..1) of the way from
 * its start value to its end value: the inverse of `curveShape` at 0.5,
 * within ±1. */
export function curveThrough(fraction: number): number {
  const m = Math.min(0.98, Math.max(0.02, fraction));
  return Math.min(1, Math.max(-1, (2 * Math.log(1 / m - 1)) / CURVE_STEEPNESS));
}

/** An automation lane's value at time `t` - flat before the first point
 * and after the last, each segment a line bent by its first point's
 * `curve`. Points must be sorted by `time`. */
export function interpolateAutomation(points: { time: number; value: number; curve?: number }[], t: number): number | null {
  if (points.length === 0) return null;
  if (points.length === 1 || t <= points[0].time) return points[0].value;
  const last = points[points.length - 1];
  if (t >= last.time) return last.value;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (t >= a.time && t <= b.time) {
      const ratio = (t - a.time) / (b.time - a.time || 1);
      return a.value + (b.value - a.value) * curveShape(ratio, a.curve);
    }
  }
  return last.value;
}
