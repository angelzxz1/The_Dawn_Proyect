// The open project - its tracks, clips, effects, buses, master and tempo -
// with its undo/redo history. Kept outside React so any part of the app can
// read it (always current, never a stale closure) and change it; components
// subscribe to the parts they show (useProjectField).
//
// Undo/redo covers the document, not the view (playhead, zoom, selection),
// as in a DAW. A step is a snapshot of the whole document: every change
// makes new objects for what it changes, so a snapshot shares everything
// else with the steps around it.

import { useSyncExternalStore } from "react";
import type { ProjectState } from "@/project/project";
import { audioBlobs } from "./audioBlobs";
import { createChannel } from "./ids";

const MAX_HISTORY = 100;

type Updater<T> = T | ((prev: T) => T);

function initialProject(): ProjectState {
  return {
    channels: [createChannel("MIDI 1", "midi"), createChannel("MIDI 2", "midi"), createChannel("Audio 1", "audio")],
    clipsByChannel: {},
    channelEffects: {},
    buses: [],
    busEffects: {},
    bpm: 120,
    timeSignature: { numerator: 4, denominator: 4 },
    masterVolume: 0,
    masterPan: 0,
    masterName: "Master",
    masterEffects: [],
  };
}

class ProjectStore {
  private doc: ProjectState = initialProject();
  private past: ProjectState[] = [];
  private future: ProjectState[] = [];
  private listeners = new Set<() => void>();
  /** Bumped whenever the history changes (for Undo/Redo buttons). */
  private historyVersion = 0;

  get(): ProjectState {
    return this.doc;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private emit(): void {
    this.listeners.forEach((fn) => fn());
  }

  /** Changes one part of the document (a value, or a function of the
   * current one, like React's setState). */
  set<K extends keyof ProjectState>(key: K, value: Updater<ProjectState[K]>): void {
    const prev = this.doc[key];
    const nextValue = typeof value === "function" ? (value as (p: ProjectState[K]) => ProjectState[K])(prev) : value;
    if (Object.is(nextValue, prev)) return;
    this.doc = { ...this.doc, [key]: nextValue };
    this.emit();
  }

  /** Replaces the whole document (undo/redo, opening a project). */
  replace(doc: ProjectState): void {
    this.doc = doc;
    this.emit();
  }

  // --- History ---

  /** Records the document as it is now as an undo step - call before
   * changing it (or as a drag starts), so the step is the "before". */
  push(): void {
    this.past.push(this.doc);
    const evicted = this.past.length > MAX_HISTORY ? [this.past.shift()!] : [];
    const discardedFuture = this.future;
    this.future = [];
    this.releaseUnreachableAudio([...evicted, ...discardedFuture]);
    this.historyChanged();
  }

  /** Steps back; returns the restored document (to rebuild the engine). */
  undo(): ProjectState | null {
    const prev = this.past.pop();
    if (!prev) return null;
    this.future.push(this.doc);
    this.replace(prev);
    this.historyChanged();
    return prev;
  }

  redo(): ProjectState | null {
    const next = this.future.pop();
    if (!next) return null;
    this.past.push(this.doc);
    this.replace(next);
    this.historyChanged();
    return next;
  }

  /** Opens a document with its saved history. */
  load(doc: ProjectState, past: ProjectState[], future: ProjectState[]): void {
    this.past = past;
    this.future = future;
    this.replace(doc);
    this.historyChanged();
  }

  /** The document and its history steps, oldest first. */
  allSteps(): { doc: ProjectState; past: readonly ProjectState[]; future: readonly ProjectState[] } {
    return { doc: this.doc, past: this.past, future: this.future };
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  getHistoryVersion = (): number => this.historyVersion;

  private historyChanged(): void {
    this.historyVersion += 1;
    this.emit();
  }

  /** Lets go of an audio clip's file and URL once no step can bring the
   * clip back. Deleting a clip doesn't do this: undo has to bring back its
   * audio, not just its box, so the audio outlives the delete until the
   * step that could restore it is itself gone. */
  private releaseUnreachableAudio(discarded: ProjectState[]): void {
    if (discarded.length === 0) return;
    const reachable = new Set<string>();
    const collect = (s: ProjectState) =>
      Object.values(s.clipsByChannel).forEach((clips) => clips.forEach((c) => c.kind === "audio" && reachable.add(c.id)));
    collect(this.doc);
    this.past.forEach(collect);
    this.future.forEach(collect);
    discarded.forEach((s) =>
      Object.values(s.clipsByChannel).forEach((clips) =>
        clips.forEach((c) => {
          if (c.kind === "audio" && !reachable.has(c.id)) {
            URL.revokeObjectURL(c.url);
            audioBlobs.delete(c.id);
          }
        })
      )
    );
  }
}

export const projectStore = new ProjectStore();

const getDoc = () => projectStore.get();

/** The whole document, for what follows every part of it (saving). */
export function useProjectDoc(): ProjectState {
  return useSyncExternalStore(projectStore.subscribe, getDoc, getDoc);
}

/** One part of the document (re-renders when it changes). */
export function useProjectValue<K extends keyof ProjectState>(key: K): ProjectState[K] {
  return useSyncExternalStore(
    projectStore.subscribe,
    () => projectStore.get()[key],
    () => projectStore.get()[key]
  );
}

/** A setter for one part of the document - takes a value or a function of
 * the current one, like React's setState, and is the same function every
 * time (no need to list it as a hook dependency). */
export function projectSetter<K extends keyof ProjectState>(key: K): (value: Updater<ProjectState[K]>) => void {
  return (value) => projectStore.set(key, value);
}

/** Whether there's anything to undo or redo (re-renders when that changes). */
export function useHistoryState(): { canUndo: boolean; canRedo: boolean } {
  useSyncExternalStore(projectStore.subscribe, projectStore.getHistoryVersion, projectStore.getHistoryVersion);
  return { canUndo: projectStore.canUndo, canRedo: projectStore.canRedo };
}
