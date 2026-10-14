// The open project as a saved document and back: what Save and autosave
// write (the song, its last undo steps, the audio and effect files they
// use), and making a loaded document the open project.

import { bumpEffectIdCounter } from "@/engine/audioEngine";
import { referencedEffectFiles, registerEffectFile, effectFileBlob } from "@/effects/effectFiles";
import type { ProjectState } from "@/project/project";
import {
  MAX_SAVED_HISTORY,
  deserializeClips,
  referencedClipIds,
  serializeClips,
  serializeSnapshot,
  type ProjectDocument,
  type SavedHistory,
  type SerializedSnapshot,
} from "@/project/projectFiles";
import { PROJECT_VERSION, type SerializedProject } from "@/project/projectSchema";
import { audioBlobs } from "./audioBlobs";
import { bumpIdFrom } from "./ids";
import { projectStore } from "./projectStore";

/** What's saved with a project but kept by the studio rather than the
 * project store (no undo): the limiter ceiling, scale, snap, count-in,
 * metronome, the arrangement loop and which tracks are monitoring. */
export type SessionSettings = Pick<
  SerializedProject,
  "masterLimiterThreshold" | "scaleSetting" | "snapResolution" | "countInBars" | "metronomeEnabled" | "loop" | "monitoredTracks"
>;

/** The project as saved (clips without their session-only URLs). */
export function serializeProject(doc: ProjectState, session: SessionSettings): SerializedProject {
  return { ...doc, ...session, version: PROJECT_VERSION, savedAt: Date.now(), clipsByChannel: serializeClips(doc.clipsByChannel) };
}

const effectListsOf = (st: Pick<ProjectState, "channelEffects" | "busEffects" | "masterEffects">) => [
  ...Object.values(st.channelEffects),
  ...Object.values(st.busEffects),
  st.masterEffects,
];

/** The files autosave keeps with the working copy: every clip's audio, and
 * the effect files (IRs, amp models) the project uses. */
export function autosaveBlobs(doc: ProjectState): Map<string, Blob> {
  const blobs = audioBlobs.snapshot();
  referencedEffectFiles(effectListsOf(doc), doc.channels).forEach((ref) => {
    const blob = effectFileBlob(ref.id);
    if (blob) blobs.set(ref.id, blob);
  });
  return blobs;
}

/** Everything Save writes: the song, the last undo/redo steps, and the
 * audio and effect files either of them uses. */
export function documentToSave(project: SerializedProject, name: string): ProjectDocument {
  const steps = projectStore.allSteps();
  const history: SavedHistory = {
    past: steps.past.slice(-MAX_SAVED_HISTORY).map(serializeSnapshot),
    future: steps.future.slice(-MAX_SAVED_HISTORY).map(serializeSnapshot),
  };
  const clipIds = referencedClipIds({ project, history });
  const blobs = new Map<string, Blob>();
  audioBlobs.forEach((blob, id) => {
    if (clipIds.has(id)) blobs.set(id, blob);
  });
  const all: SerializedSnapshot[] = [project, ...history.past, ...history.future];
  referencedEffectFiles(
    all.flatMap(effectListsOf),
    all.flatMap((st) => st.channels)
  ).forEach((ref) => {
    const blob = effectFileBlob(ref.id);
    if (blob) blobs.set(ref.id, blob);
  });
  return { name, project, history, blobs };
}

/** Makes a document (the working copy, a folder, a project file, a
 * template) the open project, with its undo history; the previous
 * project's audio is let go of. Returns the project as opened - the
 * studio then rebuilds the engine from it (hydrateEngine). */
export function openInStore(project: SerializedProject, blobs: Map<string, Blob>, history: SavedHistory | null): ProjectState {
  const oldUrls = new Set<string>();
  const steps = projectStore.allSteps();
  [steps.doc, ...steps.past, ...steps.future].forEach((st) =>
    Object.values(st.clipsByChannel).forEach((list) =>
      list.forEach((c) => {
        if (c.kind === "audio" && c.url) oldUrls.add(c.url);
      })
    )
  );
  oldUrls.forEach((u) => URL.revokeObjectURL(u));
  audioBlobs.clear();

  // One playable URL per recording or imported file, shared by the song
  // and its history.
  const urls = new Map<string, string>();
  const urlFor = (id: string) => {
    let url = urls.get(id);
    if (url) return url;
    const blob = blobs.get(id);
    if (!blob) return "";
    url = URL.createObjectURL(blob);
    urls.set(id, url);
    audioBlobs.set(id, blob);
    return url;
  };
  const snapshots: SerializedSnapshot[] = [project, ...(history?.past ?? []), ...(history?.future ?? [])];
  // New ids must never collide with restored ones.
  let maxEffectN = 0;
  snapshots.forEach((snap) => {
    Object.values(snap.clipsByChannel).forEach((list) => list.forEach((c) => bumpIdFrom(c.id)));
    snap.channels.forEach((c) => {
      bumpIdFrom(c.id);
      (c.automationLanes ?? []).forEach((lane) => bumpIdFrom(lane.id));
    });
    snap.buses.forEach((b) => bumpIdFrom(b.id));
    effectListsOf(snap)
      .flat()
      .forEach((fx) => {
        const match = fx.id.match(/^fx-(\d+)$/);
        if (match) maxEffectN = Math.max(maxEffectN, parseInt(match[1], 10));
      });
    referencedEffectFiles(effectListsOf(snap), snap.channels).forEach((ref) => {
      const blob = blobs.get(ref.id);
      if (blob) registerEffectFile(ref.id, blob);
    });
  });
  bumpEffectIdCounter(maxEffectN);

  const toState = (snap: SerializedSnapshot): ProjectState => ({
    channels: snap.channels,
    clipsByChannel: deserializeClips(snap.clipsByChannel, urlFor),
    channelEffects: snap.channelEffects,
    buses: snap.buses,
    busEffects: snap.busEffects,
    bpm: snap.bpm,
    timeSignature: snap.timeSignature,
    masterVolume: snap.masterVolume,
    masterPan: snap.masterPan,
    masterName: snap.masterName,
    masterEffects: snap.masterEffects,
  });
  const state = toState(project);
  projectStore.load(state, (history?.past ?? []).map(toState), (history?.future ?? []).map(toState));
  return state;
}
