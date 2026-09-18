// Shared layout constants and helpers for the horizontal arrangement view.

export const TRACK_HEADER_WIDTH = 224;
// Tall enough for the header's four rows - name, pan/vol + meter, the
// instrument/FX row, and the import/export/clear/remove row.
export const TRACK_ROW_HEIGHT = 164;
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

export type MarkStrength = "bar" | "beat" | "tick";

export interface AdaptiveMark {
  index: number;
  left: number;
  strength: MarkStrength;
  label: string | null;
}

/** Zoom thresholds (px) above which a finer subdivision starts being drawn. */
const SHOW_BEATS_PX = 22;
const SHOW_16THS_PX = 16;

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

/**
 * Adaptive grid marks shared by the main timeline ruler/lanes and the piano
 * roll editor: bars are always shown; beat subdivisions fade in as you zoom
 * in, then 16th-note ticks once you're zoomed in further still - the same
 * "1" / "1.2" / "1.2.3" progression in both places.
 */
export function computeAdaptiveMarks(
  bpm: number,
  totalSeconds: number,
  pxPerSecond: number,
  beatsPerBar: number
): AdaptiveMark[] {
  const secondsPerBeat = 60 / bpm;
  const secondsPer16th = secondsPerBeat / 4;
  const beatPx = secondsPerBeat * pxPerSecond;
  const sixteenthPx = secondsPer16th * pxPerSecond;
  const showBeats = beatPx >= SHOW_BEATS_PX;
  const show16ths = sixteenthPx >= SHOW_16THS_PX;
  const step = show16ths ? secondsPer16th : secondsPerBeat;
  const totalSteps = Math.ceil(totalSeconds / step);
  const stepsPerBeat = show16ths ? 4 : 1;
  const marks: AdaptiveMark[] = [];
  for (let i = 0; i <= totalSteps; i++) {
    const beatIndex = Math.floor(i / stepsPerBeat);
    const sixteenth = (i % stepsPerBeat) + 1;
    const withinBar = beatIndex % beatsPerBar;
    const bar = Math.floor(beatIndex / beatsPerBar) + 1;
    const beat = withinBar + 1;
    const isBarLine = withinBar === 0 && sixteenth === 1;
    const isBeatLine = sixteenth === 1;
    let strength: MarkStrength = "tick";
    let label: string | null = null;
    if (isBarLine) {
      strength = "bar";
      label = `${bar}`;
    } else if (isBeatLine) {
      strength = "beat";
      if (showBeats) label = `${bar}.${beat}`;
    } else if (show16ths) {
      label = `${bar}.${beat}.${sixteenth}`;
    }
    marks.push({ index: i, left: i * step * pxPerSecond, strength, label });
  }
  return marks;
}

/** The finest grid line currently visible at this zoom level (bar, beat, or
 * 16th) - what a click-to-seek should snap to, matching what's drawn. */
export function snapUnitFor(bpm: number, pxPerSecond: number, beatsPerBar: number): number {
  const secondsPerBeat = 60 / bpm;
  const secondsPer16th = secondsPerBeat / 4;
  if (secondsPer16th * pxPerSecond >= SHOW_16THS_PX) return secondsPer16th;
  if (secondsPerBeat * pxPerSecond >= SHOW_BEATS_PX) return secondsPerBeat;
  return secondsPerBar(bpm, beatsPerBar);
}
