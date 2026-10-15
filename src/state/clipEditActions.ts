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
  playedRegion,
  presetFades,
  reverseNotes,
  taggedFileName,
  type FadePreset,
} from "@/project/clipEdits";
import { HEX_COLOR } from "@/project/colors";
import { clearRange, type TimeRange } from "@/project/timeRange";
import type { AudioClipInstance, ClipInstance } from "@/project/types";
import { noteIssue } from "@/services/issues";
import { audioBlobs } from "./audioBlobs";
import { newClipId } from "./ids";
import { projectStore } from "./projectStore";
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

  /** Audio clips' fades from a preset (clipEdits.ts). */
  setFades(ids: ReadonlySet<string>, preset: FadePreset, bpm: number, beatsPerBar: number): boolean {
    return changeClips(ids, (c) => {
      if (!isAudio(c)) return c;
      const { fadeIn, fadeOut } = presetFades(preset, c.length, bpm, beatsPerBar);
      return fadeIn === c.fadeIn && fadeOut === c.fadeOut ? c : { ...c, fadeIn, fadeOut };
    });
  },

  /** Sets each audio clip's gain so what it plays peaks at full scale;
   * returns how many it changed. */
  async normalize(ids: ReadonlySet<string>): Promise<number> {
    const gains = new Map<string, number>();
    for (const clip of clipsIn(ids).filter(isAudio)) {
      const waveform = clip.url ? await loadWaveform(clip.url) : null;
      const { start, end } = playedRegion(clip);
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
        return {
          ...c,
          id,
          url,
          peaks,
          durationSeconds,
          sourceOffset: reversedSourceOffset(c, durationSeconds),
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
    const rendered = new Map<string, AudioClipInstance>();
    const audio = new Map<string, Blob>();
    for (const [channelId, span] of spans) {
      if (typeOf(channelId) !== "audio") continue;
      const clips = (state.clipsByChannel[channelId] ?? []).filter(isAudio).filter((c) => overlaps(c, span));
      if (clips.length === 0) continue;
      const { blob, decoded } = await newFile(renderClips(await decodeAll(clips, sampleRate), span, sampleRate), sampleRate);
      const first = firstClipIn(clips, span) as AudioClipInstance;
      rendered.set(channelId, {
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
      });
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
          return [...clearRange(clips, span, newClipId), joined];
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
