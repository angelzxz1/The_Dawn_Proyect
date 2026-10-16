// Takes and comping, like Ableton's take lanes and Logic's take folders: a
// track keeps the takes recorded on it in lanes under it (they don't play),
// and what plays - the comp, on the track's own lane - is put together from
// parts of them. A loop recording makes a take of each pass; recording over
// what's on a track keeps that as a take too. Pure: each takes a track's
// clips and lanes and gives back the new ones.

import { clearRange, clipPart, type NewId, type TimeRange } from "./timeRange";
import type { TempoMap } from "./tempoMap";
import type { ClipInstance, MidiClipInstance, NoteEvent, TakeLane } from "./types";

const EPS = 1e-6;

const endOf = (c: ClipInstance) => c.offset + c.length;
const overlaps = (c: ClipInstance, span: TimeRange) => c.offset < span.end - EPS && endOf(c) > span.start + EPS;

/** A clip as a take lane keeps it: without a mark of which take it came
 * from (it is one). */
function asTake(clip: ClipInstance): ClipInstance {
  if (clip.take === undefined) return clip;
  const { take: _t, ...rest } = clip;
  void _t;
  return rest as ClipInstance;
}

/** Where some clips are on the timeline, first start to last end. */
export function spanOf(clips: ClipInstance[]): TimeRange | null {
  if (clips.length === 0) return null;
  return { start: Math.min(...clips.map((c) => c.offset)), end: Math.max(...clips.map(endOf)) };
}

// --- Recording ---

/** One pass of a recording: where it is on the timeline, and how far into
 * the recording it starts (s). */
export interface RecordedPass {
  start: number;
  end: number;
  at: number;
}

/** The passes of a recording `seconds` long that started at `from`: one,
 * unless it was looping between `loop`'s ends - then the first runs to the
 * loop's end, and each after it is a time round the loop. A last pass
 * shorter than `minLast` (stopped just after the loop came round) is
 * dropped. */
export function recordingPasses(from: number, seconds: number, loop: TimeRange | null, minLast = 0): RecordedPass[] {
  if (seconds <= EPS) return [];
  const length = loop ? loop.end - loop.start : 0;
  if (!loop || length <= EPS || from >= loop.end - EPS) return [{ start: from, end: from + seconds, at: 0 }];
  const passes: RecordedPass[] = [{ start: from, end: Math.min(loop.end, from + seconds), at: 0 }];
  for (let at = loop.end - from; at < seconds - EPS; at += length) {
    passes.push({ start: loop.start, end: loop.start + Math.min(length, seconds - at), at });
  }
  const last = passes[passes.length - 1];
  if (passes.length > 1 && last.end - last.start < minLast) passes.pop();
  return passes;
}

/** A MIDI recording's notes (timed from its start) as one take per pass:
 * each pass's notes from its own start, a note held past the pass's end
 * cut there. A pass nothing was played in makes no take. */
export function midiPassTakes(notes: NoteEvent[], passes: RecordedPass[], newId: NewId): MidiClipInstance[] {
  return passes.flatMap((pass) => {
    const length = pass.end - pass.start;
    const inPass = notes
      .filter((n) => n.time >= pass.at - EPS && n.time < pass.at + length - EPS)
      .map((n) => {
        const time = Math.max(0, n.time - pass.at);
        return { ...n, time, duration: Math.min(n.duration, length - time) };
      });
    if (inPass.length === 0) return [];
    const clip: MidiClipInstance = { id: newId(), kind: "midi", offset: pass.start, length, notes: inPass, loopLength: null };
    return [clip];
  });
}

/** A MIDI loop recording's passes all in one clip (overdub): every note
 * where it was played on the timeline, from the first pass's start to the
 * end of the loop. */
export function mergedMidiTake(notes: NoteEvent[], passes: RecordedPass[], newId: NewId): MidiClipInstance | null {
  const [first] = passes;
  if (!first) return null;
  const end = Math.max(...passes.map((p) => p.end));
  const merged = passes.flatMap((pass) =>
    notes
      .filter((n) => n.time >= pass.at - EPS && n.time < pass.at + (pass.end - pass.start) - EPS)
      .map((n) => {
        const time = pass.start + Math.max(0, n.time - pass.at) - first.start;
        return { ...n, time, duration: Math.min(n.duration, pass.end - first.start - time) };
      })
  );
  if (merged.length === 0) return null;
  return { id: newId(), kind: "midi", offset: first.start, length: end - first.start, notes: merged.sort((a, b) => a.time - b.time), loopLength: null };
}

/** The number a new take gets: one more than the highest so far. */
function nextTakeNumber(lanes: TakeLane[]): number {
  return lanes.reduce((n, lane) => Math.max(n, Number(/^Take (\d+)$/.exec(lane.name)?.[1] ?? 0)), lanes.length) + 1;
}

/** What recording `takes` (one clip each, in the order they were
 * recorded) onto a track does: each becomes a take lane, and the track's
 * lane gets the latest of them at each point. The first time takes are
 * recorded over what's on the track, that becomes the first take. One take
 * over nothing, on a track without takes, is just a new clip. */
export function recordTakes(
  main: ClipInstance[],
  lanes: TakeLane[],
  takes: ClipInstance[],
  newId: NewId,
  newLaneId: () => string,
  tempo?: TempoMap
): { main: ClipInstance[]; lanes: TakeLane[] } {
  const span = spanOf(takes);
  if (!span) return { main, lanes };
  const covered = main.filter((c) => overlaps(c, span));
  if (lanes.length === 0 && takes.length === 1 && covered.length === 0) return { main: [...main, takes[0]], lanes };
  let number = nextTakeNumber(lanes);
  let nextLanes = lanes;
  if (lanes.length === 0 && covered.length > 0) {
    // What was there, over the time recorded.
    const before = covered.map((c) => clipPart(c, span.start, span.end, newId, tempo)).filter((c): c is ClipInstance => c !== null);
    nextLanes = [{ id: newLaneId(), name: `Take ${number++}`, clips: before.map(asTake) }];
  }
  let nextMain = main;
  takes.forEach((take) => {
    const lane: TakeLane = { id: newLaneId(), name: `Take ${number++}`, clips: [asTake(take)] };
    nextLanes = [...nextLanes, lane];
    nextMain = [...clearRange(nextMain, { start: take.offset, end: endOf(take) }, newId, tempo), { ...take, id: newId(), take: lane.id }];
  });
  return { main: nextMain, lanes: nextLanes };
}

// --- Comping ---

/** The track's lane with what a take has between `range`'s ends put in,
 * over what was there - silence where the take has none. Each piece
 * remembers the take it came from. */
export function compFrom(main: ClipInstance[], lane: TakeLane, range: TimeRange, newId: NewId, tempo?: TempoMap): ClipInstance[] {
  if (range.end - range.start <= EPS) return main;
  const parts = lane.clips
    .map((c) => clipPart(c, range.start, range.end, newId, tempo))
    .filter((c): c is ClipInstance => c !== null)
    .map((c) => ({ ...c, take: lane.id }));
  return [...clearRange(main, range, newId, tempo), ...parts];
}

/** The parts of the timeline where the track plays a take: its clips that
 * came from it. */
export function compSpans(main: ClipInstance[], laneId: string): TimeRange[] {
  return main.filter((c) => c.take === laneId).map((c) => ({ start: c.offset, end: endOf(c) }));
}

/** The lanes without one take. The track's clips that came from it stay
 * (they're what plays), no longer marked as from a take. */
export function removeTake(main: ClipInstance[], lanes: TakeLane[], laneId: string): { main: ClipInstance[]; lanes: TakeLane[] } {
  const marked = main.some((c) => c.take === laneId);
  return {
    main: marked ? main.map((c) => (c.take === laneId ? asTake(c) : c)) : main,
    lanes: lanes.filter((l) => l.id !== laneId),
  };
}
