// The arrangement loop (Ableton's loop brace): a region of the song that
// playback repeats while it's on. Kept in beats (quarter notes), so it stays
// on the same bars when the tempo changes, and saved with the project.

export interface ArrangementLoop {
  on: boolean;
  /** Beats from the start of the song. */
  start: number;
  end: number;
}

/** The shortest loop: a 16th note. */
export const MIN_LOOP_BEATS = 0.25;

/** Off, over the first four bars. */
export function defaultLoop(beatsPerBar = 4): ArrangementLoop {
  return { on: false, start: 0, end: 4 * beatsPerBar };
}

export function normalizeArrangementLoop(raw: unknown, beatsPerBar = 4): ArrangementLoop {
  const d = defaultLoop(beatsPerBar);
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);
  const start = n(r.start) ?? d.start;
  const end = n(r.end) ?? d.end;
  const lo = Math.min(start, end);
  return { on: typeof r.on === "boolean" ? r.on : d.on, start: lo, end: Math.max(start, end, lo + MIN_LOOP_BEATS) };
}

export const beatsToSeconds = (beats: number, bpm: number) => (beats * 60) / bpm;
export const secondsToBeats = (seconds: number, bpm: number) => (seconds * bpm) / 60;

/** Rounds to the nearest `unit` beats (no rounding when unit is 0). */
export function snapBeats(beats: number, unit: number): number {
  return unit > 0 ? Math.round(beats / unit) * unit : beats;
}

const EPS = 1e-6;

function parts(beats: number, beatsPerBar: number): [number, number, number] {
  const sixteenths = Math.round(beats * 4);
  const perBar = Math.round(beatsPerBar * 4);
  const bars = Math.floor(sixteenths / perBar);
  const rest = sixteenths - bars * perBar;
  return [bars, Math.floor(rest / 4), rest % 4];
}

/** A position as bar.beat.sixteenth, counting from 1 (like Ableton): beat 0 is "1.1.1". */
export function formatPosition(beats: number, beatsPerBar: number): string {
  const [bar, beat, six] = parts(beats, beatsPerBar);
  return `${bar + 1}.${beat + 1}.${six + 1}`;
}

/** A length as bars.beats.sixteenths, counting from 0: four bars is "4.0.0". */
export function formatLength(beats: number, beatsPerBar: number): string {
  const [bar, beat, six] = parts(beats, beatsPerBar);
  return `${bar}.${beat}.${six}`;
}

function fields(text: string): number[] | null {
  const bits = text.trim().split(/[.:\s]+/).filter(Boolean);
  if (bits.length === 0 || bits.length > 3) return null;
  const nums = bits.map(Number);
  return nums.every((v) => Number.isFinite(v) && v >= 0) ? nums : null;
}

/** "5", "5.2" or "5.2.3" (bar.beat.sixteenth, from 1) as beats, or null. */
export function parsePosition(text: string, beatsPerBar: number): number | null {
  const f = fields(text);
  if (!f) return null;
  const [bar, beat = 1, six = 1] = f;
  if (bar < 1 || beat < 1 || six < 1) return null;
  return (bar - 1) * beatsPerBar + (beat - 1) + (six - 1) / 4;
}

/** "4", "0.2" or "1.0.2" (bars.beats.sixteenths) as beats, or null. */
export function parseLength(text: string, beatsPerBar: number): number | null {
  const f = fields(text);
  if (!f) return null;
  const [bars, beats = 0, six = 0] = f;
  const total = bars * beatsPerBar + beats + six / 4;
  return total >= MIN_LOOP_BEATS ? total : null;
}

/** The loop moved to start at `start` (keeping its length). */
export function moveLoop(loop: ArrangementLoop, start: number): ArrangementLoop {
  const length = loop.end - loop.start;
  const s = Math.max(0, start);
  return { ...loop, start: s, end: s + length };
}

/** The loop with one edge moved, never shorter than a 16th or crossing the other edge. */
export function setLoopEdge(loop: ArrangementLoop, edge: "start" | "end", beats: number): ArrangementLoop {
  if (edge === "start") return { ...loop, start: Math.max(0, Math.min(beats, loop.end - MIN_LOOP_BEATS)) };
  return { ...loop, end: Math.max(beats, loop.start + MIN_LOOP_BEATS) };
}

/** The span covering every range (in beats), or null if there are none. */
export function loopAround(ranges: { start: number; end: number }[]): { start: number; end: number } | null {
  if (ranges.length === 0) return null;
  const start = Math.max(0, Math.min(...ranges.map((r) => r.start)));
  const end = Math.max(...ranges.map((r) => r.end));
  return end - start >= MIN_LOOP_BEATS ? { start, end } : null;
}

/** Ableton's keys for a selected loop brace: up/down move it by its own
 * length, left/right by `unit`, and with Ctrl/Cmd left/right shorten or
 * lengthen it by `unit`. Null if the key does nothing. */
export function nudgeLoop(loop: ArrangementLoop, key: string, unit: number, resize: boolean): ArrangementLoop | null {
  const length = loop.end - loop.start;
  switch (key) {
    case "ArrowUp":
      return moveLoop(loop, loop.start + length);
    case "ArrowDown":
      return loop.start <= 0 ? null : moveLoop(loop, loop.start - length);
    case "ArrowRight":
      return resize ? setLoopEdge(loop, "end", loop.end + unit) : moveLoop(loop, loop.start + unit);
    case "ArrowLeft":
      if (resize) return setLoopEdge(loop, "end", loop.end - unit);
      return loop.start <= 0 ? null : moveLoop(loop, loop.start - unit);
    default:
      return null;
  }
}

/** Whether playback started at `beats` should loop: like Ableton, starting
 * past the loop's end plays on through instead of jumping back. */
export function loopsFrom(loop: ArrangementLoop, beats: number): boolean {
  return loop.on && beats < loop.end - EPS;
}
