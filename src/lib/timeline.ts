// Shared layout constants and helpers for the horizontal arrangement view.

export const TRACK_HEADER_WIDTH = 224;
export const TRACK_ROW_HEIGHT = 128;
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

/** Quarter-note-equivalent beats per bar for an x/y time signature. */
export function quarterNotesPerBar(numerator: number, denominator: number): number {
  return (numerator * 4) / denominator;
}

export function secondsPerBar(bpm: number, beatsPerBar: number): number {
  return (60 / bpm) * beatsPerBar;
}

/** Rounds a duration up to the next bar boundary (minimum one bar). */
export function roundUpToBar(
  seconds: number,
  bpm: number,
  beatsPerBar: number
): number {
  const bar = secondsPerBar(bpm, beatsPerBar);
  return Math.max(bar, Math.ceil(seconds / bar) * bar);
}

/** Bar gridline positions (in px) for a timeline at the given tempo/zoom. */
export function computeBarMarks(
  bpm: number,
  totalSeconds: number,
  pxPerSecond: number,
  beatsPerBar: number = 4
): BarMark[] {
  const bar = secondsPerBar(bpm, beatsPerBar);
  const count = Math.ceil(totalSeconds / bar) + 1;
  return Array.from({ length: count }, (_, i) => ({
    index: i,
    left: i * bar * pxPerSecond,
  }));
}
