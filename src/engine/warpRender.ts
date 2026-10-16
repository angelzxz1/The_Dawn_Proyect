// Warped clips' audio (warp.ts, timeStretch.ts), rendered once and kept:
// the live engine and the export both play a warped clip's rendering, and
// share it. A rendering is known by what goes into it - the file, the
// mode, and the clip's pieces (relative to its start) - so moving a clip
// where the tempo is the same, or exporting, needs no new one.

import type { WarpPiece } from "../project/warp";
import { renderInSteps, type StretchMode } from "./timeStretch";

/** How much rendered audio is kept (bytes; the least recently used goes
 * first). A clip playing keeps its own rendering whatever goes from here. */
const BUDGET = 256 * 1024 * 1024;
const cache = new Map<string, { job: Promise<AudioBuffer>; bytes: number }>();

function trim(): void {
  let total = 0;
  cache.forEach((entry) => (total += entry.bytes));
  for (const [key, entry] of cache) {
    if (total <= BUDGET || cache.size <= 1) break;
    total -= entry.bytes;
    cache.delete(key);
  }
}

const round = (x: number) => Math.round(x * 1e6) / 1e6;

/** What a rendering is known by. */
export function warpKey(url: string, mode: StretchMode, pieces: readonly WarpPiece[], length: number): string {
  return JSON.stringify([url, mode, round(length), pieces.map((p) => [round(p.t0), round(p.t1), round(p.s0), round(p.s1)])]);
}

/** The audio a warped clip plays (`length` seconds), from its file's
 * decoded audio: rendered the first time, after that from the cache. */
export function warpedBuffer(key: string, source: AudioBuffer, pieces: readonly WarpPiece[], length: number, mode: StretchMode): Promise<AudioBuffer> {
  const hit = cache.get(key);
  if (hit) {
    // Most recently used goes to the back.
    cache.delete(key);
    cache.set(key, hit);
    return hit.job;
  }
  const job = (async () => {
    const channels = Array.from({ length: source.numberOfChannels }, (_, c) => source.getChannelData(c));
    const frames = Math.max(1, Math.round(length * source.sampleRate));
    const rendered = await renderInSteps(channels, source.sampleRate, pieces, frames, mode);
    const buffer = new AudioBuffer({ length: frames, numberOfChannels: rendered.length, sampleRate: source.sampleRate });
    rendered.forEach((data, c) => buffer.copyToChannel(data as Float32Array<ArrayBuffer>, c));
    return buffer;
  })();
  const entry = { job, bytes: 0 };
  cache.set(key, entry);
  job.then(
    (buffer) => {
      entry.bytes = buffer.length * buffer.numberOfChannels * 4;
      trim();
    },
    // A failed one isn't kept.
    () => cache.delete(key)
  );
  return job;
}
