// Autosave: the project's JSON state plus every audio clip's raw source
// bytes, persisted to IndexedDB so a page refresh doesn't lose the project.
// Object URLs (what a clip actually plays from) don't survive a reload, so
// only the underlying Blob is stored - a fresh URL gets minted for each
// audio clip when the project is loaded back.

import { normalizeProject, type SerializedProject } from "./projectSchema";

export type { SerializedClip, SerializedProject } from "./projectSchema";

const DB_NAME = "dawn-project-db";
const DB_VERSION = 1;
const META_STORE = "meta";
const BLOB_STORE = "audioBlobs";
const PROJECT_KEY = "current";
const BACKUP_PREFIX = "backup:";
const MAX_BACKUPS = 3;

/** A saved project that couldn't be opened, kept exactly as it was stored
 * (with its audio) so nothing is lost when the app starts fresh instead. */
export interface ProjectBackup {
  createdAt: number;
  reason: string;
  project: unknown;
  blobs: [string, Blob][];
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

/** The stored project, cleaned up for the current version (see
 * projectSchema.ts). `project` is null if what's stored isn't readable as
 * a project at all; `raw` is always exactly what was stored, for backups. */
export async function loadProject(): Promise<
  { raw: unknown; project: SerializedProject | null; blobs: Map<string, Blob> } | null
> {
  const db = await openDb();
  try {
    const raw = await new Promise<unknown>((resolve, reject) => {
      const tx = db.transaction(META_STORE, "readonly");
      const req = tx.objectStore(META_STORE).get(PROJECT_KEY);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    if (raw === undefined) return null;

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
    let project: SerializedProject | null = null;
    try {
      project = normalizeProject(raw);
    } catch {
      project = null;
    }
    return { raw, project, blobs };
  } finally {
    db.close();
  }
}

/** Stores `raw` (and its audio) as a backup, keeping only the newest few. */
export async function backupProject(raw: unknown, blobs: Map<string, Blob>, reason: string): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(META_STORE, "readwrite");
      const store = tx.objectStore(META_STORE);
      const backup: ProjectBackup = { createdAt: Date.now(), reason, project: raw, blobs: [...blobs] };
      store.put(backup, `${BACKUP_PREFIX}${backup.createdAt}`);
      const keysReq = store.getAllKeys();
      keysReq.onsuccess = () => {
        const backups = keysReq.result
          .map(String)
          .filter((k) => k.startsWith(BACKUP_PREFIX))
          .sort();
        backups.slice(0, Math.max(0, backups.length - MAX_BACKUPS)).forEach((k) => store.delete(k));
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/** The most recent backup, if any. */
export async function latestBackup(): Promise<ProjectBackup | null> {
  const db = await openDb();
  try {
    return await new Promise<ProjectBackup | null>((resolve, reject) => {
      const tx = db.transaction(META_STORE, "readonly");
      const store = tx.objectStore(META_STORE);
      const keysReq = store.getAllKeys();
      keysReq.onsuccess = () => {
        const latest = keysReq.result
          .map(String)
          .filter((k) => k.startsWith(BACKUP_PREFIX))
          .sort()
          .pop();
        if (!latest) return resolve(null);
        const req = store.get(latest);
        req.onsuccess = () => resolve((req.result as ProjectBackup) ?? null);
        req.onerror = () => reject(req.error);
      };
      keysReq.onerror = () => reject(keysReq.error);
    });
  } finally {
    db.close();
  }
}

export async function clearSavedProject(): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([META_STORE, BLOB_STORE], "readwrite");
      // Only the current project - backups live in the same store.
      tx.objectStore(META_STORE).delete(PROJECT_KEY);
      tx.objectStore(BLOB_STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
