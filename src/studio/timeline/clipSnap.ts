// Where a dragged clip lands: on another clip's edge when its start or end
// comes within reach of one (a few pixels, so it reads as a pull rather
// than a jump), otherwise on the grid. Alt drags free of both, as on the
// loop, marker and tempo lanes. Pure.

/** A clip's place on the timeline (s). */
export interface ClipSpan {
  id: string;
  start: number;
  end: number;
}

/** How close (px) an edge has to come to another clip's to snap to it. */
export const EDGE_SNAP_PX = 8;

/** The edges to snap to: every clip's start and end, but those of `moving`
 * (the clips going along with the drag), in order. */
export function snapEdges(spans: readonly ClipSpan[], moving: ReadonlySet<string>): number[] {
  const edges = new Set<number>();
  for (const s of spans) {
    if (moving.has(s.id)) continue;
    edges.add(s.start);
    edges.add(s.end);
  }
  return [...edges].sort((a, b) => a - b);
}

/** The edge nearest `at` within `reach`, or null. */
function nearest(edges: readonly number[], at: number, reach: number): number | null {
  let best: number | null = null;
  for (const e of edges) {
    const d = Math.abs(e - at);
    if (d <= reach && (best === null || d < Math.abs(best - at))) best = e;
  }
  return best;
}

/** Where a moved clip starts: `exact` is where the pointer puts it. Its
 * start or its end (whichever is nearer) goes onto an edge within `reach`
 * (s), or else its start onto the grid (`snap`). Never before 0. */
export function snapMove(exact: number, length: number, edges: readonly number[], reach: number, snap: (s: number) => number): number {
  const start = nearest(edges, exact, reach);
  const end = nearest(edges, exact + length, reach);
  const byStart = start === null ? Infinity : Math.abs(start - exact);
  const byEnd = end === null ? Infinity : Math.abs(end - (exact + length));
  if (start !== null && byStart <= byEnd) return Math.max(0, start);
  if (end !== null && end - length >= 0) return end - length;
  return Math.max(0, snap(exact));
}

/** Where a resized clip ends: `exact` is where the pointer puts its end.
 * Onto an edge within `reach` (s) past `minEnd`, or else `onGrid`'s. */
export function snapEnd(exact: number, edges: readonly number[], reach: number, minEnd: number, onGrid: (end: number) => number): number {
  const edge = nearest(
    edges.filter((e) => e >= minEnd),
    exact,
    reach
  );
  return edge ?? onGrid(exact);
}
