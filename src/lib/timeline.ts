// Shared layout constants and helpers for the horizontal arrangement view.

export const TRACK_HEADER_WIDTH = 224;
export const TRACK_ROW_HEIGHT = 112;
export const RULER_HEIGHT = 28;
export const DEFAULT_PX_PER_SECOND = 70;
export const MIN_PX_PER_SECOND = 20;
export const MAX_PX_PER_SECOND = 260;
export const MIN_EMPTY_CLIP_SECONDS = 4;
export const MIN_TIMELINE_SECONDS = 32;

export interface BarMark {
  index: number;
  left: number;
}

/** Bar gridline positions (in px) for a 4/4 timeline at the given tempo/zoom. */
export function computeBarMarks(
  bpm: number,
  totalSeconds: number,
  pxPerSecond: number
): BarMark[] {
  const secondsPerBar = (60 / bpm) * 4;
  const count = Math.ceil(totalSeconds / secondsPerBar) + 1;
  return Array.from({ length: count }, (_, i) => ({
    index: i,
    left: i * secondsPerBar * pxPerSecond,
  }));
}
