// Projects on disk. A project is a folder the user picks, laid out like a
// DAW project folder:
//
//   My Song/
//     project.dawn.json   the song (the same data the browser autosave keeps)
//     history.json        the undo/redo history, so it survives reopening
//     Samples/            recordings, imported audio, IRs and amp models
//
// Folders need the File System Access API (Chrome, Edge, Opera). Other
// browsers save and open the same project as a single .dawnproject file
// (a small bundle: a JSON header followed by the files' bytes).
//
// Recent projects are remembered by their folder handles, in IndexedDB.

import type { ProjectState } from "./project";
import { PROJECT_VERSION, normalizeProject, type SerializedClip, type SerializedProject } from "./projectSchema";
import type { AudioClipInstance, ClipInstance, MidiClipInstance } from "./types";

export const PROJECT_FILE = "project.dawn.json";
export const HISTORY_FILE = "history.json";
export const SAMPLES_DIR = "Samples";
export const BUNDLE_EXTENSION = ".dawnproject";
/** Undo/redo steps kept on disk (each way). */
export const MAX_SAVED_HISTORY = 50;

/** One undo/redo step as saved: the document part of a project. */
export type SerializedSnapshot = Pick<
  SerializedProject,
  "channels" | "clipsByChannel" | "channelEffects" | "buses" | "busEffects" | "bpm" | "timeSignature" | "masterVolume" | "masterPan" | "masterName" | "masterEffects"
>;

export interface SavedHistory {
  past: SerializedSnapshot[];
  future: SerializedSnapshot[];
}

/** Everything a saved project holds. */
export interface ProjectDocument {
  name: string;
  project: SerializedProject;
  history: SavedHistory | null;
  /** Clip audio and effect files, by id. */
  blobs: Map<string, Blob>;
}

// --- Clips and snapshots ---

/** Clips as saved (an audio clip's playable URL is session-only; its audio
 * is saved separately, by clip id). */
export function serializeClips(clipsByChannel: Record<string, ClipInstance[]>): Record<string, SerializedClip[]> {
  const out: Record<string, SerializedClip[]> = {};
  Object.entries(clipsByChannel).forEach(([chId, clips]) => {
    out[chId] = clips.map((c) =>
      c.kind === "audio"
        ? {
            id: c.id,
            kind: "audio" as const,
            offset: c.offset,
            length: c.length,
            fileName: c.fileName,
            durationSeconds: c.durationSeconds,
            peaks: c.peaks,
            sourceOffset: c.sourceOffset,
            fadeIn: c.fadeIn,
            fadeOut: c.fadeOut,
            gainDb: c.gainDb,
            loopLength: c.loopLength,
          }
        : { id: c.id, kind: "midi" as const, offset: c.offset, length: c.length, notes: c.notes, loopLength: c.loopLength }
    );
  });
  return out;
}

/** Saved clips back as live ones; `urlFor` gives an audio clip's playable
 * URL (empty if its audio is missing). */
export function deserializeClips(clips: Record<string, SerializedClip[]>, urlFor: (id: string) => string): Record<string, ClipInstance[]> {
  const out: Record<string, ClipInstance[]> = {};
  Object.entries(clips).forEach(([chId, list]) => {
    out[chId] = list.map((c): ClipInstance => {
      if (c.kind === "audio") {
        const audio: AudioClipInstance = { ...c, loopLength: c.loopLength ?? null, url: urlFor(c.id) };
        return audio;
      }
      const midi: MidiClipInstance = { ...c, loopLength: c.loopLength ?? null };
      return midi;
    });
  });
  return out;
}

export function serializeSnapshot(s: ProjectState): SerializedSnapshot {
  return {
    channels: s.channels,
    clipsByChannel: serializeClips(s.clipsByChannel),
    channelEffects: s.channelEffects,
    buses: s.buses,
    busEffects: s.busEffects,
    bpm: s.bpm,
    timeSignature: s.timeSignature,
    masterVolume: s.masterVolume,
    masterPan: s.masterPan,
    masterName: s.masterName,
    masterEffects: s.masterEffects,
  };
}

/** A saved undo step, repaired like a project (see projectSchema.ts), or
 * null if it isn't one. `base` fills in the parts a step doesn't keep. */
export function normalizeSnapshot(raw: unknown, base: SerializedProject): SerializedSnapshot | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const p = normalizeProject({ ...base, ...(raw as object), version: PROJECT_VERSION });
  if (!p) return null;
  return {
    channels: p.channels,
    clipsByChannel: p.clipsByChannel,
    channelEffects: p.channelEffects,
    buses: p.buses,
    busEffects: p.busEffects,
    bpm: p.bpm,
    timeSignature: p.timeSignature,
    masterVolume: p.masterVolume,
    masterPan: p.masterPan,
    masterName: p.masterName,
    masterEffects: p.masterEffects,
  };
}

function normalizeHistory(raw: unknown, base: SerializedProject): SavedHistory | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { past?: unknown; future?: unknown };
  const list = (v: unknown) =>
    (Array.isArray(v) ? v : [])
      .map((s) => normalizeSnapshot(s, base))
      .filter((s): s is SerializedSnapshot => !!s)
      .slice(-MAX_SAVED_HISTORY);
  return { past: list(r.past), future: list(r.future) };
}

/** Every clip id a project or its history refers to (for deciding which
 * files to keep). */
export function referencedClipIds(doc: Pick<ProjectDocument, "project" | "history">): Set<string> {
  const ids = new Set<string>();
  const add = (s: Pick<SerializedSnapshot, "clipsByChannel">) => Object.values(s.clipsByChannel).forEach((l) => l.forEach((c) => ids.add(c.id)));
  add(doc.project);
  doc.history?.past.forEach(add);
  doc.history?.future.forEach(add);
  return ids;
}

// --- File names ---

const EXTENSIONS: Record<string, string> = {
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/ogg": "ogg",
  "audio/flac": "flac",
  "audio/x-flac": "flac",
  "audio/aac": "aac",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/webm": "webm",
  "application/json": "json",
};

export function fileNameFor(id: string, blob: Blob): string {
  const ext = EXTENSIONS[blob.type.split(";")[0]] ?? "bin";
  return `${id.replace(/[^\w.-]/g, "_")}.${ext}`;
}

/** A folder or file name made from a project name. */
export function safeName(name: string): string {
  return name.trim().replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").slice(0, 80) || "Untitled";
}

// --- Folders (File System Access API) ---

interface DirectoryHandle {
  kind: "directory";
  name: string;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<DirectoryHandle>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileHandle>;
  removeEntry(name: string): Promise<void>;
  keys(): AsyncIterable<string>;
  isSameEntry?(other: DirectoryHandle): Promise<boolean>;
  queryPermission?(d: { mode: "readwrite" }): Promise<PermissionState>;
  requestPermission?(d: { mode: "readwrite" }): Promise<PermissionState>;
}
interface FileHandle {
  kind: "file";
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(data: Blob | string): Promise<void>; close(): Promise<void> }>;
}
export type ProjectFolder = DirectoryHandle;

type PickerWindow = { showDirectoryPicker?: (o?: { mode?: "readwrite"; id?: string }) => Promise<DirectoryHandle> };

export function supportsFolders(): boolean {
  return typeof window !== "undefined" && typeof (window as unknown as PickerWindow).showDirectoryPicker === "function";
}

/** Brave is Chromium but ships with the folder API turned off (it can be
 * turned on at brave://flags/#file-system-access-api). */
export function isBrave(): boolean {
  return typeof navigator !== "undefined" && "brave" in navigator;
}

async function pickDirectory(): Promise<DirectoryHandle | null> {
  try {
    return await (window as unknown as PickerWindow).showDirectoryPicker!({ mode: "readwrite", id: "dawn-projects" });
  } catch {
    return null; // cancelled
  }
}

/** Makes sure we may write to a folder picked in an earlier session (asks,
 * which needs a click). */
export async function ensurePermission(dir: ProjectFolder): Promise<boolean> {
  if (!dir.queryPermission) return true;
  if ((await dir.queryPermission({ mode: "readwrite" })) === "granted") return true;
  return (await dir.requestPermission?.({ mode: "readwrite" })) === "granted";
}

async function hasEntry(dir: DirectoryHandle, name: string): Promise<boolean> {
  for await (const key of dir.keys()) if (key === name) return true;
  return false;
}

/** Asks where to put a new project and creates its folder there (a name
 * that's taken gets " 2", " 3"...). Null if cancelled. */
export async function createProjectFolder(name: string): Promise<ProjectFolder | null> {
  const parent = await pickDirectory();
  if (!parent) return null;
  const base = safeName(name);
  let folderName = base;
  for (let n = 2; await hasEntry(parent, folderName); n++) folderName = `${base} ${n}`;
  return parent.getDirectoryHandle(folderName, { create: true });
}

/** Asks for an existing project folder. Null if cancelled; throws if the
 * folder isn't a project. */
export async function pickProjectFolder(): Promise<ProjectFolder | null> {
  const dir = await pickDirectory();
  if (!dir) return null;
  if (!(await hasEntry(dir, PROJECT_FILE))) throw new Error(`"${dir.name}" isn't a project folder (it has no ${PROJECT_FILE}).`);
  return dir;
}

async function writeFile(dir: DirectoryHandle, name: string, data: Blob | string): Promise<void> {
  const file = await dir.getFileHandle(name, { create: true });
  const w = await file.createWritable();
  await w.write(data);
  await w.close();
}

/** Writes a project into its folder: the song, the history, and any
 * sample not already there; samples nothing refers to any more are
 * removed. */
export async function saveToFolder(dir: ProjectFolder, doc: ProjectDocument): Promise<void> {
  const samples = await dir.getDirectoryHandle(SAMPLES_DIR, { create: true });
  const existing = new Set<string>();
  for await (const key of samples.keys()) existing.add(key);
  const files: Record<string, string> = {};
  const keep = new Set<string>();
  for (const [id, blob] of doc.blobs) {
    const name = fileNameFor(id, blob);
    files[id] = name;
    keep.add(name);
    // Clip audio never changes under the same id, so a file that's there
    // is already right.
    if (!existing.has(name)) await writeFile(samples, name, blob);
  }
  // The song last, so a save that fails halfway never points at samples
  // that aren't there.
  await writeFile(dir, HISTORY_FILE, JSON.stringify(doc.history ?? { past: [], future: [] }));
  await writeFile(dir, PROJECT_FILE, JSON.stringify({ ...doc.project, name: doc.name, files }, null, 1));
  for (const name of existing) if (!keep.has(name)) await samples.removeEntry(name).catch(() => {});
}

export async function loadFromFolder(dir: ProjectFolder): Promise<ProjectDocument> {
  const raw = JSON.parse(await (await (await dir.getFileHandle(PROJECT_FILE)).getFile()).text());
  const project = normalizeProject(raw);
  if (!project) throw new Error(`${PROJECT_FILE} isn't a readable project.`);
  const files = (raw && typeof raw.files === "object" ? raw.files : {}) as Record<string, unknown>;
  const blobs = new Map<string, Blob>();
  const samples = await dir.getDirectoryHandle(SAMPLES_DIR).catch(() => null);
  if (samples) {
    for (const [id, name] of Object.entries(files)) {
      if (typeof name !== "string") continue;
      const file = await samples
        .getFileHandle(name)
        .then((h) => h.getFile())
        .catch(() => null);
      if (file) blobs.set(id, file);
    }
  }
  let history: SavedHistory | null = null;
  try {
    history = normalizeHistory(JSON.parse(await (await (await dir.getFileHandle(HISTORY_FILE)).getFile()).text()), project);
  } catch {
    // No history, or an unreadable one: the project still opens.
  }
  return { name: typeof raw.name === "string" && raw.name ? raw.name : dir.name, project, history, blobs };
}

// --- Single-file bundles (browsers without folder access) ---

const MAGIC = "DAWNPRJ1";

/** The whole project in one file: magic, a JSON header (the project, its
 * history and a table of files), then the files' bytes. */
export async function encodeBundle(doc: ProjectDocument): Promise<Blob> {
  const entries: { id: string; type: string; offset: number; size: number }[] = [];
  let offset = 0;
  for (const [id, blob] of doc.blobs) {
    entries.push({ id, type: blob.type, offset, size: blob.size });
    offset += blob.size;
  }
  const header = new TextEncoder().encode(JSON.stringify({ name: doc.name, project: doc.project, history: doc.history, files: entries }));
  const len = new Uint8Array(4);
  new DataView(len.buffer).setUint32(0, header.length, true);
  return new Blob([MAGIC, len, header, ...doc.blobs.values()], { type: "application/octet-stream" });
}

export async function decodeBundle(file: Blob): Promise<ProjectDocument> {
  const head = new Uint8Array(await file.slice(0, MAGIC.length + 4).arrayBuffer());
  if (new TextDecoder().decode(head.subarray(0, MAGIC.length)) !== MAGIC) throw new Error("That isn't a project file.");
  const len = new DataView(head.buffer, head.byteOffset + MAGIC.length, 4).getUint32(0, true);
  const start = MAGIC.length + 4;
  const header = JSON.parse(new TextDecoder().decode(await file.slice(start, start + len).arrayBuffer()));
  const project = normalizeProject(header?.project);
  if (!project) throw new Error("The project in that file can't be read.");
  const dataStart = start + len;
  const blobs = new Map<string, Blob>();
  for (const e of Array.isArray(header.files) ? header.files : []) {
    if (typeof e?.id !== "string" || typeof e.offset !== "number" || typeof e.size !== "number") continue;
    blobs.set(e.id, file.slice(dataStart + e.offset, dataStart + e.offset + e.size, typeof e.type === "string" ? e.type : ""));
  }
  const name = typeof header.name === "string" && header.name ? header.name : "Untitled";
  return { name, project, history: normalizeHistory(header.history, project), blobs };
}

// --- Recent projects and the open project (IndexedDB) ---

const DB_NAME = "dawn-projects";
const STORE = "handles";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idb<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest | void): Promise<T | undefined> {
  const db = await openDb();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req ? (req.result as T) : undefined);
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export interface RecentProject {
  name: string;
  folder: ProjectFolder;
  openedAt: number;
}

export async function recentProjects(): Promise<RecentProject[]> {
  return ((await idb<RecentProject[]>("readonly", (s) => s.get("recent")).catch(() => undefined)) ?? []).filter((r) => r?.folder);
}

export async function rememberRecent(name: string, folder: ProjectFolder): Promise<void> {
  const list = await recentProjects();
  const others: RecentProject[] = [];
  for (const r of list) {
    const same = folder.isSameEntry ? await folder.isSameEntry(r.folder).catch(() => false) : r.folder.name === folder.name;
    if (!same) others.push(r);
  }
  await idb("readwrite", (s) => s.put([{ name, folder, openedAt: Date.now() }, ...others].slice(0, 8), "recent")).catch(() => {});
}

export async function forgetRecent(folder: ProjectFolder): Promise<void> {
  const list = await recentProjects();
  const keep: RecentProject[] = [];
  for (const r of list) {
    const same = folder.isSameEntry ? await folder.isSameEntry(r.folder).catch(() => false) : r.folder === folder;
    if (!same) keep.push(r);
  }
  await idb("readwrite", (s) => s.put(keep, "recent")).catch(() => {});
}

/** What's open, so a page reload keeps working on the same project. */
export interface OpenProjectInfo {
  name: string;
  folder: ProjectFolder | null;
  /** Unsaved changes at the time of the last autosave. */
  dirty: boolean;
}

export async function readOpenProject(): Promise<OpenProjectInfo | null> {
  return (await idb<OpenProjectInfo>("readonly", (s) => s.get("open")).catch(() => undefined)) ?? null;
}

export async function writeOpenProject(info: OpenProjectInfo): Promise<void> {
  await idb("readwrite", (s) => s.put(info, "open")).catch(() => {});
}
