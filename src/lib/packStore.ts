// Installed sound packs: their files kept in this browser (IndexedDB), their
// presets, kits and grooves merged into Dawn's lists (tagged with the pack,
// so removing it takes exactly those away), and "Save my presets as a
// pack" for backups and sharing. See dawnPack.ts for the format.

import { addPackPresets, removePackPresets, userPresets } from "./presets";
import { addPackSynthPresets, removePackSynthPresets, userSynthPresets } from "./synthPresets";
import { addPackKits, ownDrumKits, removePackKits } from "./drumKits";
import { parsePackGrooves, removePackGrooves, setPackGrooves } from "./grooves";
import { decodeEffectFileAudio, discardEffectFile, effectFileBlob, registerEffectFile } from "./effectFiles";
import { parseNamFile } from "./namModel";
import { packFileName, packId, packPathKind, readPack, writePack, type PackFile, type PackManifest } from "./dawnPack";
import type { ToneEntry } from "./tones";

export interface InstalledPack extends PackManifest {
  id: string;
  installedAt: number;
  counts: { effectPresets: number; synthPresets: number; kits: number; grooves: number; irs: number; amps: number; samples: number };
  files: { path: string; fileId: string; kind: "ir" | "nam" | "sample" }[];
  /** As shipped, re-read on every start. */
  grooves: unknown[];
}

// --- IndexedDB ---

const DB_NAME = "dawn-packs";
const PACKS = "packs";
const FILES = "files";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(PACKS, { keyPath: "id" });
      req.result.createObjectStore(FILES);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(stores: string[], mode: IDBTransactionMode, fn: (t: IDBTransaction) => IDBRequest | void): Promise<T | undefined> {
  const db = await openDb();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const t = db.transaction(stores, mode);
      const req = fn(t);
      t.oncomplete = () => resolve(req ? (req.result as T) : undefined);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error ?? new Error("Storage refused the pack (is the disk full?)"));
    });
  } finally {
    db.close();
  }
}

// --- installed list ---

let installed: InstalledPack[] = [];
const listeners = new Set<() => void>();
const changed = (next: InstalledPack[]) => {
  installed = next;
  listeners.forEach((l) => l());
};

export function installedPacks(): InstalledPack[] {
  return installed;
}

export function subscribePacks(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const fileIdFor = (id: string, path: string) => `pack:${id}:${path}`;

/** Loads the installed packs at startup: their files into the file
 * registry and their grooves into the library. */
export async function restorePacks(): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const packs = (await tx<InstalledPack[]>([PACKS], "readonly", (t) => t.objectStore(PACKS).getAll()).catch(() => undefined)) ?? [];
  await Promise.all(
    packs.flatMap((p) =>
      p.files.map(async (f) => {
        const blob = await tx<Blob>([FILES], "readonly", (t) => t.objectStore(FILES).get(f.fileId)).catch(() => undefined);
        if (blob) registerEffectFile(f.fileId, blob);
      })
    )
  );
  packs.forEach((p) => setPackGrooves(p.id, parsePackGrooves(p.grooves, p.id)));
  changed(packs.sort((a, b) => a.name.localeCompare(b.name)));
}

export type InstallResult = { ok: true; pack: InstalledPack; replaced: boolean; skipped: string[] } | { ok: false; error: string };

/** Checks a pack and installs it (replacing an earlier install of the same pack). */
export async function installPack(bytes: Uint8Array, sampleRate: number): Promise<InstallResult> {
  const read = readPack(bytes);
  if (!read.ok) return read;
  const { manifest } = read.pack;
  const id = packId(manifest.name);
  const replaced = installed.some((p) => p.id === id);
  if (replaced) await removePack(id);

  // Every file is checked like one picked by hand; a bad one is skipped.
  const skipped: string[] = [];
  const files: InstalledPack["files"] = [];
  for (const f of read.pack.files) {
    const kind = packPathKind(f.path) as "ir" | "nam" | "sample";
    const fileId = fileIdFor(id, f.path);
    const blob = new Blob([f.data as Uint8Array<ArrayBuffer>]);
    if (kind === "nam") {
      if ("error" in parseNamFile(new TextDecoder().decode(f.data))) {
        skipped.push(f.path);
        continue;
      }
      registerEffectFile(fileId, blob);
    } else {
      registerEffectFile(fileId, blob);
      if (!(await decodeEffectFileAudio(fileId, sampleRate))) {
        discardEffectFile(fileId);
        skipped.push(f.path);
        continue;
      }
    }
    files.push({ path: f.path, fileId, kind });
  }
  const byPath = new Map(files.map((f) => [f.path, f.fileId]));
  const mapFile = (path: string) => byPath.get(path) ?? null;

  const grooves = parsePackGrooves(read.pack.grooves, id);
  const pack: InstalledPack = {
    ...manifest,
    id,
    installedAt: Date.now(),
    files,
    grooves: read.pack.grooves,
    counts: {
      effectPresets: addPackPresets(id, manifest.name, read.pack.effectPresets),
      synthPresets: addPackSynthPresets(id, manifest.name, read.pack.synthPresets, mapFile),
      kits: addPackKits(id, manifest.name, read.pack.kits, mapFile),
      grooves: grooves.reduce((n, g) => n + Object.keys(g.sections).length, 0),
      irs: files.filter((f) => f.kind === "ir").length,
      amps: files.filter((f) => f.kind === "nam").length,
      samples: files.filter((f) => f.kind === "sample").length,
    },
  };
  setPackGrooves(id, grooves);
  try {
    await tx([PACKS, FILES], "readwrite", (t) => {
      files.forEach((f) => t.objectStore(FILES).put(effectFileBlob(f.fileId), f.fileId));
      t.objectStore(PACKS).put(pack);
    });
  } catch (err) {
    await removePack(id);
    return { ok: false, error: `Couldn't store the pack in this browser: ${err instanceof Error ? err.message : String(err)}` };
  }
  changed([...installed.filter((p) => p.id !== id), pack].sort((a, b) => a.name.localeCompare(b.name)));
  return { ok: true, pack, replaced, skipped };
}

/** Removes a pack and everything it added. Projects that used its sounds
 * keep their own copies of the files. */
export async function removePack(id: string): Promise<void> {
  removePackPresets(id);
  removePackSynthPresets(id);
  removePackKits(id);
  removePackGrooves(id);
  const pack = installed.find((p) => p.id === id);
  await tx([PACKS, FILES], "readwrite", (t) => {
    pack?.files.forEach((f) => t.objectStore(FILES).delete(f.fileId));
    t.objectStore(PACKS).delete(id);
  }).catch(() => undefined);
  changed(installed.filter((p) => p.id !== id));
}

/** The installed packs' cabinets and amp captures, for the tone browsers. */
export function packTones(kind: "ir" | "amp"): ToneEntry[] {
  return installed.flatMap((p) =>
    p.files
      .filter((f) => (kind === "ir" ? f.kind === "ir" : f.kind === "nam"))
      .map((f) => ({
        id: f.fileId,
        kind,
        name: f.path.split("/").pop()!.replace(/\.[^.]+$/, ""),
        description: `From the pack "${p.name}"`,
        creator: p.author,
        ...(p.url ? { creatorUrl: p.url } : {}),
        license: p.license,
      }))
  );
}

/** "Save my presets as a pack": your own effect presets, Daybreak presets
 * and drum kits, with the samples and wavetables they use (when they're
 * loaded in this session). Things that came from packs aren't included. */
export async function buildMyPresetsPack(info: { name: string; author: string; license: string }): Promise<{
  bytes: Uint8Array;
  counts: { effectPresets: number; synthPresets: number; kits: number; files: number };
  missingFiles: number;
}> {
  const used = new Set<string>();
  const pathOf = new Map<string, string>();
  let missingFiles = 0;
  /** The pack path for a file a preset uses, or null if it isn't loaded. */
  const include = (ref: { id: string; name: string }): string | null => {
    const known = pathOf.get(ref.id);
    if (known) return known;
    if (!effectFileBlob(ref.id)) {
      missingFiles++;
      return null;
    }
    const name = /\.[a-z0-9]{2,5}$/i.test(ref.name) ? ref.name : `${ref.name}.wav`;
    const path = `samples/${packFileName(name, used)}`;
    pathOf.set(ref.id, path);
    return path;
  };

  const effectPresets = userPresets()
    .filter((p) => !p.pack)
    .map(({ type, name, params, tempoRelative }) => ({ type, name, params, ...(tempoRelative ? { tempoRelative } : {}) }));
  const synthPresets = userSynthPresets()
    .filter((p) => !p.pack)
    .map((p) => {
      const params = structuredClone(p.params);
      for (const osc of [params.osc1, params.osc2]) {
        if (!osc.userTable) continue;
        const path = include(osc.userTable);
        if (path) osc.userTable = { ...osc.userTable, id: path };
        else delete osc.userTable;
      }
      return { name: p.name, category: p.category, params };
    });
  const kits = ownDrumKits().map((k) => {
    const kit = structuredClone(k.kit);
    kit.pads.forEach((pad) => {
      if (!pad.sample) return;
      const path = include(pad.sample);
      if (path) pad.sample = { ...pad.sample, id: path };
    });
    return { name: k.name, kit };
  });

  const files: PackFile[] = await Promise.all(
    [...pathOf].map(async ([id, path]) => ({ path, data: new Uint8Array(await effectFileBlob(id)!.arrayBuffer()) }))
  );
  const bytes = writePack({
    manifest: {
      format: "dawnpack",
      schema: 1,
      name: info.name.trim().slice(0, 60) || "My Presets",
      version: new Date().toISOString().slice(0, 10),
      author: info.author.trim().slice(0, 80) || "Me",
      license: info.license.trim().slice(0, 80) || "Personal use",
    },
    effectPresets,
    synthPresets,
    kits,
    grooves: [],
    files,
  });
  return { bytes, counts: { effectPresets: effectPresets.length, synthPresets: synthPresets.length, kits: kits.length, files: files.length }, missingFiles };
}
