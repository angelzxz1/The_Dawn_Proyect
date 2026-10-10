// The tones you can pick in the NAM Amp and IR Loader without hunting for
// files: Dawn's own cabinet IRs (generated in code, always there), and amp
// captures and IRs listed in public/tones/manifest.json - licensed content
// shipped as static files and fetched only when picked. Every file listed
// there needs an entry in src/content/licenses.json (a test checks).

import { cabImpulse, factoryCab, FACTORY_CABS } from "../effects/ir-loader/cabIrs";
import { encodeWav } from "../export/wav";
import { noteIssue } from "../services/issues";

export interface ToneEntry {
  id: string;
  /** "amp" for a .nam capture, "ir" for a cabinet impulse response. */
  kind: "amp" | "ir";
  name: string;
  description: string;
  creator: string;
  creatorUrl?: string;
  license?: string;
  /** For bundled files: their path under public/. Dawn's own cabs have none. */
  file?: string;
  /** A lighter capture that costs less CPU on older computers. */
  light?: boolean;
  /** Which instrument it suits. */
  use?: "guitar" | "bass";
}

/** Dawn's cabinets, as tone entries. */
export const FACTORY_CAB_TONES: ToneEntry[] = FACTORY_CABS.map((c) => ({
  id: c.id,
  kind: "ir",
  name: c.name,
  description: c.description,
  creator: "The Dawn Project",
  use: c.use,
}));

export function isFactoryFile(id: string): boolean {
  return id.startsWith("factory-ir:") && !!factoryCab(id);
}

const generated = new Map<string, Blob>();

/** A factory cab's IR as a 24-bit WAV file, generated once per session. */
export function factoryFileBlob(id: string): Blob | null {
  const cab = factoryCab(id);
  if (!cab) return null;
  let blob = generated.get(id);
  if (!blob) {
    blob = encodeWav([cabImpulse(cab, 48000)], 48000, 24);
    generated.set(id, blob);
  }
  return blob;
}

// --- the manifest of bundled files ---

function validEntry(raw: unknown): ToneEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const str = (v: unknown, max = 200) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
  const id = str(r.id, 80);
  const name = str(r.name, 60);
  const creator = str(r.creator, 80);
  const file = str(r.file, 200);
  const kind = r.kind === "amp" || r.kind === "ir" ? r.kind : null;
  // Only plain relative paths inside tones/, with the right extension.
  const safe = file && /^tones\/[\w\-./ ]+$/.test(file) && !file.includes("..") && (kind === "amp" ? /\.nam$/i.test(file) : /\.(wav|wave)$/i.test(file));
  if (!id || !name || !creator || !kind || !safe) return null;
  const url = str(r.creatorUrl, 300);
  return {
    id: `tone:${id}`,
    kind,
    name,
    description: str(r.description, 240) ?? "",
    creator,
    ...(url && /^https:\/\//.test(url) ? { creatorUrl: url } : {}),
    ...(str(r.license, 60) ? { license: str(r.license, 60)! } : {}),
    file: file!,
    ...(r.light === true ? { light: true } : {}),
    ...(r.use === "guitar" || r.use === "bass" ? { use: r.use } : {}),
  };
}

/** The entries of a manifest file, skipping any that are malformed. */
export function parseToneManifest(raw: unknown): ToneEntry[] {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  if (r.version !== 1 || !Array.isArray(r.tones)) return [];
  return r.tones.map(validEntry).filter((e): e is ToneEntry => !!e);
}

let manifest: Promise<ToneEntry[]> | null = null;

/** The bundled tones (fetched once, when first needed). */
export function bundledTones(): Promise<ToneEntry[]> {
  manifest ??= fetch("/tones/manifest.json")
    .then((r) => (r.ok ? r.json() : null))
    .then(parseToneManifest)
    .catch((error) => {
      noteIssue("tones.manifest", error);
      return [];
    });
  return manifest;
}

/** Downloads a bundled tone's file, ready to load like one the user picked. */
export async function fetchToneFile(entry: ToneEntry): Promise<File> {
  if (!entry.file) throw new Error("This tone has no file.");
  const res = await fetch(`/${entry.file}`);
  if (!res.ok) throw new Error(`Couldn't download ${entry.name} (${res.status}).`);
  const name = entry.file.split("/").pop() ?? entry.name;
  return new File([await res.blob()], name);
}
