// Zooming the arrangement: how far a wheel turn or a pinch zooms, keeping
// the point under the pointer (or the playhead) where it is, and fitting
// the song or a span to the screen. Pure.

import { MAX_PX_PER_SECOND, MIN_PX_PER_SECOND } from "./layout";

/** A zoom button or key press: this much in or out. */
export const ZOOM_STEP = 1.25;

export const clampZoom = (pxPerSecond: number) => Math.min(MAX_PX_PER_SECOND, Math.max(MIN_PX_PER_SECOND, pxPerSecond));

/** How much a wheel event zooms by (above 1 is in): a mouse wheel's notch
 * a step, a trackpad's pinch (small deltas, many of them) smoothly. */
export function wheelZoomFactor(deltaY: number, deltaMode = 0): number {
  const px = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY;
  return Math.exp(-Math.max(-60, Math.min(60, px)) * 0.006);
}

/** Where to scroll to (px) so the timeline second `seconds`, `x` px from
 * the view's left, stays at `x` at a new zoom. */
export function scrollKeeping(seconds: number, x: number, pxPerSecond: number): number {
  return Math.max(0, seconds * pxPerSecond - x);
}

/** The zoom, and the scroll, that fit `start` to `end` (s) into a view
 * `width` px wide, with a little room either side (from the song's start,
 * which can't scroll further left, only after). */
export function fitSpan(start: number, end: number, width: number): { pxPerSecond: number; scrollLeft: number } {
  const margin = Math.min(48, width * 0.04);
  const before = start > 0 ? margin : 0;
  const span = Math.max(0.25, end - start);
  const pxPerSecond = clampZoom((width - before - margin) / span);
  return { pxPerSecond, scrollLeft: Math.max(0, start * pxPerSecond - before) };
}
