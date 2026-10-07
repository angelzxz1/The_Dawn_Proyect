// The .dawnpack format: a ZIP of data that adds sounds to Dawn - effect and
// synth presets, drum kits, grooves, cabinet IRs, amp captures and samples.
// A pack only ever holds data: every file must be one of the known kinds,
// in its folder, within the size limits, or the whole pack is refused
// before anything is installed. The manifest's schema number lets later
// versions keep reading old packs.
//
//   manifest.json          { format: "dawnpack", schema: 1, name, version, author, license, description?, url? }
//   presets/effects.json   effect presets (as saved in this browser)
//   presets/synth.json     Daybreak presets
//   kits/kits.json         Drum Rack kits; sample pads name files in samples/
//   grooves/grooves.json   grooves in the groove library's format
//   irs/*.wav              cabinet or room impulse responses
//   nam/*.nam              amp captures
//   samples/*              audio for kit pads and imported wavetables
//   README.txt, LICENSE.txt  shown to no one, allowed

import { unzipSync, zipSync, strToU8, strFromU8, type Unzipped } from "fflate";

export const PACK_EXTENSION = ".dawnpack";
export const PACK_SCHEMA = 1;
export const PACK_LIMITS = {
  /** All files, unpacked. */
  totalBytes: 300 * 1024 * 1024,
  fileBytes: 50 * 1024 * 1024,
  files: 500,
  /** Each JSON file. */
  jsonBytes: 5 * 1024 * 1024,
};

export interface PackManifest {
  format: "dawnpack";
  schema: number;
  name: string;
  version: string;
  author: string;
  license: string;
  description?: string;
  url?: string;
}

export interface PackFile {
  /** e.g. "irs/4x12 V30.wav" */
  path: string;
  data: Uint8Array;
}

export interface PackContents {
  manifest: PackManifest;
  effectPresets: unknown[];
  synthPresets: unknown[];
  kits: unknown[];
  grooves: unknown[];
  /** irs/, nam/ and samples/ files. */
  files: PackFile[];
}

const AUDIO = /\.(wav|wave|flac|mp3|ogg|oga|aif|aiff|m4a)$/i;
const JSON_FILES: Record<string, keyof Pick<PackContents, "effectPresets" | "synthPresets" | "kits" | "grooves">> = {
  "presets/effects.json": "effectPresets",
  "presets/synth.json": "synthPresets",
  "kits/kits.json": "kits",
  "grooves/grooves.json": "grooves",
};

/** What kind of file a path is in a pack, or null if packs can't hold it. */
export function packPathKind(path: string): "manifest" | "json" | "ir" | "nam" | "sample" | "doc" | null {
  if (!path || path.length > 200 || path.includes("\\") || path.startsWith("/") || path.split("/").some((part) => part === ".." || part === ".")) return null;
  if (path === "manifest.json") return "manifest";
  if (JSON_FILES[path]) return "json";
  if (/^(README|LICENSE|CREDITS)(\.(txt|md))?$/i.test(path)) return "doc";
  const [folder, name, ...rest] = path.split("/");
  if (!name || rest.length) return null;
  if (folder === "irs" && /\.(wav|wave)$/i.test(name)) return "ir";
  if (folder === "nam" && /\.nam$/i.test(name)) return "nam";
  if (folder === "samples" && AUDIO.test(name)) return "sample";
  return null;
}

export type PackResult = { ok: true; pack: PackContents } | { ok: false; error: string };

function text(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

export function normalizeManifest(raw: unknown): PackManifest | string {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  if (!r || r.format !== "dawnpack") return "it has no Dawn pack manifest.";
  const schema = typeof r.schema === "number" ? r.schema : 0;
  if (schema < 1) return "its manifest is malformed.";
  if (schema > PACK_SCHEMA) return "it was made for a newer version of Dawn. Reload Dawn to update it, then try again.";
  const name = text(r.name, 60);
  if (!name) return "its manifest has no name.";
  const url = text(r.url, 300);
  return {
    format: "dawnpack",
    schema,
    name,
    version: text(r.version, 20) || "1",
    author: text(r.author, 80) || "Unknown",
    license: text(r.license, 80) || "Unspecified",
    ...(text(r.description, 500) ? { description: text(r.description, 500) } : {}),
    ...(url && /^https:\/\//.test(url) ? { url } : {}),
  };
}

/** Reads and checks a pack. Nothing is unpacked unless every file in it is
 * allowed and the sizes fit. */
export function readPack(bytes: Uint8Array): PackResult {
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) return { ok: false, error: "This isn't a Dawn pack (it isn't a ZIP file)." };
  let total = 0;
  let count = 0;
  let refused: string | null = null;
  let entries: Unzipped;
  try {
    entries = unzipSync(bytes, {
      filter: (file) => {
        if (file.name.endsWith("/")) return false; // folders
        count++;
        total += file.originalSize;
        const kind = packPathKind(file.name);
        if (!kind) refused ??= `it contains "${file.name.slice(0, 80)}", which isn't something a pack can hold.`;
        else if (file.originalSize > (kind === "json" || kind === "manifest" ? PACK_LIMITS.jsonBytes : PACK_LIMITS.fileBytes))
          refused ??= `"${file.name.slice(0, 80)}" is too large.`;
        if (count > PACK_LIMITS.files) refused ??= `it has more than ${PACK_LIMITS.files} files.`;
        if (total > PACK_LIMITS.totalBytes) refused ??= `it's larger than ${PACK_LIMITS.totalBytes / 1024 / 1024} MB unpacked.`;
        // Only unpack once everything seen so far is fine.
        return !refused;
      },
    });
  } catch {
    return { ok: false, error: "Couldn't read the pack: the file is damaged." };
  }
  if (refused) return { ok: false, error: `Couldn't install the pack: ${refused}` };
  if (!entries["manifest.json"]) return { ok: false, error: "Couldn't install the pack: it has no manifest.json." };

  const parse = (path: string): unknown => {
    try {
      return JSON.parse(strFromU8(entries[path]));
    } catch {
      return undefined;
    }
  };
  const manifest = normalizeManifest(parse("manifest.json"));
  if (typeof manifest === "string") return { ok: false, error: `Couldn't install the pack: ${manifest}` };

  const pack: PackContents = { manifest, effectPresets: [], synthPresets: [], kits: [], grooves: [], files: [] };
  for (const [path, key] of Object.entries(JSON_FILES)) {
    if (!entries[path]) continue;
    const value = parse(path);
    if (!Array.isArray(value)) return { ok: false, error: `Couldn't install the pack: ${path} isn't a list.` };
    pack[key] = value;
  }
  for (const [path, data] of Object.entries(entries)) {
    const kind = packPathKind(path);
    if (kind === "ir" || kind === "nam" || kind === "sample") pack.files.push({ path, data });
  }
  const items = pack.effectPresets.length + pack.synthPresets.length + pack.kits.length + pack.grooves.length + pack.files.length;
  if (items === 0) return { ok: false, error: "Couldn't install the pack: it's empty." };
  return { ok: true, pack };
}

/** Writes a pack. */
export function writePack(pack: PackContents): Uint8Array {
  const files: Record<string, Uint8Array> = {
    "manifest.json": strToU8(JSON.stringify({ ...pack.manifest, format: "dawnpack", schema: PACK_SCHEMA }, null, 2)),
  };
  for (const [path, key] of Object.entries(JSON_FILES)) {
    if (pack[key].length) files[path] = strToU8(JSON.stringify(pack[key], null, 2));
  }
  pack.files.forEach((f) => {
    if (packPathKind(f.path)) files[f.path] = f.data;
  });
  return zipSync(files, { level: 6 });
}

/** A short, stable id for a pack from its name (reinstalling replaces it). */
export function packId(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "pack"
  );
}

/** A file name that's safe inside a pack folder. */
export function packFileName(name: string, used: Set<string>): string {
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot).toLowerCase() : "";
  const base = (dot > 0 ? name.slice(0, dot) : name).replace(/[^\w\- ]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60) || "file";
  let candidate = `${base}${ext}`;
  for (let n = 2; used.has(candidate.toLowerCase()); n++) candidate = `${base} ${n}${ext}`;
  used.add(candidate.toLowerCase());
  return candidate;
}
