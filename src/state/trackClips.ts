// Changing the clips on several tracks as one undo step, with the engine
// following and every new audio clip keeping the audio it plays (for
// saving): what time-selection edits (rangeActions.ts) and clip processing
// (clipEditActions.ts) both do.

import { audioEngine } from "@/engine/audioEngine";
import { syncClips } from "@/engine/engineSync";
import type { ProjectState } from "@/project/project";
import type { ClipInstance } from "@/project/types";
import { audioBlobs } from "./audioBlobs";
import { audioClipsOf, projectStore } from "./projectStore";

/** Each audio file still in use (on the tracks or in their takes), by URL
 * - what a new part of an audio clip keeps for saving. */
export function audioByUrl(state: ProjectState): Map<string, Blob> {
  const byUrl = new Map<string, Blob>();
  audioClipsOf(state).forEach((c) => {
    const blob = audioBlobs.get(c.id);
    if (blob) byUrl.set(c.url, blob);
  });
  return byUrl;
}

/** Gives each new audio clip in `clips` the audio it plays, by its URL. */
export function keepAudio(clips: ClipInstance[], byUrl: Map<string, Blob>): void {
  clips.forEach((c) => {
    if (c.kind !== "audio" || audioBlobs.get(c.id)) return;
    const blob = byUrl.get(c.url);
    if (blob) audioBlobs.set(c.id, blob);
  });
}

/** Changes some tracks' clips as one undo step; returns whether anything
 * changed. `audio` is audio, by URL, to give new clips that play it (a
 * pasted range's, a file just rendered). */
export function changeTracks(channelIds: string[], change: (clips: ClipInstance[], channelId: string) => ClipInstance[], audio?: Map<string, Blob>): boolean {
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
  const byUrl = new Map([...(audio ?? []), ...audioByUrl(state)]);
  changed.forEach((id) => keepAudio(next[id], byUrl));
  projectStore.push();
  projectStore.set("clipsByChannel", next);
  changed.forEach((id) => {
    const channel = state.channels.find((c) => c.id === id);
    if (channel) syncClips(audioEngine, channel, state.clipsByChannel[id] ?? [], next[id]);
  });
  return true;
}
