// Warping: an audio clip that follows the song's tempo. Its file has a
// tempo of its own (and markers pinning points in it to beats); the clip
// plays the file's beats on the song's beats from where it starts, so the
// file is sped up or slowed down wherever the two tempos differ (the
// engine stretches it, warpRender.ts). An unwarped clip plays its file at
// its own speed. Everything that maps a point on the timeline to a point in
// a clip's file - splitting, the slip tool, drawing the waveform, playing
// it - goes through here. Pure.

import { beatAtSeconds, bpmAtSeconds, secondsAtBeat, type TempoMap } from "./tempoMap";
import type { AudioClipInstance, AudioWarp, WarpMarker } from "./types";

/** What of a clip the mapping needs. */
export type WarpedClip = Pick<AudioClipInstance, "offset" | "length" | "sourceOffset" | "loopLength" | "warp">;

const EPS = 1e-9;

/** A stretch of a clip where its file plays at one speed: from `t0` to `t1`
 * (seconds from the clip's start) it plays the file from `s0` to `s1`. */
export interface WarpPiece {
  t0: number;
  t1: number;
  s0: number;
  s1: number;
}

/** The warp's markers kept to the ones in order (both ways), each at or
 * after the file's start. */
export function cleanMarkers(markers: readonly WarpMarker[]): WarpMarker[] {
  const out: WarpMarker[] = [];
  [...markers]
    .filter((m) => Number.isFinite(m.source) && Number.isFinite(m.beat) && m.source >= 0)
    .sort((a, b) => a.source - b.source)
    .forEach((m) => {
      const last = out[out.length - 1];
      if (!last || (m.source > last.source + 1e-6 && m.beat > last.beat + 1e-6)) out.push({ source: m.source, beat: m.beat });
    });
  return out;
}

/** The marker stretch (index of its first marker) a point falls in: the
 * first or last one carries on past the ends. */
function stretchAt(markers: readonly WarpMarker[], value: number, key: "source" | "beat"): number {
  let i = 0;
  while (i < markers.length - 2 && markers[i + 1][key] <= value) i++;
  return i;
}

/** Beats from the file's start at a point in it (s). */
export function fileBeatAt(warp: AudioWarp, source: number): number {
  const m = warp.markers;
  const rate = warp.bpm / 60;
  if (m.length === 0) return source * rate;
  if (m.length === 1) return m[0].beat + (source - m[0].source) * rate;
  const i = stretchAt(m, source, "source");
  const a = m[i];
  const b = m[i + 1];
  return a.beat + ((source - a.source) * (b.beat - a.beat)) / (b.source - a.source);
}

/** Where in the file (s) a beat from its start is. */
export function sourceAtFileBeat(warp: AudioWarp, beat: number): number {
  const m = warp.markers;
  const rate = warp.bpm / 60;
  if (m.length === 0) return beat / rate;
  if (m.length === 1) return m[0].source + (beat - m[0].beat) / rate;
  const i = stretchAt(m, beat, "beat");
  const a = m[i];
  const b = m[i + 1];
  return a.source + ((beat - a.beat) * (b.source - a.source)) / (b.beat - a.beat);
}

const loopOf = (clip: WarpedClip) => (clip.loopLength && clip.loopLength > 0 && clip.loopLength < clip.length - EPS ? clip.loopLength : 0);

/** Where in its file a clip is at timeline second `t` (before its start or
 * past its end, as if it went on). */
export function sourceAt(clip: WarpedClip, t: number, tempo: TempoMap): number {
  const loop = loopOf(clip);
  const warp = clip.warp;
  if (!warp) {
    const into = t - clip.offset;
    return clip.sourceOffset + (loop && into > 0 ? into % loop : into);
  }
  const b0 = beatAtSeconds(tempo, clip.offset);
  let into = beatAtSeconds(tempo, t) - b0;
  if (loop && into > 0) into %= beatAtSeconds(tempo, clip.offset + loop) - b0;
  return sourceAtFileBeat(warp, fileBeatAt(warp, clip.sourceOffset) + into);
}

/** What a clip plays: its pieces in order, a loop's repeats each starting a
 * new run of them. An unwarped clip's play its file at its own speed. */
export function warpPieces(clip: WarpedClip, tempo: TempoMap): WarpPiece[] {
  const loop = loopOf(clip);
  const warp = clip.warp;
  const out: WarpPiece[] = [];
  if (!warp) {
    const unit = loop || clip.length;
    for (let t = 0; t < clip.length - EPS && out.length < 10000; t += unit) {
      const end = Math.min(clip.length, t + unit);
      out.push({ t0: t, t1: end, s0: clip.sourceOffset, s1: clip.sourceOffset + (end - t) });
    }
    return out;
  }
  const b0 = beatAtSeconds(tempo, clip.offset);
  const bEnd = beatAtSeconds(tempo, clip.offset + clip.length);
  const unit = loop ? beatAtSeconds(tempo, clip.offset + loop) - b0 : bEnd - b0;
  const fb0 = fileBeatAt(warp, clip.sourceOffset);
  if (!(unit > EPS)) return out;
  for (let rs = b0; rs < bEnd - EPS && out.length < 10000; rs += unit) {
    const re = Math.min(bEnd, rs + unit);
    // Where the speed can change: the song's tempo changes and the
    // file's markers, in song beats.
    const cuts = new Set<number>([rs, re]);
    tempo.segments.forEach((s) => s.beat > rs + EPS && s.beat < re - EPS && cuts.add(s.beat));
    warp.markers.forEach((m) => {
      const at = rs + (m.beat - fb0);
      if (at > rs + EPS && at < re - EPS) cuts.add(at);
    });
    const beats = [...cuts].sort((a, b) => a - b);
    for (let i = 0; i + 1 < beats.length; i++) {
      out.push({
        t0: secondsAtBeat(tempo, beats[i]) - clip.offset,
        t1: secondsAtBeat(tempo, beats[i + 1]) - clip.offset,
        s0: sourceAtFileBeat(warp, fb0 + beats[i] - rs),
        s1: sourceAtFileBeat(warp, fb0 + beats[i + 1] - rs),
      });
    }
  }
  return out;
}

/** Where in its file a clip is at `t` seconds from its start, by its
 * pieces (the waveform's drawing). */
export function sourceInPieces(pieces: readonly WarpPiece[], t: number): number | null {
  for (const p of pieces) {
    if (t >= p.t0 - EPS && t < p.t1) return p.t1 - p.t0 > EPS ? p.s0 + ((t - p.t0) * (p.s1 - p.s0)) / (p.t1 - p.t0) : p.s0;
  }
  return null;
}

/** Whether the pieces play the file at its own speed throughout. */
export function playsAtOwnSpeed(pieces: readonly WarpPiece[]): boolean {
  return pieces.every((p) => Math.abs(p.s1 - p.s0 - (p.t1 - p.t0)) < 1e-6);
}

/** The part of the file a clip plays (once round, when it loops). */
export function playedSource(clip: WarpedClip, tempo: TempoMap): { start: number; end: number } {
  const loop = loopOf(clip);
  const end = clip.warp
    ? sourceAtFileBeat(
        clip.warp,
        fileBeatAt(clip.warp, clip.sourceOffset) + beatAtSeconds(tempo, clip.offset + (loop || clip.length)) - beatAtSeconds(tempo, clip.offset)
      )
    : clip.sourceOffset + (loop || clip.length);
  return { start: clip.sourceOffset, end };
}

/** A part of a clip from `start` (timeline seconds) on: where in the file
 * it starts, and its loop - a part starting where a repeat does loops on;
 * one starting inside a repeat plays from there, once. */
export function partFrom(clip: WarpedClip, start: number, tempo: TempoMap): { sourceOffset: number; loopLength: number | null } {
  const loop = loopOf(clip);
  const sourceOffset = sourceAt(clip, start, tempo);
  if (!loop) return { sourceOffset, loopLength: null };
  if (!clip.warp) {
    const phase = (start - clip.offset) % loop;
    const onRepeat = phase <= 1e-6 || loop - phase <= 1e-6;
    return onRepeat ? { sourceOffset: clip.sourceOffset, loopLength: loop } : { sourceOffset, loopLength: null };
  }
  const b0 = beatAtSeconds(tempo, clip.offset);
  const unit = beatAtSeconds(tempo, clip.offset + loop) - b0;
  const at = beatAtSeconds(tempo, start);
  const phase = (at - b0) % unit;
  const onRepeat = phase <= 1e-6 || unit - phase <= 1e-6;
  return onRepeat ? { sourceOffset: clip.sourceOffset, loopLength: secondsAtBeat(tempo, at + unit) - start } : { sourceOffset, loopLength: null };
}

/** A warp that plays the clip just as it plays now, on the song's tempo map
 * as it is: switching warping on changes nothing until the tempo does. */
export function followingWarp(clip: WarpedClip, tempo: TempoMap, mode: AudioWarp["mode"] = "stretch"): AudioWarp {
  const bpm = bpmAtSeconds(tempo, clip.offset);
  const span = loopOf(clip) || clip.length;
  const b0 = beatAtSeconds(tempo, clip.offset);
  const fb0 = (clip.sourceOffset * bpm) / 60;
  // Where the song's tempo changes over the clip, the file's beats do too.
  const changes = tempo.segments.filter((s) => s.seconds > clip.offset + 1e-6 && s.seconds < clip.offset + span - 1e-6);
  if (changes.length === 0) return { mode, bpm, markers: [] };
  const at = (t: number) => ({ source: clip.sourceOffset + (t - clip.offset), beat: fb0 + beatAtSeconds(tempo, t) - b0 });
  return { mode, bpm, markers: [at(clip.offset), ...changes.map((s) => at(s.seconds)), at(clip.offset + span)] };
}

/** A warp at a tempo of the file's own: its beats from where the clip
 * starts. */
export function warpAtTempo(warp: AudioWarp, bpm: number): AudioWarp {
  return { ...warp, bpm, markers: [] };
}

/** The warp of the file back to front (`fileSeconds` long). */
export function reverseWarp(warp: AudioWarp, fileSeconds: number): AudioWarp {
  if (warp.markers.length === 0) return warp;
  const total = fileBeatAt(warp, fileSeconds);
  return { ...warp, markers: cleanMarkers(warp.markers.map((m) => ({ source: fileSeconds - m.source, beat: total - m.beat }))) };
}

/** A warped clip's place moved from one tempo map to another: it stays on
 * its beats, like a MIDI clip (tempoEdits.ts). */
export function remapWarped<C extends WarpedClip>(clip: C, remap: (t: number) => number): C {
  const offset = remap(clip.offset);
  return {
    ...clip,
    offset,
    length: remap(clip.offset + clip.length) - offset,
    loopLength: clip.loopLength ? remap(clip.offset + clip.loopLength) - offset : clip.loopLength,
  };
}

/** How long (s) a clip runs to reach `sourceEnd` in its file, from its start. */
function lengthToSource(clip: WarpedClip, sourceEnd: number, tempo: TempoMap): number {
  if (!clip.warp) return sourceEnd - clip.sourceOffset;
  const beats = fileBeatAt(clip.warp, sourceEnd) - fileBeatAt(clip.warp, clip.sourceOffset);
  return secondsAtBeat(tempo, beatAtSeconds(tempo, clip.offset) + beats) - clip.offset;
}

/** The clip with another warp (or none): it plays the same part of its
 * file as before, so its box (and its loop) grows or shrinks to fit. */
export function rewarp<C extends WarpedClip>(clip: C, warp: AudioWarp | undefined, tempo: TempoMap): C {
  const loop = loopOf(clip);
  const played = playedSource(clip, tempo);
  const next = { ...clip, warp };
  if (!warp) delete next.warp;
  const span = lengthToSource(next, played.end, tempo);
  if (!(span > EPS)) return next;
  if (!loop) return { ...next, length: span };
  return { ...next, loopLength: span, length: (clip.length * span) / loop };
}

/** A warp that puts each onset (a point in the file where a note or hit
 * starts, onsets.ts) on the nearest line of a grid `gridBeats` apart - or
 * `strength` of the way there - with a marker at each, the clip's start
 * and end where they are. What doesn't have an onset is spread evenly
 * between. Quantizing audio. */
export function quantizedWarp(clip: WarpedClip & { warp: AudioWarp }, onsets: readonly number[], tempo: TempoMap, gridBeats: number, strength = 1): AudioWarp {
  const { warp } = clip;
  const b0 = beatAtSeconds(tempo, clip.offset);
  const fb0 = fileBeatAt(warp, clip.sourceOffset);
  const played = playedSource(clip, tempo);
  // Song beats for file beats, from the clip's start.
  const songBeat = (s: number) => b0 + fileBeatAt(warp, s) - fb0;
  const markers: WarpMarker[] = [{ source: clip.sourceOffset, beat: fb0 }];
  onsets
    // Not on the clip's ends: they stay.
    .filter((s) => s > played.start + 0.01 && s < played.end - 0.01)
    .forEach((s) => {
      const at = songBeat(s);
      const line = gridBeats > 0 ? Math.round(at / gridBeats) * gridBeats : at;
      markers.push({ source: s, beat: fb0 + at + strength * (line - at) - b0 });
    });
  markers.push({ source: played.end, beat: fileBeatAt(warp, played.end) });
  return { ...warp, markers: cleanMarkers(markers) };
}

export interface WarpView {
  bpm: number;
  mode: AudioWarp["mode"];
  /** What it plays (warpPieces). */
  pieces: WarpPiece[];
  /** File seconds a second where it starts: how far a slip drag moves
   * what plays. */
  speed: number;
  /** Where its markers are, in seconds from its start (inside it). */
  markers: number[];
}

const views = new WeakMap<object, { tempo: TempoMap; view: WarpView }>();

/** A warped clip's warp, for drawing it (the same object while the clip
 * and the map are the same); undefined for an unwarped one. */
export function warpView(clip: AudioClipInstance, tempo: TempoMap): WarpView | undefined {
  if (!clip.warp) return undefined;
  const hit = views.get(clip);
  if (hit && hit.tempo === tempo) return hit.view;
  const pieces = warpPieces(clip, tempo);
  const first = pieces[0];
  const speed = first && first.t1 - first.t0 > EPS ? (first.s1 - first.s0) / (first.t1 - first.t0) : 1;
  const b0 = beatAtSeconds(tempo, clip.offset);
  const fb0 = fileBeatAt(clip.warp, clip.sourceOffset);
  const markers = clip.warp.markers
    .map((m) => secondsAtBeat(tempo, b0 + m.beat - fb0) - clip.offset)
    .filter((t) => t > 1e-3 && t < (loopOf(clip) || clip.length) - 1e-3);
  const view = { bpm: clip.warp.bpm, mode: clip.warp.mode, pieces, speed, markers };
  views.set(clip, { tempo, view });
  return view;
}
