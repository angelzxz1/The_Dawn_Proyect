// The song's tempo map: its tempo from bar 1, and changes to it at points
// along the song (in beats - quarter notes from the start, so a change
// stays on its bar). The timeline itself is in seconds; the map says where
// the beats and bars fall on it, for the grid, snapping, the ruler, the
// loop and the metronome. Editing the map moves what follows the beat -
// MIDI clips and notes, automation, warped audio - to stay on its beats
// (remapSeconds). Pure.

export interface TempoChange {
  /** From this beat on (quarter notes from the start of the song, > 0). */
  beat: number;
  bpm: number;
}

/** A stretch of constant tempo, from `beat` (at `seconds`) on. */
export interface TempoSegment {
  beat: number;
  seconds: number;
  bpm: number;
}

export interface TempoMap {
  /** The tempo at the start of the song. */
  bpm: number;
  /** The changes after the start, in order. */
  changes: TempoChange[];
  /** Precomputed stretches: the first starts at beat 0, second 0. */
  segments: TempoSegment[];
}

export const MIN_BPM = 20;
export const MAX_BPM = 300;
const EPS = 1e-9;

export const clampBpm = (bpm: number) => Math.min(MAX_BPM, Math.max(MIN_BPM, bpm));

/** A tempo as shown and typed: whole, or up to two decimals. */
export const formatBpm = (bpm: number) => String(Number(bpm.toFixed(2)));

/** The map from a starting tempo and changes after it (in any order; one
 * per beat, the last given winning; ones at or before the start, or not
 * changing the tempo, are left out). */
export function makeTempoMap(bpm: number, changes: readonly TempoChange[] = []): TempoMap {
  const base = clampBpm(bpm);
  const byBeat = new Map<number, number>();
  changes.forEach((c) => {
    if (Number.isFinite(c.beat) && Number.isFinite(c.bpm) && c.beat > EPS) byBeat.set(c.beat, clampBpm(c.bpm));
  });
  const sorted = [...byBeat].sort((a, b) => a[0] - b[0]);
  const kept: TempoChange[] = [];
  let current = base;
  sorted.forEach(([beat, value]) => {
    if (Math.abs(value - current) < EPS) return;
    kept.push({ beat, bpm: value });
    current = value;
  });
  const segments: TempoSegment[] = [{ beat: 0, seconds: 0, bpm: base }];
  kept.forEach((c) => {
    const prev = segments[segments.length - 1];
    segments.push({ beat: c.beat, seconds: prev.seconds + ((c.beat - prev.beat) * 60) / prev.bpm, bpm: c.bpm });
  });
  return { bpm: base, changes: kept, segments };
}

/** Whether the tempo never changes. */
export const isConstant = (map: TempoMap) => map.segments.length === 1;

/** The stretch a beat falls in (before the start: the first). */
function segmentAtBeat(map: TempoMap, beat: number): TempoSegment {
  const { segments } = map;
  let lo = 0;
  let hi = segments.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (segments[mid].beat <= beat + EPS) lo = mid;
    else hi = mid - 1;
  }
  return segments[lo];
}

function segmentAtSeconds(map: TempoMap, seconds: number): TempoSegment {
  const { segments } = map;
  let lo = 0;
  let hi = segments.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (segments[mid].seconds <= seconds + EPS) lo = mid;
    else hi = mid - 1;
  }
  return segments[lo];
}

/** Where a beat is on the timeline (s). Before the start, the first tempo
 * goes on back (a count-in). */
export function secondsAtBeat(map: TempoMap, beat: number): number {
  const s = segmentAtBeat(map, beat);
  return s.seconds + ((beat - s.beat) * 60) / s.bpm;
}

/** Which beat a point on the timeline is (fractional). */
export function beatAtSeconds(map: TempoMap, seconds: number): number {
  const s = segmentAtSeconds(map, seconds);
  return s.beat + ((seconds - s.seconds) * s.bpm) / 60;
}

export const bpmAtSeconds = (map: TempoMap, seconds: number) => segmentAtSeconds(map, seconds).bpm;
export const bpmAtBeat = (map: TempoMap, beat: number) => segmentAtBeat(map, beat).bpm;

/** Where something at `seconds` under one map goes under another, to stay
 * on its beat. */
export function remapSeconds(seconds: number, from: TempoMap, to: TempoMap): number {
  return from === to ? seconds : secondsAtBeat(to, beatAtSeconds(from, seconds));
}

/** The fastest tempo anywhere (where the grid is densest). */
export const maxBpm = (map: TempoMap) => Math.max(...map.segments.map((s) => s.bpm));

// --- The grid ---

/** A grid of lines every `stepBeats` beats, counted from `originBeat`:
 * where things snap to. A step of 0 is no grid (free). */
export interface Grid {
  stepBeats: number;
  /** The nearest grid line (s); the time itself with no grid. */
  snap(seconds: number): number;
  /** The grid line at or before / at or after (s). */
  floor(seconds: number): number;
  ceil(seconds: number): number;
  /** How long a grid step is around a time (s); 0 with no grid. */
  stepAt(seconds: number): number;
}

export function makeGrid(map: TempoMap, stepBeats: number, originBeat = 0): Grid {
  const round = (fn: (x: number) => number) => (seconds: number) => {
    if (!(stepBeats > 0)) return seconds;
    const steps = (beatAtSeconds(map, seconds) - originBeat) / stepBeats;
    // Times a hair off a line (float drift) count as on it.
    const near = Math.round(steps);
    return secondsAtBeat(map, originBeat + (Math.abs(steps - near) < 1e-6 ? near : fn(steps)) * stepBeats);
  };
  return {
    stepBeats,
    snap: round(Math.round),
    floor: round(Math.floor),
    ceil: round(Math.ceil),
    stepAt: (seconds) => (stepBeats > 0 ? (stepBeats * 60) / bpmAtSeconds(map, seconds) : 0),
  };
}

/** A grid of fixed `stepSeconds` (a constant tempo's), for when there's no
 * tempo map at hand; 0 is no grid. */
export function fixedGrid(stepSeconds: number): Grid {
  return makeGrid(makeTempoMap(60), stepSeconds);
}

/** No grid: everything goes where it's put. */
export const NO_GRID: Grid = fixedGrid(0);

/** From `start`, how long until the end of the bar `seconds` later falls
 * in (at least a bar): a recording's or import's clip runs to a bar line. */
export function roundUpToBarFrom(map: TempoMap, start: number, seconds: number, beatsPerBar: number): number {
  const from = beatAtSeconds(map, start);
  const beats = beatAtSeconds(map, start + seconds) - from;
  const bars = Math.max(1, Math.ceil(beats / beatsPerBar - 1e-6));
  return secondsAtBeat(map, from + bars * beatsPerBar) - start;
}
