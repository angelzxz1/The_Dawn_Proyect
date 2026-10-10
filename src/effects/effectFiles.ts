// Files uploaded into effects (impulse responses now; amp models later).
// An effect only stores a reference ({ id, name }); the file itself lives
// here while the app runs and is saved alongside the project's audio clips
// (persistence.ts), keyed by the same id. Files are never dropped from this
// registry during a session - undo can bring back an effect that used one -
// and saving only writes the ones the project still references.

import type { EffectFileRef, EffectInstance } from "./registry";
import { MAX_NAM_BYTES, parseNamFile } from "./nam-amp/namModel";
import type { SynthParams } from "../instruments/synth/synthParams";
import type { DrumKitParams } from "../instruments/drum-rack/drumParams";
import { factoryFileBlob, isFactoryFile } from "../library/tones";
import { noteIssue } from "../services/issues";

const files = new Map<string, Blob>();
const decoded = new Map<string, Promise<AudioBuffer | null>>();
const texts = new Map<string, Promise<string | null>>();

export function newEffectFileId(): string {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `file-${random}`;
}

export function registerEffectFile(id: string, blob: Blob): void {
  files.set(id, blob);
}

/** The file, generating it first if it's one of Dawn's factory files (its cabinets). */
function blobOf(id: string): Blob | undefined {
  const blob = files.get(id);
  if (blob || !isFactoryFile(id)) return blob;
  const made = factoryFileBlob(id);
  if (made) files.set(id, made);
  return made ?? undefined;
}

export function effectFileBlob(id: string): Blob | undefined {
  return blobOf(id);
}

function forgetEffectFile(id: string): void {
  files.delete(id);
  [...decoded.keys()].filter((k) => k.startsWith(`${id}@`)).forEach((k) => decoded.delete(k));
  texts.delete(id);
}

/** The file's contents as text (a .nam model is JSON), or null if missing. */
export function readEffectFileText(id: string): Promise<string | null> {
  const cached = texts.get(id);
  if (cached) return cached;
  const blob = blobOf(id);
  if (!blob) return Promise.resolve(null);
  const promise = blob.text().catch((error) => {
    noteIssue("effectfile.read", error);
    texts.delete(id);
    return null;
  });
  texts.set(id, promise);
  return promise;
}

export function hasEffectFile(id: string): boolean {
  return files.has(id) || isFactoryFile(id);
}

/** Every file referenced by these effect lists, and by these tracks'
 * synths (imported wavetables). */
export function referencedEffectFiles(
  lists: EffectInstance[][],
  channels: { synthParams?: SynthParams; drumParams?: DrumKitParams }[] = []
): EffectFileRef[] {
  const refs = new Map<string, EffectFileRef>();
  lists.forEach((list) => list.forEach((fx) => fx.file && refs.set(fx.file.id, fx.file)));
  channels.forEach((c) => {
    [c.synthParams?.osc1, c.synthParams?.osc2].forEach((o) => o?.userTable && refs.set(o.userTable.id, o.userTable));
    c.drumParams?.pads.forEach((pad) => pad.sample && refs.set(pad.sample.id, pad.sample));
  });
  return [...refs.values()];
}

/** The file decoded as audio at `sampleRate` (the browser resamples it), or
 * null if it's missing or isn't audio. Cached per file and rate. */
export function decodeEffectFileAudio(id: string, sampleRate: number): Promise<AudioBuffer | null> {
  const key = `${id}@${sampleRate}`;
  const cached = decoded.get(key);
  if (cached) return cached;
  const blob = blobOf(id);
  if (!blob) return Promise.resolve(null);
  const promise = blob
    .arrayBuffer()
    .then((bytes) => new OfflineAudioContext(1, 1, sampleRate).decodeAudioData(bytes))
    .catch((error) => {
      noteIssue("effectfile.decode", error);
      decoded.delete(key);
      return null;
    });
  decoded.set(key, promise);
  return promise;
}

const MAX_FILE_BYTES = 50 * 1024 * 1024;

/** Adds an uploaded audio file (an IR) to the registry if it decodes and
 * fits the limits; otherwise explains what's wrong with it. */
export async function importAudioEffectFile(
  file: File,
  sampleRate: number,
  maxSeconds: number
): Promise<{ ref: EffectFileRef } | { error: string }> {
  if (file.size > MAX_FILE_BYTES) return { error: `"${file.name}" is too large for an IR (max 50 MB).` };
  const id = newEffectFileId();
  registerEffectFile(id, file);
  const buffer = await decodeEffectFileAudio(id, sampleRate);
  if (!buffer) {
    forgetEffectFile(id);
    return { error: `Couldn't read "${file.name}" as audio. Use a WAV, AIFF, FLAC or MP3 file.` };
  }
  if (buffer.duration > maxSeconds) {
    forgetEffectFile(id);
    return { error: `"${file.name}" is ${buffer.duration.toFixed(1)} s long - an IR can be up to ${maxSeconds} s.` };
  }
  return { ref: { id, name: file.name } };
}

/** Adds an uploaded .nam file to the registry if it looks like a NAM model
 * (the engine does the full check when it loads it). */
export async function importNamModelFile(file: File): Promise<{ ref: EffectFileRef } | { error: string }> {
  if (file.size > MAX_NAM_BYTES) return { error: `"${file.name}" is too large for a NAM model (max 50 MB).` };
  let json: string;
  try {
    json = await file.text();
  } catch {
    return { error: `Couldn't read "${file.name}".` };
  }
  const parsed = parseNamFile(json);
  if ("error" in parsed) return { error: `"${file.name}" ${parsed.error}` };
  const id = newEffectFileId();
  registerEffectFile(id, file);
  texts.set(id, Promise.resolve(json));
  return { ref: { id, name: file.name } };
}

/** Drops a file that was imported but then couldn't be used. */
export function discardEffectFile(id: string): void {
  forgetEffectFile(id);
}
