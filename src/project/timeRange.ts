// Editing a span of time across tracks, like Ableton's time selection:
// what a track's clips become when a range is cleared, copied, duplicated,
// or when time is inserted or taken out. Pure: each takes a track's clips
// and gives back the new list (the same list when nothing changed), with
// `newId` naming the clips it makes. Clips are cut where a range's edges
// cross them, as the split action does: the parts keep the fades of the
// ends they kept; a MIDI part has its loop played out, an audio part loops
// on when it starts where a repeat does.

import { notesWithinClip } from "./project";
import type { AudioClipInstance, ClipInstance, MidiClipInstance } from "./types";

export interface TimeRange {
  start: number;
  end: number;
}

export type NewId = () => string;

/** Times closer than this are the same (float drift from snapping). */
const EPS = 1e-6;

const endOf = (c: ClipInstance) => c.offset + c.length;
const overlaps = (c: ClipInstance, from: number, to: number) => c.offset < to - EPS && endOf(c) > from + EPS;

/** The part of a clip between `from` and `to` (timeline seconds), as a clip
 * of its own with a new id, or null when they don't overlap. */
export function clipPart(clip: ClipInstance, from: number, to: number, newId: NewId): ClipInstance | null {
  const start = Math.max(from, clip.offset);
  const end = Math.min(to, endOf(clip));
  if (end - start <= EPS) return null;
  const into = start - clip.offset;
  const length = end - start;
  if (clip.kind === "midi") {
    // What the clip plays (its loop tiled out), from the part's start;
    // a note begun before it is left out, one running past its end is cut.
    const notes = notesWithinClip(clip)
      .filter((n) => n.time >= into - EPS && n.time < into + length - EPS)
      .map((n) => {
        const time = Math.max(0, n.time - into);
        return { ...n, time, duration: Math.min(n.duration, length - time) };
      });
    const part: MidiClipInstance = { ...clip, id: newId(), offset: start, length, notes, loopLength: null };
    return part;
  }
  const keepsStart = Math.abs(start - clip.offset) <= EPS;
  const keepsEnd = Math.abs(end - endOf(clip)) <= EPS;
  // A looping clip's part that starts where a repeat does loops on as
  // before; one starting inside a repeat plays from there, once.
  const loop = clip.loopLength && clip.loopLength > 0 && clip.loopLength < clip.length ? clip.loopLength : 0;
  const phase = loop ? into % loop : into;
  const onRepeat = loop > 0 && (phase <= EPS || loop - phase <= EPS);
  const part: AudioClipInstance = {
    ...clip,
    id: newId(),
    offset: start,
    length,
    sourceOffset: clip.sourceOffset + (onRepeat ? 0 : phase),
    fadeIn: keepsStart ? Math.min(clip.fadeIn, length) : 0,
    fadeOut: keepsEnd ? Math.min(clip.fadeOut, length) : 0,
    loopLength: onRepeat ? loop : null,
  };
  return part;
}

/** The clips with the range emptied: those across its edges are cut there,
 * and what was inside is gone. */
export function clearRange(clips: ClipInstance[], range: TimeRange, newId: NewId): ClipInstance[] {
  if (!clips.some((c) => overlaps(c, range.start, range.end))) return clips;
  return clips.flatMap((c) => {
    if (!overlaps(c, range.start, range.end)) return [c];
    return [clipPart(c, c.offset, range.start, newId), clipPart(c, range.end, endOf(c), newId)].filter((p): p is ClipInstance => p !== null);
  });
}

/** Copies of what's in the range, placed from its start (offset 0 is the
 * range's start). */
export function extractRange(clips: ClipInstance[], range: TimeRange, newId: NewId): ClipInstance[] {
  return clips
    .map((c) => clipPart(c, range.start, range.end, newId))
    .filter((p): p is ClipInstance => p !== null)
    .map((p) => ({ ...p, offset: p.offset - range.start }));
}

/** `content` (from extractRange) laid down at `at`, over whatever was
 * there for `length` seconds. */
export function placeRange(clips: ClipInstance[], content: ClipInstance[], at: number, length: number, newId: NewId): ClipInstance[] {
  const cleared = clearRange(clips, { start: at, end: at + length }, newId);
  if (content.length === 0) return cleared;
  return [...cleared, ...content.map((c) => ({ ...c, id: newId(), offset: c.offset + at }))];
}

/** Moves everything from `at` on later by `length` (a clip across `at` is
 * cut there): an empty gap opens at `at`. */
export function insertTime(clips: ClipInstance[], at: number, length: number, newId: NewId): ClipInstance[] {
  if (!clips.some((c) => endOf(c) > at + EPS)) return clips;
  return clips
    .flatMap((c) => (c.offset < at - EPS && endOf(c) > at + EPS ? [clipPart(c, c.offset, at, newId)!, clipPart(c, at, endOf(c), newId)!] : [c]))
    .map((c) => (c.offset >= at - EPS ? { ...c, offset: c.offset + length } : c));
}

/** Takes the range out: what was in it is gone and everything after it
 * moves earlier to close the gap. */
export function deleteTime(clips: ClipInstance[], range: TimeRange, newId: NewId): ClipInstance[] {
  if (!clips.some((c) => endOf(c) > range.start + EPS)) return clips;
  const length = range.end - range.start;
  return clearRange(clips, range, newId).map((c) => (c.offset >= range.end - EPS ? { ...c, offset: Math.max(range.start, c.offset - length) } : c));
}
