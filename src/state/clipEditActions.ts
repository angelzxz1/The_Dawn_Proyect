// Naming, coloring and processing clips: rename, color, fade presets,
// normalize, reverse and consolidate. Each is one undo step over whatever
// clips (and tracks) it touches. Reversing and consolidating audio make a
// new file first (engine/clipAudio.ts), so those finish a moment later;
// the clip edits themselves are in project/clipEdits.ts.

import { audioEngine } from "@/engine/audioEngine";
import { decodeAudioFile, type DecodedAudioClip } from "@/engine/audioFile";
import { decodeSamples, renderClips, reverseChannels, reversedSourceOffset, type ClipSource } from "@/engine/clipAudio";
import { loadWaveform, waveformSpan } from "@/engine/waveform";
import { encodeWav } from "@/export/wav";
import {
  cleanClipName,
  clipLabel,
  consolidateMidi,
  firstClipIn,
  normalizeGain,
  presetFades,
  reverseNotes,
  taggedFileName,
  type FadePreset,
} from "@/project/clipEdits";
import { HEX_COLOR } from "@/project/colors";
import { clearRange, type TimeRange } from "@/project/timeRange";
import { bpmAtSeconds, type TempoMap } from "@/project/tempoMap";
import { followingWarp, playedSource, quantizedWarp, reverseWarp, rewarp, warpAtTempo, warpPieces } from "@/project/warp";
import { detectOnsets } from "@/engine/onsets";
import { clampBpm } from "@/project/tempoMap";
import { detectTempo } from "@/engine/tempoDetect";
import type { AudioWarp } from "@/project/types";
import { renderInSteps } from "@/engine/timeStretch";
import type { AudioClipInstance, ClipInstance } from "@/project/types";
import { noteIssue } from "@/services/issues";
import { audioBlobs } from "./audioBlobs";
import { newClipId } from "./ids";
import { currentTempo, projectStore } from "./projectStore";
import { changeTracks } from "./trackClips";

/** The clips in `ids`, wherever they are. */
function clipsIn(ids: ReadonlySet<string>): ClipInstance[] {
  return Object.values(projectStore.get().clipsByChannel).flatMap((clips) => clips.filter((c) => ids.has(c.id)));
}

const isAudio = (c: ClipInstance): c is AudioClipInstance => c.kind === "audio";

/** Changes the clips in `ids` as one undo step (`change` gives back the
 * clip itself when there's nothing to change); returns whether any did. */
function changeClips(ids: ReadonlySet<string>, change: (clip: ClipInstance) => ClipInstance, audio?: Map<string, Blob>): boolean {
  const { clipsByChannel } = projectStore.get();
  const tracks = Object.keys(clipsByChannel).filter((id) => clipsByChannel[id].some((c) => ids.has(c.id)));
  return changeTracks(
    tracks,
    (clips) => {
      const next = clips.map((c) => (ids.has(c.id) ? change(c) : c));
      return next.some((c, i) => c !== clips[i]) ? next : clips;
    },
    audio
  );
}

/** A clip with its name or color set, or taken off (undefined). */
function relabel(clip: ClipInstance, key: "name" | "color", value: string | undefined): ClipInstance {
  if (clip[key] === value) return clip;
  const next = { ...clip };
  if (value) next[key] = value;
  else delete next[key];
  return next;
}

/** A clip's file: the audio kept for saving it, else what its URL plays. */
async function fileOf(clip: AudioClipInstance): Promise<Blob | null> {
  const kept = audioBlobs.get(clip.id);
  if (kept) return kept;
  if (!clip.url) return null;
  return (await fetch(clip.url)).blob();
}

/** Each clip's file as samples at `sampleRate`, each file decoded once. A
 * clip whose audio can't be had is left out (it renders as silence). */
/** A warped clip's source as what it plays (its file stretched, loop and
 * all): to mix it like an unwarped clip starting its file there. */
async function warpedSource(source: ClipSource, tempo: TempoMap, sampleRate: number): Promise<ClipSource> {
  const { clip, channels } = source;
  if (!clip.warp) return source;
  const frames = Math.max(1, Math.round(clip.length * sampleRate));
  const played = await renderInSteps(channels, sampleRate, warpPieces(clip, tempo), frames, clip.warp.mode);
  return { clip: { ...clip, sourceOffset: 0, loopLength: null, warp: undefined }, channels: played };
}

async function decodeAll(clips: AudioClipInstance[], sampleRate: number): Promise<ClipSource[]> {
  const byUrl = new Map<string, Promise<Float32Array[] | null>>();
  const sources: ClipSource[] = [];
  for (const clip of clips) {
    let pending = byUrl.get(clip.url);
    if (!pending) {
      pending = fileOf(clip)
        .then((file) => (file ? decodeSamples(file, sampleRate) : null))
        .catch((error) => {
          noteIssue("clip.decode", error);
          return null;
        });
      byUrl.set(clip.url, pending);
    }
    const channels = await pending;
    if (channels) sources.push({ clip, channels });
  }
  return sources;
}

/** Samples as a new file a clip can play: saved as 32-bit float, so a mix
 * that peaks above full scale isn't clipped. */
async function newFile(channels: Float32Array[], sampleRate: number): Promise<{ blob: Blob; decoded: DecodedAudioClip }> {
  const blob = encodeWav(channels, sampleRate, 32);
  return { blob, decoded: await decodeAudioFile(blob) };
}

const overlaps = (c: ClipInstance, span: TimeRange) => c.offset < span.end && c.offset + c.length > span.start;

export const clipEditActions = {
  /** Names a clip; an empty name gives it back the one it shows by itself. */
  rename(clipId: string, name: string): boolean {
    const clean = cleanClipName(name);
    return changeClips(new Set([clipId]), (c) => relabel(c, "name", clean));
  },

  /** Colors clips ("#rrggbb"), or gives them back their track's (null). */
  recolor(ids: ReadonlySet<string>, color: string | null): boolean {
    if (color !== null && !HEX_COLOR.test(color)) return false;
    return changeClips(ids, (c) => relabel(c, "color", color?.toLowerCase() ?? undefined));
  },

  /** Audio clips' fades from a preset (clipEdits.ts), at the tempo where
   * each clip starts. */
  setFades(ids: ReadonlySet<string>, preset: FadePreset, tempo: TempoMap, beatsPerBar: number): boolean {
    return changeClips(ids, (c) => {
      if (!isAudio(c)) return c;
      const { fadeIn, fadeOut } = presetFades(preset, c.length, bpmAtSeconds(tempo, c.offset), beatsPerBar);
      return fadeIn === c.fadeIn && fadeOut === c.fadeOut ? c : { ...c, fadeIn, fadeOut };
    });
  },

  // --- Warping (warp.ts): each change keeps the part of the file a clip
  // plays, its box growing or shrinking to fit. ---

  /** Warps audio clips (they follow the tempo from now on, sounding as
   * they do now) or unwarps them (they play at their own speed). */
  setWarp(ids: ReadonlySet<string>, on: boolean): boolean {
    const tempo = currentTempo();
    return changeClips(ids, (c) => {
      if (!isAudio(c) || !!c.warp === on) return c;
      return rewarp(c, on ? followingWarp(c, tempo) : undefined, tempo);
    });
  },

  /** Stretch (keeps the pitch) or repitch (like tape). */
  setWarpMode(ids: ReadonlySet<string>, mode: AudioWarp["mode"]): boolean {
    return changeClips(ids, (c) => (isAudio(c) && c.warp && c.warp.mode !== mode ? { ...c, warp: { ...c.warp, mode } } : c));
  },

  /** Gives audio clips their file's own tempo (warping them if they
   * weren't): they play at the song's tempo, beat for beat, from where
   * they start. */
  setClipTempo(ids: ReadonlySet<string>, bpm: number): boolean {
    const tempo = currentTempo();
    const value = clampBpm(bpm);
    return changeClips(ids, (c) => {
      if (!isAudio(c)) return c;
      const warp = warpAtTempo(c.warp ?? followingWarp(c, tempo), value);
      return rewarp(c, warp, tempo);
    });
  },

  /** Finds each audio clip's tempo in what it plays (tempoDetect.ts) and
   * gives it that one. Returns the tempos found, by clip id (null where
   * there's no clear beat). */
  async detectTempo(ids: ReadonlySet<string>): Promise<Map<string, number | null>> {
    const tempo = currentTempo();
    const sampleRate = audioEngine.sampleRate;
    const found = new Map<string, number | null>();
    for (const { clip, channels } of await decodeAll(clipsIn(ids).filter(isAudio), sampleRate)) {
      const { start, end } = playedSource(clip, tempo);
      const from = Math.max(0, Math.round(start * sampleRate));
      const to = Math.max(from, Math.round(end * sampleRate));
      found.set(clip.id, detectTempo(channels.map((ch) => ch.subarray(from, to)), sampleRate)?.bpm ?? null);
    }
    const tempos = [...found].filter((entry): entry is [string, number] => entry[1] !== null);
    if (tempos.length > 0) {
      const byId = new Map(tempos);
      changeClips(new Set(byId.keys()), (c) => {
        if (!isAudio(c) || !byId.has(c.id)) return c;
        return rewarp(c, warpAtTempo(c.warp ?? followingWarp(c, tempo), byId.get(c.id)!), tempo);
      });
    }
    return found;
  },

  /** Puts the notes and hits in audio clips on the grid (`gridBeats`
   * apart): their onsets are found (onsets.ts), and each clip warped so
   * they land on the nearest line (warp.ts quantizedWarp). Returns how many
   * onsets were moved, all told. */
  async quantize(ids: ReadonlySet<string>, gridBeats: number): Promise<number> {
    const tempo = currentTempo();
    const sampleRate = audioEngine.sampleRate;
    const warps = new Map<string, AudioWarp>();
    let moved = 0;
    for (const { clip, channels } of await decodeAll(clipsIn(ids).filter(isAudio), sampleRate)) {
      const { start, end } = playedSource(clip, tempo);
      const from = Math.max(0, Math.round(start * sampleRate));
      const to = Math.max(from, Math.round(end * sampleRate));
      const onsets = detectOnsets(channels.map((ch) => ch.subarray(from, to)), sampleRate).map((t) => start + t);
      if (onsets.length === 0) continue;
      const warped = { ...clip, warp: clip.warp ?? followingWarp(clip, tempo) };
      const warp = quantizedWarp(warped, onsets, tempo, gridBeats);
      moved += Math.max(0, warp.markers.length - 2);
      warps.set(clip.id, warp);
    }
    if (warps.size > 0) changeClips(new Set(warps.keys()), (c) => (isAudio(c) && warps.has(c.id) ? { ...c, warp: warps.get(c.id) } : c));
    return moved;
  },

  /** Takes away audio clips' warp markers (a quantize's, say): they play
   * at their own tempo again from where they start. */
  clearWarpMarkers(ids: ReadonlySet<string>): boolean {
    const tempo = currentTempo();
    return changeClips(ids, (c) => (isAudio(c) && c.warp && c.warp.markers.length > 0 ? rewarp(c, warpAtTempo(c.warp, c.warp.bpm), tempo) : c));
  },

  /** Sets each audio clip's gain so what it plays peaks at full scale;
   * returns how many it changed. */
  async normalize(ids: ReadonlySet<string>): Promise<number> {
    const gains = new Map<string, number>();
    for (const clip of clipsIn(ids).filter(isAudio)) {
      const waveform = clip.url ? await loadWaveform(clip.url) : null;
      const { start, end } = playedSource(clip, currentTempo());
      const span = waveform ? waveformSpan(waveform, start, end) : null;
      const gain = span ? normalizeGain(Math.max(-span[0], span[1])) : null;
      if (gain !== null) gains.set(clip.id, gain);
    }
    changeClips(new Set(gains.keys()), (c) => (isAudio(c) && gains.has(c.id) && c.gainDb !== gains.get(c.id) ? { ...c, gainDb: gains.get(c.id)! } : c));
    return gains.size;
  },

  /** Plays clips back to front: a MIDI clip's notes are turned around, an
   * audio clip gets its file reversed (and a new id, its audio being new -
   * the old clip, which undo brings back, keeps its own). Returns the new
   * ids, by old id. */
  async reverse(ids: ReadonlySet<string>): Promise<Map<string, string>> {
    const sampleRate = audioEngine.sampleRate;
    const sources = await decodeAll(clipsIn(ids).filter(isAudio), sampleRate);
    const files = new Map<string, { blob: Blob; decoded: DecodedAudioClip }>();
    for (const { clip, channels } of sources) {
      if (!files.has(clip.url)) files.set(clip.url, await newFile(reverseChannels(channels), sampleRate));
    }
    const audio = new Map([...files.values()].map((f) => [f.decoded.url, f.blob]));
    const renamed = new Map<string, string>();
    changeClips(
      ids,
      (c) => {
        if (c.kind === "midi") return { ...c, notes: reverseNotes(c) };
        const file = files.get(c.url);
        if (!file) return c;
        const id = newClipId();
        renamed.set(c.id, id);
        const { url, peaks, durationSeconds } = file.decoded;
        // A warped clip's file turns around with its warp.
        const played = playedSource(c, currentTempo());
        return {
          ...c,
          id,
          url,
          peaks,
          durationSeconds,
          sourceOffset: c.warp ? Math.max(0, durationSeconds - played.end) : reversedSourceOffset(c, durationSeconds),
          ...(c.warp ? { warp: reverseWarp(c.warp, durationSeconds) } : {}),
          fileName: taggedFileName(c.fileName, "reversed", true),
        };
      },
      audio
    );
    return renamed;
  },

  /** Joins each track's clips over its span into one clip exactly as long
   * (Ableton's consolidate): a MIDI track's notes, an audio track's audio
   * rendered to a new file. Returns the new clips' ids. */
  async consolidate(spans: Map<string, TimeRange>): Promise<string[]> {
    const state = projectStore.get();
    const typeOf = (id: string) => state.channels.find((c) => c.id === id)?.type;
    const sampleRate = audioEngine.sampleRate;
    const tempo = currentTempo();
    const rendered = new Map<string, AudioClipInstance>();
    const audio = new Map<string, Blob>();
    for (const [channelId, span] of spans) {
      if (typeOf(channelId) !== "audio") continue;
      const clips = (state.clipsByChannel[channelId] ?? []).filter(isAudio).filter((c) => overlaps(c, span));
      if (clips.length === 0) continue;
      const sources = await Promise.all((await decodeAll(clips, sampleRate)).map((source) => warpedSource(source, tempo, sampleRate)));
      const { blob, decoded } = await newFile(renderClips(sources, span, sampleRate), sampleRate);
      const first = firstClipIn(clips, span) as AudioClipInstance;
      // Made of warped clips, it's warped too: as it sounds now, following
      // the tempo from here on.
      const warped = clips.find((c) => c.warp);
      const joined: AudioClipInstance = {
        ...clipLabel(first),
        id: newClipId(),
        kind: "audio",
        offset: span.start,
        length: span.end - span.start,
        url: decoded.url,
        fileName: taggedFileName(first.fileName, "consolidated"),
        durationSeconds: decoded.durationSeconds,
        peaks: decoded.peaks,
        sourceOffset: 0,
        fadeIn: 0,
        fadeOut: 0,
        gainDb: 0,
        loopLength: null,
      };
      rendered.set(channelId, warped?.warp ? { ...joined, warp: followingWarp(joined, tempo, warped.warp.mode) } : joined);
      audio.set(decoded.url, blob);
    }
    const made: string[] = [];
    changeTracks(
      [...spans.keys()],
      (clips, channelId) => {
        const span = spans.get(channelId)!;
        const joined = rendered.get(channelId);
        if (joined) {
          made.push(joined.id);
          return [...clearRange(clips, span, newClipId, currentTempo()), joined];
        }
        if (typeOf(channelId) !== "midi") return clips;
        const next = consolidateMidi(clips, span, newClipId);
        if (next !== clips) made.push(next[next.length - 1].id);
        return next;
      },
      audio
    );
    return made;
  },
};
