// Autosave: the project's JSON state plus every audio clip's raw source
// bytes, persisted to IndexedDB so a page refresh doesn't lose the project.
// Object URLs (what a clip actually plays from) don't survive a reload, so
// only the underlying Blob is stored - a fresh URL gets minted for each
// audio clip when the project is loaded back.

import type { ChannelConfig, NoteEvent, TimeSignature } from "./types";
import type { EffectInstance } from "./effects";
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
}

interface SerializedAudioClip {
  id: string;
  kind: "audio";
  offset: number;
  length: number;
  fileName: string;
  durationSeconds: number;
  peaks: number[];
}

export type SerializedClip = SerializedMidiClip | SerializedAudioClip;

export interface SerializedProject {
  version: 1;
  savedAt: number;
  channels: ChannelConfig[];
  clipsByChannel: Record<string, SerializedClip[]>;
  channelEffects: Record<string, EffectInstance[]>;
  bpm: number;
  timeSignature: TimeSignature;
  masterVolume: number;
  masterPan: number;
  masterName: string;
  masterLimiterThreshold: number;
  scaleSetting: ScaleSetting;
  snapResolution: SnapResolution;
  countInBars: number;
  metronomeEnabled: boolean;
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
    return { project, blobs };
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
