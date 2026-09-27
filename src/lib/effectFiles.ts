// Files uploaded into effects (impulse responses now; amp models later).
// An effect only stores a reference ({ id, name }); the file itself lives
// here while the app runs and is saved alongside the project's audio clips
// (persistence.ts), keyed by the same id. Files are never dropped from this
// registry during a session - undo can bring back an effect that used one -
// and saving only writes the ones the project still references.

import type { EffectFileRef, EffectInstance } from "./effects";

const files = new Map<string, Blob>();
const decoded = new Map<string, Promise<AudioBuffer | null>>();

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

export function effectFileBlob(id: string): Blob | undefined {
  return files.get(id);
}

function forgetEffectFile(id: string): void {
  files.delete(id);
  [...decoded.keys()].filter((k) => k.startsWith(`${id}@`)).forEach((k) => decoded.delete(k));
}

export function hasEffectFile(id: string): boolean {
  return files.has(id);
}

/** Every file referenced by these effect lists. */
export function referencedEffectFiles(lists: EffectInstance[][]): EffectFileRef[] {
  const refs = new Map<string, EffectFileRef>();
  lists.forEach((list) => list.forEach((fx) => fx.file && refs.set(fx.file.id, fx.file)));
  return [...refs.values()];
}

/** The file decoded as audio at `sampleRate` (the browser resamples it), or
 * null if it's missing or isn't audio. Cached per file and rate. */
export function decodeEffectFileAudio(id: string, sampleRate: number): Promise<AudioBuffer | null> {
  const key = `${id}@${sampleRate}`;
  const cached = decoded.get(key);
  if (cached) return cached;
  const blob = files.get(id);
  if (!blob) return Promise.resolve(null);
  const promise = blob
    .arrayBuffer()
    .then((bytes) => new OfflineAudioContext(1, 1, sampleRate).decodeAudioData(bytes))
    .catch(() => {
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
