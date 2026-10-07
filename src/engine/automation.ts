// Automation lanes: the value a lane has at a given time.

/** Linearly interpolates an automation lane's value at time `t` - flat
 * before the first point and after the last, matching how the lane's UI
 * draws the curve. Points must be sorted by `time`. */
export function interpolateAutomation(
  points: { time: number; value: number }[],
  t: number
): number | null {
  if (points.length === 0) return null;
  if (points.length === 1 || t <= points[0].time) return points[0].value;
  const last = points[points.length - 1];
  if (t >= last.time) return last.value;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (t >= a.time && t <= b.time) {
      const ratio = (t - a.time) / (b.time - a.time || 1);
      return a.value + (b.value - a.value) * ratio;
    }
  }
  return last.value;
}
