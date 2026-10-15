// What you can do to a span of time across tracks (Ableton's time
// selection): clear it, cut or copy it, paste a copied one, duplicate it,
// insert silence, take the time out. Each is one undo step over every
// track it touches; the engine follows, and every new audio clip (a part of
// one that was cut) keeps the audio it plays, for saving. A group's lane
// stands for its tracks. The clip edits themselves are in
// project/timeRange.ts.

import { audioEngine } from "@/engine/audioEngine";
import { syncClips } from "@/engine/engineSync";
import { clearRange, deleteTime, extractRange, insertTime, placeRange, type TimeRange } from "@/project/timeRange";
import type { ProjectState } from "@/project/project";
import type { ClipInstance } from "@/project/types";
import { audioBlobs } from "./audioBlobs";
import { copyRange, getCopiedRange } from "./clipboard";
import { newClipId } from "./ids";
import { projectStore } from "./projectStore";

/** A time selection: a span of time on some tracks' lanes. */
export interface TimeSelection extends TimeRange {
  channelIds: string[];
}

/** The tracks with clips that a selection's lanes stand for: a group's lane
 * for the tracks in it (and in groups in it). */
export function tracksOf(channelIds: string[], state: ProjectState = projectStore.get()): string[] {
  const out = new Set<string>();
  const add = (id: string) => {
    const channel = state.channels.find((c) => c.id === id);
    if (!channel || out.has(id)) return;
    if (channel.type === "group") state.channels.filter((c) => c.groupId === id).forEach((m) => add(m.id));
    else out.add(id);
  };
  channelIds.forEach(add);
  return [...out];
}

/** Each audio file still in use, by URL - what a new part of an audio clip
 * keeps for saving. */
function audioByUrl(state: ProjectState): Map<string, Blob> {
  const byUrl = new Map<string, Blob>();
  Object.values(state.clipsByChannel).forEach((clips) =>
    clips.forEach((c) => {
      const blob = c.kind === "audio" ? audioBlobs.get(c.id) : undefined;
      if (blob && c.kind === "audio") byUrl.set(c.url, blob);
    })
  );
  return byUrl;
}

/** Changes some tracks' clips as one undo step; returns whether anything
 * changed. `audio` is audio to give new clips that play it (a pasted
 * range's). */
function changeTracks(channelIds: string[], change: (clips: ClipInstance[], channelId: string) => ClipInstance[], audio?: Map<string, Blob>): boolean {
  const state = projectStore.get();
  const next = { ...state.clipsByChannel };
  const changed = channelIds.filter((id) => {
    const before = next[id] ?? [];
    const after = change(before, id);
    if (after === before) return false;
    next[id] = after;
    return true;
  });
  if (changed.length === 0) return false;
  const byUrl = audioByUrl(state);
  changed.forEach((id) =>
    next[id].forEach((c) => {
      if (c.kind !== "audio" || audioBlobs.get(c.id)) return;
      const blob = byUrl.get(c.url) ?? audio?.get(c.url);
      if (blob) audioBlobs.set(c.id, blob);
    })
  );
  projectStore.push();
  projectStore.set("clipsByChannel", next);
  changed.forEach((id) => {
    const channel = state.channels.find((c) => c.id === id);
    if (channel) syncClips(audioEngine, channel, state.clipsByChannel[id] ?? [], next[id]);
  });
  return true;
}

const lengthOf = (range: TimeRange) => range.end - range.start;

export const rangeActions = {
  /** Empties the range on the selection's tracks. */
  clear(selection: TimeSelection): boolean {
    return changeTracks(tracksOf(selection.channelIds), (clips) => clearRange(clips, selection, newClipId));
  },

  /** Copies what's in the range on the selection's tracks (Ctrl/Cmd+V puts
   * it back on the same tracks, at the playhead or a selection's start). */
  copy(selection: TimeSelection): void {
    const state = projectStore.get();
    const tracks = tracksOf(selection.channelIds, state).map((channelId) => ({
      channelId,
      clips: extractRange(state.clipsByChannel[channelId] ?? [], selection, newClipId),
    }));
    copyRange({ length: lengthOf(selection), lanes: selection.channelIds, tracks, audio: audioByUrl(state) });
  },

  cut(selection: TimeSelection): boolean {
    rangeActions.copy(selection);
    return rangeActions.clear(selection);
  },

  /** Lays the copied range down at `at` on the tracks it was copied from,
   * over what's there; returns where it went (to select it). */
  paste(at: number): TimeSelection | null {
    const copied = getCopiedRange();
    if (!copied) return null;
    const existing = new Set(projectStore.get().channels.map((c) => c.id));
    const tracks = copied.tracks.filter((t) => existing.has(t.channelId));
    if (tracks.length === 0) return null;
    const contentOf = new Map(tracks.map((t) => [t.channelId, t.clips]));
    const start = Math.max(0, at);
    changeTracks(
      tracks.map((t) => t.channelId),
      (clips, channelId) => placeRange(clips, contentOf.get(channelId) ?? [], start, copied.length, newClipId),
      copied.audio
    );
    const lanes = copied.lanes.filter((id) => existing.has(id));
    return { start, end: start + copied.length, channelIds: lanes.length ? lanes : tracks.map((t) => t.channelId) };
  },

  /** Copies the range right after itself, over what's there; returns the
   * copy's range (so duplicating again carries on). */
  duplicate(selection: TimeSelection): TimeSelection {
    const length = lengthOf(selection);
    changeTracks(tracksOf(selection.channelIds), (clips) => placeRange(clips, extractRange(clips, selection, newClipId), selection.end, length, newClipId));
    return { ...selection, start: selection.end, end: selection.end + length };
  },

  /** Opens a gap as long as the range at its start: everything from there
   * on moves later. */
  insertSilence(selection: TimeSelection): boolean {
    return changeTracks(tracksOf(selection.channelIds), (clips) => insertTime(clips, selection.start, lengthOf(selection), newClipId));
  },

  /** Takes the range out: everything after it moves earlier. */
  deleteTime(selection: TimeSelection): boolean {
    return changeTracks(tracksOf(selection.channelIds), (clips) => deleteTime(clips, selection, newClipId));
  },
};
