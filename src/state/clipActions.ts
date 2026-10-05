// What you can do to clips: add (MIDI, audio, a groove), delete, duplicate,
// split, loop, move, resize, fade, gain, edit notes, clear a track, copy
// and paste. Each changes the project and the audio engine together, as
// one undo step where it's an edit (a drag records its step as it starts).
// Which clips are selected is the view's: actions that change it take the
// selection and return the new one.

import { audioEngine } from "@/lib/audioEngine";
import type { DecodedAudioClip } from "@/lib/audioFile";
import { copyClip, getCopiedClip } from "@/lib/clipboard";
import type { AudioClipTiming } from "@/lib/engine/nodes";
import { grooveBeats, grooveKit, grooveNotes, type Groove } from "@/lib/grooves";
import { notesWithinClip } from "@/lib/project";
import type { AudioClipInstance, ChannelType, ClipInstance, MidiClipInstance, NoteEvent } from "@/lib/types";
import { audioBlobs } from "./audioBlobs";
import { newClipId } from "./ids";
import { projectStore } from "./projectStore";

export function isMidiClip(c: ClipInstance): c is MidiClipInstance {
  return c.kind === "midi";
}

/** The engine's timing for an audio clip, from the clip's own fields -
 * every place that (re)schedules a clip's player uses this, so they can't
 * drift apart. */
export function audioClipTiming(clip: AudioClipInstance): AudioClipTiming {
  return {
    offsetSeconds: clip.offset,
    bufferOffsetSeconds: clip.sourceOffset,
    trimSeconds: clip.length,
    loopLength: clip.loopLength,
    fadeIn: clip.fadeIn,
    fadeOut: clip.fadeOut,
  };
}

/** Rebuilds a MIDI track's part from all its clips' notes (each shifted by
 * its clip's offset): the engine plays one flat note list per track, and
 * doesn't know about clips. Called after any change to a MIDI clip. */
export function rebuildMidiPart(channelId: string, midiClips: MidiClipInstance[]): void {
  const flattened: NoteEvent[] = midiClips.flatMap((c) => notesWithinClip(c).map((n) => ({ ...n, time: c.offset + n.time })));
  audioEngine.setClip(channelId, flattened, 0);
}

export const clipsOf = (channelId: string): ClipInstance[] => projectStore.get().clipsByChannel[channelId] ?? [];

const typeOf = (channelId: string): ChannelType => projectStore.get().channels.find((c) => c.id === channelId)?.type ?? "midi";

/** Where a clip added from a track-level action (import, "add" from the
 * header) lands: right after what's already there, not over it. */
export const endOfContent = (channelId: string): number => clipsOf(channelId).reduce((max, c) => Math.max(max, c.offset + c.length), 0);

function setTrackClips(channelId: string, clips: ClipInstance[]): void {
  projectStore.set("clipsByChannel", (prev) => ({ ...prev, [channelId]: clips }));
}

/** Changes one clip and has the engine follow: a MIDI track's part is
 * rebuilt, an audio clip's player re-timed (`retime`, debounced). */
function updateClip(channelId: string, clipId: string, change: (c: ClipInstance) => ClipInstance, retime = true): ClipInstance | undefined {
  const updated = clipsOf(channelId).map((c) => (c.id === clipId ? change(c) : c));
  setTrackClips(channelId, updated);
  const clip = updated.find((c) => c.id === clipId);
  if (clip?.kind === "midi") rebuildMidiPart(channelId, updated.filter(isMidiClip));
  else if (clip?.kind === "audio" && retime) syncAudioClip(channelId, clip);
  return clip;
}

// Re-timing an audio clip's player restarts its buffer source - fine once,
// but a clip's drag handles fire on every pointer move, and restarting it
// that often while playing is a storm of clicks. So the engine catches up
// once the pointer settles (~80 ms); the clip on screen follows at once.
const syncTimers = new Map<string, ReturnType<typeof setTimeout>>();

function syncAudioClip(channelId: string, clip: AudioClipInstance): void {
  const existing = syncTimers.get(clip.id);
  if (existing) clearTimeout(existing);
  syncTimers.set(
    clip.id,
    setTimeout(() => {
      syncTimers.delete(clip.id);
      audioEngine.moveAudioClip(channelId, clip.id, audioClipTiming(clip));
    }, 80)
  );
}

type AudioClipExtras = Partial<Pick<AudioClipInstance, "length" | "sourceOffset" | "fadeIn" | "fadeOut" | "gainDb" | "loopLength">>;

export const clipActions = {
  /** Adds a MIDI clip; returns its id. */
  addMidi(channelId: string, offset: number, length: number, notes: NoteEvent[] = [], loopLength: number | null = null): string {
    projectStore.push();
    const clip: MidiClipInstance = { id: newClipId(), kind: "midi", offset, length, notes, loopLength };
    const updated = [...clipsOf(channelId), clip];
    setTrackClips(channelId, updated);
    rebuildMidiPart(channelId, updated.filter(isMidiClip));
    return clip.id;
  },

  /** Adds an audio clip; returns its id. `sourceBlob` is the clip's file
   * (an import, a recording, a pasted copy's), kept so the project can save
   * the audio itself and not only its object URL, which a reload loses. */
  addAudio(channelId: string, decoded: DecodedAudioClip, offset: number, fileName: string, sourceBlob: Blob, extra?: AudioClipExtras): string {
    projectStore.push();
    const clip: AudioClipInstance = {
      id: newClipId(),
      kind: "audio",
      offset,
      length: extra?.length ?? decoded.durationSeconds,
      url: decoded.url,
      fileName,
      durationSeconds: decoded.durationSeconds,
      peaks: decoded.peaks,
      sourceOffset: extra?.sourceOffset ?? 0,
      fadeIn: extra?.fadeIn ?? 0,
      fadeOut: extra?.fadeOut ?? 0,
      gainDb: extra?.gainDb ?? 0,
      loopLength: extra?.loopLength ?? null,
    };
    audioBlobs.set(clip.id, sourceBlob);
    setTrackClips(channelId, [...clipsOf(channelId), clip]);
    audioEngine.loadAudioClip(channelId, clip.id, decoded.url, audioClipTiming(clip), clip.gainDb);
    return clip.id;
  },

  /** Puts a groove on a MIDI track as a clip at `offset`, at the project's
   * tempo; a track without drums gets the kit the groove was made with.
   * Returns the clip's id (null if it isn't a MIDI track). */
  addGroove(channelId: string, groove: Groove, offset: number): string | null {
    const { channels, bpm } = projectStore.get();
    const channel = channels.find((c) => c.id === channelId);
    if (!channel || channel.type !== "midi") return null;
    projectStore.push();
    if (channel.instrument !== "drums") {
      const drumParams = channel.drumParams ?? structuredClone(grooveKit(groove));
      audioEngine.setInstrument(channelId, "drums", channel.synthParams, drumParams);
      projectStore.set("channels", (prev) => prev.map((c) => (c.id === channelId ? { ...c, instrument: "drums", drumParams } : c)));
    }
    const clip: MidiClipInstance = {
      id: newClipId(),
      kind: "midi",
      offset,
      length: (grooveBeats(groove) * 60) / bpm,
      notes: grooveNotes(groove, bpm),
      loopLength: null,
    };
    const updated = [...clipsOf(channelId), clip];
    setTrackClips(channelId, updated);
    rebuildMidiPart(channelId, updated.filter(isMidiClip));
    return clip.id;
  },

  /** Deletes clips, on whatever tracks they're on, as one undo step. Their
   * audio isn't let go of: the undo step still holds it (projectStore.ts). */
  remove(ids: ReadonlySet<string>): void {
    if (ids.size === 0) return;
    projectStore.push();
    const next = { ...projectStore.get().clipsByChannel };
    Object.entries(next).forEach(([chId, clips]) => {
      if (!clips.some((c) => ids.has(c.id))) return;
      clips.forEach((c) => {
        if (ids.has(c.id) && c.kind === "audio") audioEngine.removeAudioClip(chId, c.id);
      });
      const remaining = clips.filter((c) => !ids.has(c.id));
      next[chId] = remaining;
      if (typeOf(chId) === "midi") rebuildMidiPart(chId, remaining.filter(isMidiClip));
    });
    projectStore.set("clipsByChannel", next);
  },

  /** Duplicates clips, each right after itself on its own track; returns
   * the copies' ids. */
  duplicate(ids: ReadonlySet<string>): Set<string> {
    const copies = new Set<string>();
    if (ids.size === 0) return copies;
    projectStore.push();
    const next = { ...projectStore.get().clipsByChannel };
    Object.entries(next).forEach(([chId, clips]) => {
      const originals = clips.filter((c) => ids.has(c.id));
      if (originals.length === 0) return;
      const additions = originals.map((c): ClipInstance => {
        const id = newClipId();
        copies.add(id);
        const offset = c.offset + c.length;
        if (c.kind === "midi") return { ...c, id, offset, notes: c.notes.map((n) => ({ ...n })) };
        const dup: AudioClipInstance = { ...c, id, offset };
        const blob = audioBlobs.get(c.id);
        if (blob) audioBlobs.set(id, blob);
        audioEngine.loadAudioClip(chId, id, dup.url, audioClipTiming(dup), dup.gainDb);
        return dup;
      });
      next[chId] = [...clips, ...additions];
      if (typeOf(chId) === "midi") rebuildMidiPart(chId, next[chId].filter(isMidiClip));
    });
    projectStore.set("clipsByChannel", next);
    return copies;
  },

  /** Splits a clip in two at `seconds` (on the timeline); returns the two
   * halves' ids, or null if that isn't strictly inside it. The halves keep
   * the clip's outer fades only, and neither loops. */
  split(channelId: string, clipId: string, seconds: number): [string, string] | null {
    const clip = clipsOf(channelId).find((c) => c.id === clipId);
    if (!clip) return null;
    const at = seconds - clip.offset;
    if (at <= 0 || at >= clip.length) return null;
    projectStore.push();
    const firstId = newClipId();
    const secondId = newClipId();
    let first: ClipInstance;
    let second: ClipInstance;
    if (clip.kind === "audio") {
      const firstAudio: AudioClipInstance = { ...clip, id: firstId, length: at, fadeOut: 0, loopLength: null };
      const secondAudio: AudioClipInstance = {
        ...clip,
        id: secondId,
        offset: clip.offset + at,
        length: clip.length - at,
        sourceOffset: clip.sourceOffset + at,
        fadeIn: 0,
        loopLength: null,
      };
      const blob = audioBlobs.get(clip.id);
      if (blob) {
        audioBlobs.set(firstId, blob);
        audioBlobs.set(secondId, blob);
      }
      audioEngine.loadAudioClip(channelId, firstId, clip.url, audioClipTiming(firstAudio), firstAudio.gainDb);
      audioEngine.loadAudioClip(channelId, secondId, clip.url, audioClipTiming(secondAudio), secondAudio.gainDb);
      first = firstAudio;
      second = secondAudio;
    } else {
      const firstNotes = clip.notes.filter((n) => n.time < at).map((n) => ({ ...n, duration: Math.min(n.duration, at - n.time) }));
      const secondNotes = clip.notes.filter((n) => n.time >= at).map((n) => ({ ...n, time: n.time - at }));
      first = { ...clip, id: firstId, length: at, notes: firstNotes, loopLength: null };
      second = { ...clip, id: secondId, offset: clip.offset + at, length: clip.length - at, notes: secondNotes, loopLength: null };
    }
    const updated = clipsOf(channelId).filter((c) => c.id !== clipId).concat([first, second]);
    setTrackClips(channelId, updated);
    if (clip.kind === "audio") {
      audioEngine.removeAudioClip(channelId, clipId);
      audioBlobs.delete(clip.id);
    } else {
      rebuildMidiPart(channelId, updated.filter(isMidiClip));
    }
    return [firstId, secondId];
  },

  /** Turns looping on (the clip's current length becomes what repeats,
   * once you drag its end out past it) or off. */
  toggleLoop(channelId: string, clipId: string): void {
    const clip = clipsOf(channelId).find((c) => c.id === clipId);
    if (!clip) return;
    projectStore.push();
    const loopLength = clip.loopLength ? null : clip.length;
    const updated = updateClip(channelId, clipId, (c) => ({ ...c, loopLength }), false);
    if (updated?.kind === "audio") audioEngine.moveAudioClip(channelId, clipId, audioClipTiming(updated));
  },

  /** Empties a track; returns the ids of the clips it had. */
  clearTrack(channelId: string): string[] {
    const existing = clipsOf(channelId);
    if (existing.length === 0) return [];
    projectStore.push();
    setTrackClips(channelId, []);
    if (typeOf(channelId) === "audio") audioEngine.clearAllAudioClips(channelId);
    else audioEngine.setClip(channelId, [], 0);
    return existing.map((c) => c.id);
  },

  // --- Edits made while dragging or in the piano roll (no undo step here:
  // that's taken as the gesture starts) ---

  setNotes(channelId: string, clipId: string, notes: NoteEvent[]): void {
    updateClip(channelId, clipId, (c) => (c.kind === "midi" ? { ...c, notes } : c));
  },

  /** Moves a clip to `offset`. If it's one of several selected clips, they
   * all move by the same amount, on whatever tracks they're on. */
  move(channelId: string, clipId: string, offset: number, selection: ReadonlySet<string>): void {
    const dragged = clipsOf(channelId).find((c) => c.id === clipId);
    if (!dragged) return;
    const delta = offset - dragged.offset;
    const moved = selection.size > 1 && selection.has(clipId) ? selection : new Set([clipId]);
    const next = { ...projectStore.get().clipsByChannel };
    const touched: string[] = [];
    Object.entries(next).forEach(([chId, clips]) => {
      if (!clips.some((c) => moved.has(c.id))) return;
      touched.push(chId);
      next[chId] = clips.map((c) => (moved.has(c.id) ? { ...c, offset: c.id === clipId ? offset : Math.max(0, c.offset + delta) } : c));
    });
    projectStore.set("clipsByChannel", next);
    touched.forEach((chId) => {
      const clips = next[chId];
      if (typeOf(chId) === "midi") rebuildMidiPart(chId, clips.filter(isMidiClip));
      else
        clips.forEach((c) => {
          if (moved.has(c.id) && c.kind === "audio") syncAudioClip(chId, c);
        });
    });
  },

  /** A clip's length: an audio clip's trims its playback; a MIDI clip's
   * stops the notes past its end from playing. */
  resize(channelId: string, clipId: string, length: number): void {
    updateClip(channelId, clipId, (c) => ({ ...c, length }));
  },

  setFades(channelId: string, clipId: string, fadeIn: number, fadeOut: number): void {
    updateClip(channelId, clipId, (c) => (c.kind === "audio" ? { ...c, fadeIn, fadeOut } : c));
  },

  setGain(channelId: string, clipId: string, gainDb: number): void {
    updateClip(channelId, clipId, (c) => (c.kind === "audio" ? { ...c, gainDb } : c), false);
    audioEngine.setAudioClipGain(channelId, clipId, gainDb);
  },

  // --- Clipboard (clipboard.ts) ---

  copy(clip: ClipInstance): void {
    if (clip.kind === "audio") {
      const { url, fileName, durationSeconds, peaks, length, sourceOffset, fadeIn, fadeOut, gainDb, loopLength } = clip;
      copyClip({ kind: "audio", url, fileName, durationSeconds, peaks, length, sourceOffset, fadeIn, fadeOut, gainDb, loopLength });
    } else {
      copyClip({ kind: "midi", notes: clip.notes, length: clip.length, loopLength: clip.loopLength });
    }
  },

  /** Pastes the copied clip as a new clip at `offset` (if it fits the
   * track: MIDI on MIDI, audio on audio). */
  async paste(channelId: string, offset: number): Promise<void> {
    const copied = getCopiedClip();
    if (!copied || copied.kind !== typeOf(channelId)) return;
    const at = Math.max(0, offset);
    if (copied.kind === "midi") {
      clipActions.addMidi(channelId, at, copied.length, copied.notes, copied.loopLength ?? null);
      return;
    }
    // The pasted clip gets its own copy of the audio file, for saving.
    const blob = await fetch(copied.url).then((r) => r.blob());
    const { url, durationSeconds, peaks, fileName, length, sourceOffset, fadeIn, fadeOut, gainDb, loopLength } = copied;
    clipActions.addAudio(channelId, { url, durationSeconds, peaks }, at, fileName, blob, { length, sourceOffset, fadeIn, fadeOut, gainDb, loopLength });
  },

  /** Replaces a clip's content with the copied clip's, keeping its id and
   * position. */
  async pasteOver(channelId: string, clipId: string): Promise<void> {
    const copied = getCopiedClip();
    if (!copied || copied.kind !== typeOf(channelId)) return;
    const target = clipsOf(channelId).find((c) => c.id === clipId);
    if (!target) return;
    projectStore.push();
    if (copied.kind === "midi") {
      const clip: MidiClipInstance = { id: clipId, kind: "midi", offset: target.offset, length: copied.length, notes: copied.notes, loopLength: copied.loopLength ?? null };
      updateClip(channelId, clipId, () => clip);
      return;
    }
    const blob = await fetch(copied.url).then((r) => r.blob());
    audioBlobs.set(clipId, blob);
    const { url, fileName, durationSeconds, peaks, length, sourceOffset, fadeIn, fadeOut, gainDb, loopLength } = copied;
    const clip: AudioClipInstance = { id: clipId, kind: "audio", offset: target.offset, length, url, fileName, durationSeconds, peaks, sourceOffset, fadeIn, fadeOut, gainDb, loopLength };
    updateClip(channelId, clipId, () => clip, false);
    audioEngine.loadAudioClip(channelId, clipId, url, audioClipTiming(clip), gainDb);
  },
};
