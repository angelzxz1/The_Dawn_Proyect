// What a clip can be given or have done to it besides moving and cutting
// (timeRange.ts): a name, its MIDI notes back to front, fades from a
// preset, the gain that normalizes its audio, and a track's clips over a
// span joined into one (consolidate). Pure: the audio itself - rendering a
// consolidated or reversed file - is engine/clipAudio.ts.

import { clearRange, extractRange, type NewId, type TimeRange } from "./timeRange";
import type { ClipInstance, MidiClipInstance, NoteEvent } from "./types";

/** The longest name a clip keeps. */
export const MAX_CLIP_NAME = 80;

/** A name as a clip keeps it: one line, trimmed, at most MAX_CLIP_NAME
 * characters - or none, when that leaves nothing. */
export function cleanClipName(name: string): string | undefined {
  const clean = name.replace(/\s+/g, " ").trim().slice(0, MAX_CLIP_NAME).trim();
  return clean || undefined;
}

/** A clip's name and color, when it has them (what a clip made from it
 * keeps). */
export function clipLabel(clip: Pick<ClipInstance, "name" | "color">): Pick<ClipInstance, "name" | "color"> {
  return { ...(clip.name ? { name: clip.name } : {}), ...(clip.color ? { color: clip.color } : {}) };
}

const looping = (clip: ClipInstance) => !!clip.loopLength && clip.loopLength > 0 && clip.loopLength < clip.length;

/** A MIDI clip's notes back to front: within its loop when it loops (so it
 * loops as before), else within the clip. A note that ran past the end is
 * cut there first; notes slid out of the clip (the slip tool) are mirrored
 * too, and stay out. */
export function reverseNotes(clip: MidiClipInstance): NoteEvent[] {
  const span = looping(clip) ? clip.loopLength! : clip.length;
  return clip.notes
    .map((n) => {
      const inside = n.time >= 0 && n.time < span;
      const duration = inside ? Math.min(n.duration, span - n.time) : n.duration;
      const time = span - n.time - duration;
      return { ...n, time: inside ? Math.max(0, time) : time, duration };
    })
    .sort((a, b) => a.time - b.time);
}

/** Where a clip's audio comes from in its file and how much of it plays
 * before it repeats (seconds): what normalizing measures, and what
 * reversing turns around. */
export function playedRegion(clip: { sourceOffset: number; length: number; loopLength?: number | null }): { start: number; end: number } {
  const span = clip.loopLength && clip.loopLength > 0 ? Math.min(clip.loopLength, clip.length) : clip.length;
  return { start: clip.sourceOffset, end: clip.sourceOffset + span };
}

// --- Fades ---

export type FadePreset = "none" | "declick" | "beat" | "bar";

export const FADE_PRESETS: { id: FadePreset; label: string; title: string }[] = [
  { id: "none", label: "None", title: "No fade in or out" },
  { id: "declick", label: "10 ms", title: "A 10 ms fade in and out, so the clip's ends don't click" },
  { id: "beat", label: "Beat", title: "Fade in and out over a beat" },
  { id: "bar", label: "Bar", title: "Fade in and out over a bar" },
];

/** Long enough to take the click out of a cut, too short to hear. */
export const DECLICK_SECONDS = 0.01;

/** A preset's fades for a clip `length` long: the same in and out, each at
 * most half the clip. */
export function presetFades(preset: FadePreset, length: number, bpm: number, beatsPerBar: number): { fadeIn: number; fadeOut: number } {
  const beat = 60 / bpm;
  const want = preset === "none" ? 0 : preset === "declick" ? DECLICK_SECONDS : preset === "beat" ? beat : beat * beatsPerBar;
  const each = Math.min(want, length / 2);
  return { fadeIn: each, fadeOut: each };
}

// --- Normalize ---

/** The gain a clip can have (dB), as its gain handle allows. */
export const CLIP_GAIN_RANGE = { min: -24, max: 24 };

/** The clip gain (dB) that brings audio peaking at `peak` (1 is full
 * scale) up or down to full scale, within the gain a clip can have; null
 * for silence. */
export function normalizeGain(peak: number): number | null {
  if (!(peak > 1e-6)) return null;
  return Math.min(CLIP_GAIN_RANGE.max, Math.max(CLIP_GAIN_RANGE.min, -20 * Math.log10(peak)));
}

// --- Consolidate ---

const overlaps = (c: ClipInstance, span: TimeRange) => c.offset < span.end && c.offset + c.length > span.start;

/** The first clip (in time) over a span: whose name and color a clip made
 * by joining them keeps. */
export function firstClipIn(clips: ClipInstance[], span: TimeRange): ClipInstance | undefined {
  return clips.filter((c) => overlaps(c, span)).sort((a, b) => a.offset - b.offset)[0];
}

/** A MIDI track's clips over `span` joined into one clip exactly as long:
 * what they play (loops played out, notes cut at each clip's end), the
 * first one's name and color. The same list when nothing's there. */
export function consolidateMidi(clips: ClipInstance[], span: TimeRange, newId: NewId): ClipInstance[] {
  const first = firstClipIn(clips, span);
  if (!first) return clips;
  const notes = extractRange(clips, span, newId)
    .flatMap((part) => (part.kind === "midi" ? part.notes.map((n) => ({ ...n, time: n.time + part.offset })) : []))
    .sort((a, b) => a.time - b.time);
  const joined: MidiClipInstance = {
    ...clipLabel(first),
    id: newId(),
    kind: "midi",
    offset: span.start,
    length: span.end - span.start,
    notes,
    loopLength: null,
  };
  return [...clearRange(clips, span, newId), joined];
}

/** Each track's span to consolidate, for selected clips: from the first
 * one's start to the last one's end, on each track that has some. */
export function spansOfClips(clipsByChannel: Record<string, ClipInstance[]>, ids: ReadonlySet<string>): Map<string, TimeRange> {
  const spans = new Map<string, TimeRange>();
  Object.entries(clipsByChannel).forEach(([channelId, clips]) => {
    const picked = clips.filter((c) => ids.has(c.id));
    if (picked.length === 0) return;
    spans.set(channelId, {
      start: Math.min(...picked.map((c) => c.offset)),
      end: Math.max(...picked.map((c) => c.offset + c.length)),
    });
  });
  return spans;
}

/** A rendered file's name: the clip's file's, with a word added before
 * its extension ("take.wav" → "take reversed.wav"). When the word's
 * already there it stays once - or, with `toggle`, comes off again (a
 * clip reversed twice). */
export function taggedFileName(fileName: string, tag: string, toggle = false): string {
  const dot = fileName.lastIndexOf(".");
  const base = dot > 0 ? fileName.slice(0, dot) : fileName;
  const suffix = ` ${tag}`;
  if (!base.endsWith(suffix)) return `${base}${suffix}.wav`;
  return toggle ? `${base.slice(0, -suffix.length)}.wav` : `${base}.wav`;
}
