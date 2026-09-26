// Autosave: the project's JSON state plus every audio clip's raw source
// bytes, persisted to IndexedDB so a page refresh doesn't lose the project.
// Object URLs (what a clip actually plays from) don't survive a reload, so
// only the underlying Blob is stored - a fresh URL gets minted for each
// audio clip when the project is loaded back.

import type { BusConfig, ChannelConfig, NoteEvent, TimeSignature } from "./types";
import type { EffectInstance } from "./effects";
import { legacyFilterTypeToMode, migrateLegacyFilterParams } from "./filterModel";
import type { ScaleSetting } from "./scales";
import type { SnapResolution } from "./timeline";

const DB_NAME = "dawn-project-db";
const DB_VERSION = 1;
const META_STORE = "meta";
const BLOB_STORE = "audioBlobs";
const PROJECT_KEY = "current";

interface SerializedMidiClip {
  id: string;
  kind: "midi";
  offset: number;
  length: number;
  notes: NoteEvent[];
  loopLength?: number | null;
}

interface SerializedAudioClip {
  id: string;
  kind: "audio";
  offset: number;
  length: number;
  fileName: string;
  durationSeconds: number;
  peaks: number[];
  sourceOffset: number;
  fadeIn: number;
  fadeOut: number;
  gainDb: number;
  loopLength?: number | null;
}

export type SerializedClip = SerializedMidiClip | SerializedAudioClip;

export interface SerializedProject {
  version: 1;
  savedAt: number;
  channels: ChannelConfig[];
  clipsByChannel: Record<string, SerializedClip[]>;
  channelEffects: Record<string, EffectInstance[]>;
  buses?: BusConfig[];
  busEffects?: Record<string, EffectInstance[]>;
  bpm: number;
  timeSignature: TimeSignature;
  masterVolume: number;
  masterPan: number;
  masterName: string;
  masterLimiterThreshold: number;
  masterEffects?: EffectInstance[];
  scaleSetting: ScaleSetting;
  snapResolution: SnapResolution;
  countInBars: number;
  metronomeEnabled: boolean;
}

/** Brings a project saved by an older version up to date. Currently: a
 * Filter effect's old single "type" knob becomes the plugin's `mode` (plus
 * its dB-style Q becomes linear) - including any automation lane recorded
 * on that knob. */
function migrateProject(project: SerializedProject): SerializedProject {
  const legacyFilterIds = new Set<string>();
  const migrate = (effects: EffectInstance[]) =>
    effects.map((fx) => {
      if (fx.type !== "filter") return fx;
      const params = migrateLegacyFilterParams(fx.params);
      if (params === fx.params) return fx;
      legacyFilterIds.add(fx.id);
      return { ...fx, params };
    });

  const channelEffects = Object.fromEntries(
    Object.entries(project.channelEffects).map(([id, effects]) => [id, migrate(effects)])
  );
  const busEffects = project.busEffects
    ? Object.fromEntries(Object.entries(project.busEffects).map(([id, effects]) => [id, migrate(effects)]))
    : undefined;
  const masterEffects = project.masterEffects ? migrate(project.masterEffects) : undefined;

  const channels = project.channels.map((channel) => {
    if (!channel.automationLanes?.length || legacyFilterIds.size === 0) return channel;
    return {
      ...channel,
      automationLanes: channel.automationLanes.map((lane) =>
        lane.target.kind === "effect" && lane.target.paramKey === "type" && legacyFilterIds.has(lane.target.effectId)
          ? {
              ...lane,
              target: { ...lane.target, paramKey: "mode" },
              points: lane.points.map((pt) => ({ ...pt, value: legacyFilterTypeToMode(pt.value) })),
            }
          : lane
      ),
    };
  });

  return { ...project, channels, channelEffects, busEffects, masterEffects };
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE);
      if (!db.objectStoreNames.contains(BLOB_STORE)) db.createObjectStore(BLOB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Writes the project JSON and replaces the entire audio-blob store with
 * exactly `audioBlobs` (keyed by clip id) - simplest way to guarantee no
 * orphaned blobs pile up from deleted clips without tracking deletions
 * separately.
 */
export async function saveProject(
  project: SerializedProject,
  audioBlobs: Map<string, Blob>
): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([META_STORE, BLOB_STORE], "readwrite");
      tx.objectStore(META_STORE).put(project, PROJECT_KEY);
      tx.objectStore(BLOB_STORE).clear();
      audioBlobs.forEach((blob, id) => tx.objectStore(BLOB_STORE).put(blob, id));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function loadProject(): Promise<
  { project: SerializedProject; blobs: Map<string, Blob> } | null
> {
  const db = await openDb();
  try {
    const project = await new Promise<SerializedProject | undefined>((resolve, reject) => {
      const tx = db.transaction(META_STORE, "readonly");
      const req = tx.objectStore(META_STORE).get(PROJECT_KEY);
      req.onsuccess = () => resolve(req.result as SerializedProject | undefined);
      req.onerror = () => reject(req.error);
    });
    if (!project) return null;

    const blobs = new Map<string, Blob>();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(BLOB_STORE, "readonly");
      const store = tx.objectStore(BLOB_STORE);
      const req = store.openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          blobs.set(String(cursor.key), cursor.value as Blob);
          cursor.continue();
        } else {
          resolve();
        }
      };
      req.onerror = () => reject(req.error);
    });
    return { project: migrateProject(project), blobs };
  } finally {
    db.close();
  }
}

export async function clearSavedProject(): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([META_STORE, BLOB_STORE], "readwrite");
      tx.objectStore(META_STORE).clear();
      tx.objectStore(BLOB_STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
