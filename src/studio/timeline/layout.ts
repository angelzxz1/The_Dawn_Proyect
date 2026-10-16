// Shared layout constants and helpers for the horizontal arrangement view.

import { beatAtSeconds, maxBpm, secondsAtBeat, type TempoMap } from "../../project/tempoMap";

export const TRACK_HEADER_WIDTH = 202;
// Tall enough for the header's four rows - name, pan/vol + meter, the
// instrument/FX row, and the import/export/clear/remove row.
export const TRACK_ROW_HEIGHT = 118;
/** A folded track: one short row (name, mute, solo), clips as thin bars. */
export const FOLDED_ROW_HEIGHT = 30;
/** A take lane under a track (takes.ts). */
export const TAKE_LANE_HEIGHT = 64;

/** A track's row height in the arrangement. */
export function rowHeightOf(track: { folded?: boolean }): number {
  return track.folded ? FOLDED_ROW_HEIGHT : TRACK_ROW_HEIGHT;
}
export const RULER_HEIGHT = 25;
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

/**
 * Adaptive grid marks shared by the main timeline ruler/lanes and the piano
 * roll editor: bars are always shown; beat subdivisions fade in as you zoom
 * in, then 16th-note ticks once you're zoomed in further still - the same
 * "1" / "1.2" / "1.2.3" progression in both places. They follow the tempo
 * map (tempoMap.ts), counted from `originSeconds` (a clip's start, in the
 * piano roll); how fine they go is set by the fastest tempo, so the
 * densest stretch doesn't clutter.
 */
export function computeAdaptiveMarks(
  tempo: TempoMap,
  totalSeconds: number,
  pxPerSecond: number,
  beatsPerBar: number,
  originSeconds = 0
): AdaptiveMark[] {
  const secondsPerBeat = 60 / maxBpm(tempo);
  const beatPx = secondsPerBeat * pxPerSecond;
  const sixteenthPx = (secondsPerBeat / 4) * pxPerSecond;
  const showBeats = beatPx >= SHOW_BEATS_PX;
  const show16ths = sixteenthPx >= SHOW_16THS_PX;
  const stepBeats = show16ths ? 0.25 : 1;
  const stepsPerBeat = show16ths ? 4 : 1;
  const origin = beatAtSeconds(tempo, originSeconds);
  const totalSteps = Math.ceil((beatAtSeconds(tempo, originSeconds + totalSeconds) - origin) / stepBeats - 1e-9);
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
    const left = (secondsAtBeat(tempo, origin + i * stepBeats) - originSeconds) * pxPerSecond;
    marks.push({ index: i, left, strength, label });
  }
  return marks;
}

/** The finest grid line currently visible at this zoom level (bar, beat, or
 * 16th), in beats - what a click-to-seek should snap to, matching what's
 * drawn. */
export function snapUnitFor(tempo: TempoMap, pxPerSecond: number, beatsPerBar: number): number {
  const secondsPerBeat = 60 / maxBpm(tempo);
  if ((secondsPerBeat / 4) * pxPerSecond >= SHOW_16THS_PX) return 0.25;
  if (secondsPerBeat * pxPerSecond >= SHOW_BEATS_PX) return 1;
  return beatsPerBar;
}
