// MP3 encoding with lamejs (LGPL-3.0; it runs unmodified in its own worker
// file, mp3.worker.ts). Pure, so the tests run it directly.

import { Mp3Encoder } from "@breezystack/lamejs";
import { toInt16 } from "./exportFormats";

/** Samples per MP3 frame, and how many frames to encode per step. */
const FRAME = 1152;
const STEP = FRAME * 64;

/** Encodes stereo (or mono) float audio as MP3 frames, reporting progress 0..1. */
export function encodeMp3Frames(
  channels: Float32Array[],
  sampleRate: number,
  kbps: number,
  onProgress?: (fraction: number) => void
): Uint8Array[] {
  const stereo = channels.length > 1;
  const encoder = new Mp3Encoder(stereo ? 2 : 1, sampleRate, kbps);
  const left = toInt16(channels[0] ?? new Float32Array(0));
  const right = stereo ? toInt16(channels[1]) : undefined;
  const parts: Uint8Array[] = [];
  for (let i = 0; i < left.length; i += STEP) {
    const l = left.subarray(i, i + STEP);
    const chunk = right ? encoder.encodeBuffer(l, right.subarray(i, i + STEP)) : encoder.encodeBuffer(l);
    if (chunk.length) parts.push(new Uint8Array(chunk));
    onProgress?.(Math.min(1, (i + STEP) / left.length));
  }
  const end = encoder.flush();
  if (end.length) parts.push(new Uint8Array(end));
  return parts;
}
