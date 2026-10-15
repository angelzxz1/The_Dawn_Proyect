// A track's takes and its comp (project/takes.ts): filing a finished
// recording as takes, putting a part of a take in the comp, deleting takes,
// and showing or hiding a track's take lanes. Changes to the clips are one
// undo step each; the engine follows the track's lane (takes don't play).

import { audioEngine } from "@/engine/audioEngine";
import { syncClips } from "@/engine/engineSync";
import { compFrom, recordTakes, removeTake, spanOf } from "@/project/takes";
import type { TimeRange } from "@/project/timeRange";
import type { ClipInstance, TakeLane } from "@/project/types";
import { audioBlobs } from "./audioBlobs";
import { newClipId, newTakeLaneId } from "./ids";
import { projectStore } from "./projectStore";
import { audioByUrl, keepAudio } from "./trackClips";

const lanesOf = (channelId: string): TakeLane[] => projectStore.get().takesByChannel[channelId] ?? [];

/** Sets a track's lane and takes as one undo step, the engine following;
 * `audio` is the audio of new clips that play a new file (a recording). */
function changeTrack(channelId: string, main: ClipInstance[], lanes: TakeLane[], audio?: Map<string, Blob>): void {
  const state = projectStore.get();
  const channel = state.channels.find((c) => c.id === channelId);
  const before = state.clipsByChannel[channelId] ?? [];
  const lanesBefore = state.takesByChannel[channelId] ?? [];
  if (!channel || (main === before && lanes === lanesBefore)) return;
  const byUrl = new Map([...(audio ?? []), ...audioByUrl(state)]);
  keepAudio(main, byUrl);
  lanes.forEach((lane) => keepAudio(lane.clips, byUrl));
  projectStore.push();
  projectStore.set("clipsByChannel", (prev) => ({ ...prev, [channelId]: main }));
  if (lanes !== lanesBefore) {
    projectStore.set("takesByChannel", (prev) => {
      const next = { ...prev };
      if (lanes.length > 0) next[channelId] = lanes;
      else delete next[channelId];
      return next;
    });
    // A track that's just got its first takes shows them.
    if (lanesBefore.length === 0 && lanes.length > 0 && !channel.showTakes) {
      projectStore.set("channels", (prev) => prev.map((c) => (c.id === channelId ? { ...c, showTakes: true } : c)));
    }
  }
  syncClips(audioEngine, channel, before, main);
}

export const takeActions = {
  /** Files a finished recording on a track: `takes` are its passes, one
   * clip each, in the order recorded (takes.ts recordTakes); `file` is the
   * audio they play. */
  record(channelId: string, takes: ClipInstance[], file?: Blob): void {
    if (takes.length === 0) return;
    const { clipsByChannel } = projectStore.get();
    const next = recordTakes(clipsByChannel[channelId] ?? [], lanesOf(channelId), takes, newClipId, newTakeLaneId);
    const audio = new Map<string, Blob>();
    takes.forEach((t) => {
      if (t.kind === "audio" && file) audio.set(t.url, file);
    });
    // The takes themselves keep the file too.
    if (file) takes.forEach((t) => t.kind === "audio" && audioBlobs.set(t.id, file));
    changeTrack(channelId, next.main, next.lanes, audio);
  },

  /** Puts what a take has between `range`'s ends in the comp, over what's
   * there. */
  comp(channelId: string, laneId: string, range: TimeRange): void {
    const lane = lanesOf(channelId).find((l) => l.id === laneId);
    if (!lane) return;
    const main = projectStore.get().clipsByChannel[channelId] ?? [];
    changeTrack(channelId, compFrom(main, lane, range, newClipId), lanesOf(channelId));
  },

  /** The whole of a take in the comp. */
  useTake(channelId: string, laneId: string): void {
    const span = spanOf(lanesOf(channelId).find((l) => l.id === laneId)?.clips ?? []);
    if (span) takeActions.comp(channelId, laneId, span);
  },

  /** Deletes a take; what the comp has from it stays. */
  deleteTake(channelId: string, laneId: string): void {
    const main = projectStore.get().clipsByChannel[channelId] ?? [];
    const next = removeTake(main, lanesOf(channelId), laneId);
    changeTrack(channelId, next.main, next.lanes);
  },

  /** Deletes all of a track's takes, keeping the comp as it is. */
  deleteAllTakes(channelId: string): void {
    let main = projectStore.get().clipsByChannel[channelId] ?? [];
    let lanes = lanesOf(channelId);
    if (lanes.length === 0) return;
    while (lanes.length > 0) ({ main, lanes } = removeTake(main, lanes, lanes[0].id));
    changeTrack(channelId, main, lanes);
  },

  /** Shows or hides a track's take lanes (a view, so no undo step). */
  toggleShowTakes(channelId: string): void {
    projectStore.set("channels", (prev) => prev.map((c) => (c.id === channelId ? { ...c, showTakes: !c.showTakes } : c)));
  },
};
